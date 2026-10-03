import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { migrationPool, closePools } from "../../src/server/db/client";
import { workflowFixture } from "../helpers/workflow";
import { getCase } from "../../src/server/cases";
import { uploadDocument } from "../../src/server/documents";
import type { OCRResult } from "../../src/server/ai/providers";
import { ProviderFailure } from "../../src/server/ai/providers";
import { recoverStoppedWorkers, startRegisteredWorker } from "../../src/worker/tasks";
import { applyCaseAction } from "../../src/server/timeline";
import { POST, GET } from "../../src/app/api/cases/[caseId]/ai/route";

let service: typeof import("../../src/server/ai") | null = null;
let worker: typeof import("../../src/worker/ai") | null = null;
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
before(async () => {
  service = await import("../../src/server/ai"); worker = await import("../../src/worker/ai");
  fixture = await workflowFixture();
});

test("acceptance cannot silently replace a fact and rejection remains separate from its original", async () => {
  const item = await request();
  await worker!.executeAIRun(item.run.id, { extract: async () => ocr, generate: async () => modelFacts });
  const value = { runId: item.run.id, itemIndex: 0, action: "ACCEPT", value: "1", reason: "Checked fictional original", verified: true, expectedVersion: item.input.expectedVersion, idempotencyKey: randomUUID() };
  await assert.rejects(service!.reviewAIResult(fixture.headers.deskA, item.caseId, value), { status: 400 });
  await service!.reviewAIResult(fixture.headers.deskA, item.caseId, { ...value, action: "REJECT", value: undefined, idempotencyKey: randomUUID() });
  const data = await service!.getCaseAI(fixture.headers.deskA, item.caseId);
  assert.equal(data.runs[0].result?.facts[0].value, "100,000"); assert.equal(data.reviews[0].action, "REJECT"); assert.equal(data.reviews[0].value, null);
});

test("pack checks and query drafts select literal evidence, remain reviewable and never acknowledge the payer", async () => {
  const item = await request("PACK_CHECK");
  const selections = { facts: [], excerpts: [{ revisionId: item.revision.revisionId, pageNumber: 1, quote: "Final bill INR 100,000." }], followUps: [] };
  await worker!.executeAIRun(item.run.id, { extract: async () => ocr, generate: async () => selections });
  const data = await service!.getCaseAI(fixture.headers.deskA, item.caseId);
  assert.equal(data.runs[0].status, "COMPLETE"); assert.equal(data.runs[0].result?.missing.length, 4);
  await service!.reviewAIResult(fixture.headers.deskA, item.caseId, { runId: item.run.id, itemIndex: -1, action: "ACCEPT", reason: "Fictional pack check reviewed", verified: true, expectedVersion: item.input.expectedVersion, idempotencyKey: randomUUID() });
  for (const status of ["PENDING", "IN_PROGRESS"]) await applyCaseAction(fixture.headers.deskA, item.caseId, { action: { type: "status", status, reason: "Begin fictional preparation" }, expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, idempotencyKey: randomUUID() });
  await applyCaseAction(fixture.headers.deskA, item.caseId, { action: { type: "query-open", reference: "AI-SYN-Q1", text: "Please clarify the fictional final bill." }, expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, idempotencyKey: randomUUID() });
  const current = (await getCase(fixture.headers.deskA, item.caseId)).version;
  const draft = await service!.requestAIRun(fixture.headers.deskA, item.caseId, { ...item.input, kind: "RESPONSE_DRAFT", queryReference: "AI-SYN-Q1", expectedVersion: current, idempotencyKey: randomUUID() });
  await worker!.executeAIRun(draft.id, { extract: async () => ocr, generate: async () => selections });
  const row = (await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs.find((run) => run.id === draft.id)!;
  assert.equal(row.status, "COMPLETE"); assert.match(row.result?.draft ?? "", /AI-SYN-Q1/);
  assert.equal((await migrationPool.query("SELECT status,response_text FROM claim_queries WHERE claim_id=$1", [item.caseId])).rows[0].status, "OPEN");
  assert.equal((await migrationPool.query("SELECT count(*)::int AS n FROM claim_records WHERE claim_id=$1 AND kind='query-ack'", [item.caseId])).rows[0].n, 0);
  await applyCaseAction(fixture.headers.deskA, item.caseId, { action: { type: "query-response", reference: "AI-SYN-Q1", text: "Staff prepared a revised response." }, expectedVersion: current, idempotencyKey: randomUUID() });
  await assert.rejects(service!.reviewAIResult(fixture.headers.deskA, item.caseId, { runId: draft.id, itemIndex: -1, action: "ACCEPT", reason: "Old draft", verified: true, expectedVersion: current + 1, idempotencyKey: randomUUID() }), { status: 409 });
});

test("three temporary failures stop, unsupported OCR requests require manual review and owners can recover", async () => {
  const item = await request(); let extracted = 0;
  const failed = { extract: async () => { extracted++; return ocr; }, generate: async () => { throw new ProviderFailure("TEMPORARY"); } };
  for (let i = 0; i < 3; i++) await assert.rejects(worker!.executeAIRun(item.run.id, failed));
  assert.equal(extracted, 1); assert.equal((await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs[0].status, "FAILED");
  const recovered = await service!.requestAIRun(fixture.headers.deskA, item.caseId, { ...item.input, retryOf: item.run.id, idempotencyKey: randomUUID() });
  await worker!.executeAIRun(recovered.id, { extract: async () => ocr, generate: async () => modelFacts });
  assert.equal((await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs.find((row) => row.id === recovered.id)?.status, "COMPLETE");
  const unsupported = await request();
  await worker!.executeAIRun(unsupported.run.id, { extract: async () => { throw new ProviderFailure("UNSUPPORTED"); } });
  assert.equal((await service!.getCaseAI(fixture.headers.deskA, unsupported.caseId)).runs[0].status, "REVIEW_REQUIRED");
});

test("a real queued worker resumes after a hard crash from its saved OCR stage", async () => {
  await migrationPool.query("DELETE FROM graphile_worker._private_jobs");
  const item = await request();
  const child = spawn(process.execPath, ["--import", "tsx", "tests/helpers/crashing-ai-worker.ts"], { env: { ...process.env, NODE_ENV: "test" }, stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("AI crash fixture did not reach the saved OCR checkpoint.")), 20000); child.on("message", (message) => { if ((message as { entered?: string }).entered === item.run.id) { clearTimeout(timer); resolve(); } }); child.once("error", reject); });
    await recoverStoppedWorkers(); assert.equal((await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs[0].status, "RUNNING");
  } finally { child.kill("SIGKILL"); await exited; }
  await recoverStoppedWorkers();
  const resumed = startRegisteredWorker({ noHandleSignals: true, concurrency: 1, pollInterval: 100 }, { "ai-review": async (payload, helpers) => worker!.executeAIRun((payload as { requestId: string }).requestId, { extract: async () => { throw new Error("Completed OCR must not repeat after a crash"); }, generate: async () => modelFacts }, helpers.job) });
  try { for (let i = 0; i < 200; i++) { if ((await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs[0].status === "COMPLETE") break; await new Promise((resolve) => setTimeout(resolve, 50)); } } finally { await resumed.gracefulShutdown(); }
  const result = (await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs[0]; assert.equal(result.status, "COMPLETE"); assert.equal(result.attempts, 2);
  assert.equal((await migrationPool.query("SELECT has_schema_privilege('smiley_app','smiley_langgraph','USAGE') AS allowed")).rows[0].allowed, false);
});

test("AI routes reject cross-origin writes, expose no unauthenticated data and use no-store responses", async () => {
  const item = await request(); const context = { params: Promise.resolve({ caseId: item.caseId }) };
  const foreign = new Headers(fixture.headers.deskA); foreign.set("origin", "https://other.test"); foreign.set("content-type", "application/json");
  assert.equal((await POST(new Request("http://localhost/api", { method: "POST", headers: foreign, body: JSON.stringify({ mode: "request", input: item.input }) }), context)).status, 403);
  assert.equal((await GET(new Request("http://localhost/api"), context)).status, 401);
  const response = await GET(new Request("http://localhost/api", { headers: fixture.headers.deskA }), context); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
});
after(closePools);
const sourceText = "Synthetic policy number SYN-POL-001. Final bill INR 100,000. Authorization INR 85,000.";
const ocr: OCRResult = { provider: "source-text", pages: [{ pageNumber: 1, text: sourceText, confidence: null, words: [] }] };
const modelFacts = { facts: [{ field: "bill_total", value: "100,000", pageNumber: 1, quote: "Final bill INR 100,000." }] };
async function request(kind = "EXTRACTION") {
  assert.ok(service && worker, "The checkpointed and scoped AI workflow must exist.");
  const item = await fixture.newCase();
  const revision = await uploadDocument(fixture.headers.deskA, item.caseId, { bytes: Buffer.from(sourceText), name: "synthetic-source.txt", mimeType: "text/plain", documentType: "source-extraction", idempotencyKey: randomUUID() });
  const input = { kind, expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, revisionIds: [revision.revisionId], synthetic: true, idempotencyKey: randomUUID() };
  return { ...item, revision, input, run: await service.requestAIRun(fixture.headers.deskA, item.caseId, input) };
}
test("extraction preserves exact source facts and requires an immutable current staff review", async () => {
  const item = await request();
  await worker!.executeAIRun(item.run.id, { extract: async () => ocr, generate: async () => modelFacts });
  let state = await service!.getCaseAI(fixture.headers.deskA, item.caseId);
  const run = state.runs.find((row) => row.id === item.run.id)!;
  assert.equal(run.status, "COMPLETE"); assert.equal(run.result?.facts[0].value, "100,000"); assert.equal(state.reviews.length, 0);
  const review = { runId: run.id, itemIndex: 0, action: "CORRECT", value: "100,001", reason: "Synthetic staff correction after checking the original", verified: true, expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, idempotencyKey: randomUUID() };
  await service!.reviewAIResult(fixture.headers.deskA, item.caseId, review);
  await service!.reviewAIResult(fixture.headers.deskA, item.caseId, review);
  state = await service!.getCaseAI(fixture.headers.deskA, item.caseId); assert.equal(state.reviews.length, 1); assert.equal(state.reviews[0].value, "100,001");
  await assert.rejects(service!.reviewAIResult(fixture.headers.deskB, item.caseId, review), { status: 404 });
  await assert.rejects(migrationPool.query("UPDATE ai_reviews SET reason='rewritten' WHERE id=$1", [state.reviews[0].id]));
});
test("duplicate requests are one run, while changed keys or unattested cloud requests fail", async () => {
  const item = await request();
  assert.deepEqual(await service!.requestAIRun(fixture.headers.deskA, item.caseId, item.input), item.run);
  await assert.rejects(service!.requestAIRun(fixture.headers.deskA, item.caseId, { ...item.input, revisionIds: [item.sources.policy] }), { status: 409 });
  await assert.rejects(service!.requestAIRun(fixture.headers.deskA, item.caseId, { ...item.input, idempotencyKey: randomUUID(), synthetic: false }), { status: 400 });
  await assert.rejects(service!.requestAIRun(fixture.headers.auditorA, item.caseId, { ...item.input, idempotencyKey: randomUUID() }), { status: 403 });
});
test("a saved OCR checkpoint survives model outage and resumes without repeating completed OCR", async () => {
  const item = await request(); let calls = 0;
  const dependencies = { extract: async () => { calls++; return ocr; }, generate: async () => { throw new Error("Private provider secret must not reach status"); } };
  await assert.rejects(worker!.executeAIRun(item.run.id, dependencies));
  await worker!.executeAIRun(item.run.id, { ...dependencies, generate: async () => modelFacts });
  assert.equal(calls, 1); const run = (await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs[0];
  assert.equal(run.status, "COMPLETE"); assert.equal(run.attempts, 2); assert.doesNotMatch(run.reason ?? "", /secret/);
  await worker!.executeAIRun(item.run.id, dependencies); assert.equal(calls, 1);
});
test("invented model facts fail review and never create financial authority", async () => {
  const item = await request();
  await worker!.executeAIRun(item.run.id, { extract: async () => ocr, generate: async () => ({ facts: [{ field: "bill_total", value: "9,999,999", pageNumber: 1, quote: "Final bill INR 100,000." }] }) });
  const run = (await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs[0]; assert.equal(run.status, "REVIEW_REQUIRED"); assert.equal(run.result, null);
  const records = await migrationPool.query("SELECT kind FROM claim_records WHERE claim_id=$1", [item.caseId]); assert.deepEqual(records.rows.map((row) => row.kind).sort(), ["assess", "bill"]);
});
test("changing source or staff authority during provider work blocks publishing and review", async () => {
  const item = await request();
  await worker!.executeAIRun(item.run.id, { extract: async () => { await uploadDocument(fixture.headers.deskA, item.caseId, { bytes: Buffer.from("Revised fictional source"), name: "synthetic-source.txt", mimeType: "text/plain", documentType: "source-extraction", documentId: item.revision.documentId, idempotencyKey: randomUUID() }); return ocr; }, generate: async () => modelFacts });
  assert.equal((await service!.getCaseAI(fixture.headers.deskA, item.caseId)).runs[0].status, "STALE");
  const next = await request();
  await migrationPool.query("UPDATE users SET status='INACTIVE' WHERE user_id=$1", [fixture.users.deskA.userId]);
  try { await worker!.executeAIRun(next.run.id, { extract: async () => ocr, generate: async () => modelFacts }); assert.equal((await migrationPool.query("SELECT status FROM ai_runs WHERE id=$1", [next.run.id])).rows[0].status, "DENIED"); }
  finally { await migrationPool.query("UPDATE users SET status='ACTIVE' WHERE user_id=$1", [fixture.users.deskA.userId]); }
});
