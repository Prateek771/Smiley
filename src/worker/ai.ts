import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { z } from "zod";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { AccessError, withIdentityTransaction } from "../server/access";
import { migrationPool } from "../server/db/client";
import { createLocalStorage } from "../server/documents/storage";
import { validateRunContext, type AIResult, type AISource, type RunRow } from "../server/ai";
import { generateAIResult } from "../server/ai/generate";
import { extractDocument, generateStructured, ProviderFailure } from "../server/ai/providers";
import { checkpoints } from "./checkpoints";

const terminal = ["COMPLETE", "FAILED", "STALE", "DENIED", "REVIEW_REQUIRED"];
type Dependencies = { extract?: typeof extractDocument; generate?: typeof generateStructured; signal?: AbortSignal };
const State = Annotation.Root({ sources: Annotation<AISource[]>(), result: Annotation<AIResult | null>() });

export async function executeAIRun(id: string, dependencies: Dependencies = {}, queue?: { attempts: number; locked_by: string | null }) {
  z.uuid().parse(id);
  // Document text stays in the private checkpoint database; environment tracing cannot export it.
  process.env.LANGSMITH_TRACING = "false";
  process.env.LANGCHAIN_TRACING_V2 = "false";
  const client = await migrationPool.connect(); let retryFailure = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,29))", [id]);
    const found = await client.query<RunRow>("SELECT * FROM ai_runs WHERE id=$1", [id]);
    if (!found.rowCount || terminal.includes(found.rows[0].status)) return;
    const run = found.rows[0]; const attempts = Math.max(run.attempts + 1, queue?.attempts ?? 0);
    if (attempts > 3) throw new Error("AI run exceeded its delivery limit.");
    await client.query("UPDATE ai_runs SET status='RUNNING',attempts=$2,worker_pid=$3,worker_host=$4,queue_worker_id=$5,updated_at=now() WHERE id=$1", [id, attempts, queue ? process.pid : null, queue ? hostname() : null, queue?.locked_by ?? null]);
    try {
      const sourceRows = await withIdentityTransaction(run.auth_owner_id, "case:act", String(run.branch_id), (business, actor) => validateRunContext(business, actor, run));
      const graph = new StateGraph(State)
        .addNode("ocr", async () => {
          const storage = createLocalStorage(); const sources: AISource[] = [];
          for (const source of sourceRows) {
            const bytes = await storage.read(source.storage_key);
            if (bytes.length !== source.size_bytes || createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new AccessError(409, "The private source changed.");
            const output = await (dependencies.extract ?? extractDocument)(bytes, source.mime_type, dependencies.signal);
            sources.push({ revisionId: source.revision_id, documentType: source.document_type, sha256: source.sha256, pages: output.pages });
          }
          return { sources };
        })
        .addNode("propose", async (state) => ({ result: await generateAIResult(run.kind, state.sources, run.query_snapshot, dependencies.generate ?? generateStructured, dependencies.signal) }))
        .addEdge(START, "ocr").addEdge("ocr", "propose").addEdge("propose", END).compile({ checkpointer: checkpoints });
      const config = { configurable: { thread_id: id }, durability: "sync" as const, callbacks: [], signal: dependencies.signal };
      const saved = await checkpoints.getTuple(config);
      const completed = saved && !(await graph.getState(config)).next.length && saved.checkpoint.channel_values.result;
      const result = completed || (await graph.invoke(saved ? null : { sources: [], result: null }, config)).result;
      if (!result) throw new ProviderFailure("INVALID_OUTPUT");
      // Cloud calls finish before this short transaction. The case lock protects final freshness validation.
      await withIdentityTransaction(run.auth_owner_id, "case:act", String(run.branch_id), async (business, actor) => {
        await validateRunContext(business, actor, run);
        await client.query("UPDATE ai_runs SET status='COMPLETE',result=$2,reason=NULL,updated_at=now() WHERE id=$1", [id, JSON.stringify(result)]);
      });
    } catch (error) {
      const status = error instanceof AccessError ? error.status === 409 ? "STALE" : "DENIED"
        : error instanceof ProviderFailure && error.code !== "TEMPORARY" ? "REVIEW_REQUIRED" : attempts >= 3 ? "FAILED" : "RETRYING";
      const reason = status === "STALE" ? "Source evidence or the case changed. Review current inputs and request a new run."
        : status === "DENIED" ? "The request owner no longer has current staff access."
          : status === "REVIEW_REQUIRED" ? "The provider could not return supported, source-grounded evidence. Use manual review or request a new run."
            : status === "FAILED" ? "AI processing stopped after three attempts. The active owner can request recovery."
              : "Temporary provider failure. The saved OCR stage will resume within the three-attempt limit.";
      await client.query("UPDATE ai_runs SET status=$2,reason=$3,result=NULL,updated_at=now() WHERE id=$1", [id, status, reason]);
      retryFailure = status === "RETRYING" || status === "FAILED";
    }
  } finally { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,29))", [id]); client.release(); }
  if (retryFailure) throw new Error("AI processing failed; see the sanitized run status.");
}
