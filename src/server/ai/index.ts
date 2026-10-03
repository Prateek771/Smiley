import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, withActorTransaction, type Actor } from "../access";
import { branchScope } from "../access/permissions";
import { writeAudit } from "../audit";
import { caseIdSchema, fingerprint, revisionCurrent, scopedCase } from "../financial/records";
import type { OCRPage } from "./providers";
import type { ExtractedFact } from "./evidence";

export type AISource = { revisionId: string; documentType: string; sha256: string; pages: OCRPage[] };
export type AICitation = { revisionId: string; pageNumber: number; quote: string };
export type AIResult = { sources: AISource[]; facts: (ExtractedFact & { revisionId: string })[]; missing: string[]; conflicts: { field: string; values: { revisionId: string; pageNumber: number; value: string; quote: string }[] }[]; excerpts: AICitation[]; followUps: { kind: string; citation: AICitation }[]; draft: string | null };
export type AIRunDto = { id: string; kind: string; status: string; attempts: number; ownerId: string; inputVersion: number; queryReference: string | null; reason: string | null; result: AIResult | null; createdAt: string; updatedAt: string };
export type AIReviewDto = { id: string; runId: string; itemIndex: number; action: string; value: string | null; reason: string; actorId: string; createdAt: string };
export type CaseAI = { runs: AIRunDto[]; reviews: AIReviewDto[] };
export type RunSource = { revision_id: string; sha256: string; document_type: string; storage_key: string; mime_type: string; size_bytes: number };
export type RunRow = { id: string; hospital_id: string; branch_id: string; claim_id: string; actor_user_id: string; auth_owner_id: string; kind: string; input_version: number; input_fingerprint: string; query_reference: string | null; query_snapshot: Record<string, unknown> | null; attempts: number; status: string };
const requestSchema = z.object({ kind: z.enum(["EXTRACTION", "PACK_CHECK", "RESPONSE_DRAFT"]), expectedVersion: z.number().int().positive(), revisionIds: z.array(z.uuid()).min(1).max(12).refine((ids) => new Set(ids).size === ids.length), queryReference: z.string().trim().min(1).max(150).optional(), synthetic: z.literal(true), idempotencyKey: z.string().min(8).max(100), retryOf: z.uuid().optional() }).strict();
const reviewSchema = z.object({ runId: z.uuid(), itemIndex: z.number().int().min(-1).max(199), action: z.enum(["ACCEPT", "CORRECT", "REJECT"]), value: z.string().trim().min(1).max(20000).optional(), reason: z.string().trim().min(1).max(2000), verified: z.literal(true), expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(8).max(100) }).strict();
function requireId(caseId: string) { if (!caseIdSchema.safeParse(caseId).success) throw new AccessError(400, "Choose a valid case."); }
function requireActionScope(actor: Actor, current: Record<string, unknown>) { if (!branchScope(actor, "case:act").includes(String(current.branch_id))) throw new AccessError(404, "The case is outside your action scope."); }
export async function querySnapshot(client: PoolClient, caseId: string, reference: string) {
  const result = await client.query("SELECT query_id::text AS id,external_reference AS reference,query_text AS text,status,response_text AS response FROM claim_queries WHERE claim_id=$1 AND external_reference=$2", [caseId, reference]);
  if (!result.rowCount || result.rows[0].status === "RESOLVED") throw new AccessError(409, "Choose a current unresolved payer query.");
  return result.rows[0] as Record<string, unknown>;
}
export async function runSources(client: PoolClient, run: RunRow): Promise<RunSource[]> {
  const result = await client.query<RunSource>(`SELECT r.revision_id,s.sha256,s.document_type,r.storage_key,r.mime_type,r.size_bytes::integer AS size_bytes FROM ai_run_sources s JOIN document_revisions r ON r.revision_id=s.revision_id AND r.hospital_id=s.hospital_id AND r.branch_id=s.branch_id AND r.claim_id=s.claim_id WHERE s.run_id=$1 AND s.hospital_id=$2 AND s.branch_id=$3 AND s.claim_id=$4 ORDER BY s.revision_id`, [run.id, run.hospital_id, run.branch_id, run.claim_id]);
  return result.rows;
}
export const sourceFingerprint = (version: number, sources: Pick<RunSource, "revision_id" | "sha256" | "document_type">[], query: Record<string, unknown> | null) => fingerprint([version, sources.map((source) => [source.revision_id, source.sha256, source.document_type]), query]);
export async function validateRunContext(client: PoolClient, actor: Actor, run: RunRow, requireOwner = true) {
  if (actor.hospitalId !== String(run.hospital_id) || (requireOwner && actor.userId !== String(run.actor_user_id))) throw new AccessError(403, "The run owner no longer has current access.");
  const current = await scopedCase(client, actor, String(run.claim_id), true); requireActionScope(actor, current);
  if (current.claim_status === "CANCELLED" || current.version !== run.input_version) throw new AccessError(409, "The case changed. Review current inputs before requesting another run.");
  const sources = await runSources(client, run); if (!sources.length) throw new AccessError(409, "The source documents are unavailable.");
  for (const source of sources) if (!await revisionCurrent(client, String(run.claim_id), source.revision_id)) throw new AccessError(409, "A source document was revised.");
  const query = run.query_reference ? await querySnapshot(client, String(run.claim_id), run.query_reference) : null;
  if (sourceFingerprint(current.version, sources, query) !== run.input_fingerprint) throw new AccessError(409, "The source evidence or payer query changed.");
  return sources;
}
export async function getCaseAI(headers: Headers, caseId: string): Promise<CaseAI> {
  requireId(caseId);
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => {
    await scopedCase(client, actor, caseId);
    const runs = await client.query(`SELECT id,kind,status,attempts,actor_user_id::text AS "ownerId",input_version AS "inputVersion",query_reference AS "queryReference",reason,result,created_at AS "createdAt",updated_at AS "updatedAt" FROM ai_runs WHERE claim_id=$1 AND hospital_id=$2 ORDER BY created_at DESC,id LIMIT 50`, [caseId, actor.hospitalId]);
    const reviews = await client.query(`SELECT id,run_id AS "runId",item_index AS "itemIndex",action,value,reason,actor_user_id::text AS "actorId",created_at AS "createdAt" FROM ai_reviews WHERE claim_id=$1 AND hospital_id=$2 AND run_id=ANY($3::uuid[]) ORDER BY created_at DESC,id DESC LIMIT 500`, [caseId, actor.hospitalId, runs.rows.map((row) => row.id)]);
    return { runs: runs.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })), reviews: reviews.rows.reverse().map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  });
}
export async function requestAIRun(headers: Headers, caseId: string, input: unknown): Promise<{ id: string }> {
  requireId(caseId); const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new AccessError(400, "Choose current source revisions, a run purpose and explicit synthetic-data confirmation.");
  const value = parsed.data;
  if ((value.kind === "EXTRACTION" && value.revisionIds.length !== 1) || (value.kind === "RESPONSE_DRAFT") !== !!value.queryReference) throw new AccessError(400, "Extraction uses one source; response drafts require an unresolved payer query.");
  const digest = fingerprint(value);
  return withActorTransaction(headers, "case:act", undefined, async (client, actor) => {
    const current = await scopedCase(client, actor, caseId, true); requireActionScope(actor, current);
    const prior = await client.query("SELECT id,request_fingerprint FROM ai_runs WHERE claim_id=$1 AND idempotency_key=$2", [caseId, value.idempotencyKey]);
    if (prior.rowCount) { if (prior.rows[0].request_fingerprint !== digest) throw new AccessError(409, "This request key already identifies different inputs."); return { id: prior.rows[0].id }; }
    if (current.claim_status === "CANCELLED" || current.version !== value.expectedVersion) throw new AccessError(409, "Review the current open case before requesting AI work.");
    const sources = (await client.query<RunSource>(`SELECT r.revision_id,r.sha256,d.document_type,r.storage_key,r.mime_type,r.size_bytes FROM document_revisions r JOIN claim_documents d ON d.claim_document_id=r.claim_document_id AND d.hospital_id=r.hospital_id AND d.branch_id=r.branch_id AND d.claim_id=r.claim_id WHERE r.claim_id=$1 AND r.revision_id=ANY($2::text[]) ORDER BY r.revision_id`, [caseId, value.revisionIds])).rows;
    if (sources.length !== value.revisionIds.length) throw new AccessError(400, "All source revisions must belong to this case.");
    for (const source of sources) if (!await revisionCurrent(client, caseId, source.revision_id)) throw new AccessError(409, "Choose the latest revision of each document.");
    const query = value.queryReference ? await querySnapshot(client, caseId, value.queryReference) : null;
    if (value.retryOf) {
      const old = await client.query("SELECT actor_user_id::text AS owner,status FROM ai_runs WHERE id=$1 AND claim_id=$2", [value.retryOf, caseId]);
      if (!old.rowCount || old.rows[0].owner !== actor.userId || !["FAILED", "STALE", "DENIED", "REVIEW_REQUIRED"].includes(old.rows[0].status)) throw new AccessError(409, "Only the active request owner can recover a stopped run.");
    }
    const id = randomUUID();
    await client.query("INSERT INTO ai_runs(id,hospital_id,branch_id,claim_id,actor_user_id,auth_owner_id,kind,input_version,input_fingerprint,request_fingerprint,idempotency_key,query_reference,query_snapshot,synthetic,retry_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14)", [id, actor.hospitalId, current.branch_id, caseId, actor.userId, actor.authUserId, value.kind, current.version, sourceFingerprint(current.version, sources, query), digest, value.idempotencyKey, value.queryReference ?? null, query ? JSON.stringify(query) : null, value.retryOf ?? null]);
    for (const source of sources) await client.query("INSERT INTO ai_run_sources(hospital_id,branch_id,claim_id,run_id,revision_id,sha256,document_type) VALUES($1,$2,$3,$4,$5,$6,$7)", [actor.hospitalId, current.branch_id, caseId, id, source.revision_id, source.sha256, source.document_type]);
    await client.query("SELECT smiley_private.enqueue_ai_run($1)", [id]);
    await writeAudit(client, actor, String(current.branch_id), "claims", "AI_REQUESTED", caseId, null, { runId: id, kind: value.kind, synthetic: true });
    return { id };
  });
}
export async function reviewAIResult(headers: Headers, caseId: string, input: unknown): Promise<{ id: string }> {
  requireId(caseId); const parsed = reviewSchema.safeParse(input); if (!parsed.success) throw new AccessError(400, "Provide a verified review action and reason.");
  const value = parsed.data; const digest = fingerprint(value);
  return withActorTransaction(headers, "case:act", undefined, async (client, actor) => {
    const current = await scopedCase(client, actor, caseId, true); requireActionScope(actor, current);
    const prior = await client.query("SELECT id,request_fingerprint FROM ai_reviews WHERE claim_id=$1 AND idempotency_key=$2", [caseId, value.idempotencyKey]);
    if (prior.rowCount) { if (prior.rows[0].request_fingerprint !== digest) throw new AccessError(409, "This review key already identifies a different review."); return { id: prior.rows[0].id }; }
    if (current.version !== value.expectedVersion) throw new AccessError(409, "The case changed. Refresh before reviewing.");
    const row = await client.query<RunRow & { result: AIResult }>("SELECT * FROM ai_runs WHERE id=$1 AND claim_id=$2", [value.runId, caseId]); const run = row.rows[0];
    if (!run || run.status !== "COMPLETE" || !run.result) throw new AccessError(409, "Only complete current evidence can be reviewed.");
    // Any currently authorized Desk reviewer may review; publishing still belongs to the requesting owner.
    await validateRunContext(client, actor, run, false);
    const original = value.itemIndex === -1 ? run.result.draft : run.result.facts[value.itemIndex]?.value;
    if (original === undefined || original === null) throw new AccessError(400, "Choose an existing fact or response draft.");
    if (value.action === "CORRECT" && !value.value) throw new AccessError(400, "Corrections require the reviewed replacement value.");
    if (value.action !== "CORRECT" && value.value !== undefined) throw new AccessError(400, "Use a correction to change the reviewed value.");
    const id = randomUUID();
    await client.query("INSERT INTO ai_reviews(id,hospital_id,branch_id,claim_id,run_id,actor_user_id,item_index,action,value,reason,input_fingerprint,request_fingerprint,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [id, actor.hospitalId, current.branch_id, caseId, run.id, actor.userId, value.itemIndex, value.action, value.action === "REJECT" ? null : value.value ?? original, value.reason, run.input_fingerprint, digest, value.idempotencyKey]);
    await writeAudit(client, actor, String(current.branch_id), "claims", "AI_REVIEWED", caseId, null, { runId: run.id, reviewId: id, action: value.action, itemIndex: value.itemIndex });
    return { id };
  });
}
