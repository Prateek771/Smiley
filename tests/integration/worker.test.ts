import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { runTaskList } from "graphile-worker";
import { closePools, migrationPool } from "../../src/server/db/client";
import { getCase } from "../../src/server/cases";
import { getCaseJobs, requestCaseJob } from "../../src/server/jobs";
import { executeJob, taskList, recoverStoppedWorkers } from "../../src/worker/tasks";
import { workflowFixture, syntheticBill } from "../helpers/workflow";
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
before(async () => { fixture = await workflowFixture(); await migrationPool.query("DELETE FROM graphile_worker._private_jobs"); }); after(closePools);
async function enqueue(item: Awaited<ReturnType<typeof fixture.approvedCase>>) {
  return requestCaseJob(fixture.headers.deskA, item.caseId, { expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, packId: item.pack.recordId, idempotencyKey: randomUUID() });
}
test("a queued request survives a stopped worker; restarting processes it once and duplicate delivery has no effect", async () => {
  const item = await fixture.approvedCase(); const request = await enqueue(item);
  assert.equal((await getCaseJobs(fixture.headers.deskA, item.caseId))[0].status, "QUEUED");
  const worker = runTaskList({ noHandleSignals: true, concurrency: 1, pollInterval: 100 }, taskList, migrationPool);
  try { for (let i = 0; i < 100; i++) { if ((await getCaseJobs(fixture.headers.deskA, item.caseId))[0].status === "COMPLETE") break; await new Promise((resolve) => setTimeout(resolve, 50)); } } finally { await worker.gracefulShutdown(); }
  const completed = (await getCaseJobs(fixture.headers.deskA, item.caseId))[0]; assert.equal(completed.status, "COMPLETE"); assert.equal(completed.attempts, 1);
  await executeJob(request.id); assert.deepEqual((await getCaseJobs(fixture.headers.deskA, item.caseId))[0], completed);
});
test("stale inputs and revoked staff context block background work; retryable failures stop after three attempts and owner can recover", async () => {
  const staleCase = await fixture.approvedCase(); const stale = await enqueue(staleCase);
  await staleCase.act("billingA", { type: "bill", bill: syntheticBill, sourceRevisionId: staleCase.sources["final-bill"], reductionRevisionId: staleCase.sources["approved-hospital-reduction"], verified: true });
  await executeJob(stale.id); assert.equal((await getCaseJobs(fixture.headers.deskA, staleCase.caseId))[0].status, "STALE");
  const item = await fixture.approvedCase(); const job = await enqueue(item);
  const providerFailure = async () => { throw new Error("Private provider secret must never enter user-facing status"); };
  for (let i = 0; i < 3; i++) await assert.rejects(executeJob(job.id, providerFailure), /Background review failed/u);
  const failed = (await getCaseJobs(fixture.headers.deskA, item.caseId))[0]; assert.equal(failed.status, "FAILED"); assert.equal(failed.attempts, 3); assert.doesNotMatch(failed.reason ?? "", /secret/u);
  const recovered = await requestCaseJob(fixture.headers.deskA, item.caseId, { expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, packId: item.pack.recordId, idempotencyKey: randomUUID(), retryOf: job.id });
  await executeJob(recovered.id); assert.equal((await getCaseJobs(fixture.headers.deskA, item.caseId))[0].status, "COMPLETE");
  const denied = await enqueue(item);
  await migrationPool.query("UPDATE users SET status='INACTIVE' WHERE user_id=$1", [fixture.users.deskA.userId]);
  try { await executeJob(denied.id); assert.equal((await migrationPool.query("SELECT status FROM case_jobs WHERE id=$1", [denied.id])).rows[0].status, "DENIED"); }
  finally { await migrationPool.query("UPDATE users SET status='ACTIVE' WHERE user_id=$1", [fixture.users.deskA.userId]); }
  await assert.rejects(getCaseJobs(fixture.headers.deskB, item.caseId), { status: 404 });
});

test("graceful interruption during a review releases the durable job and a new worker resumes safely", async () => {
  const item = await fixture.approvedCase(); const job = await enqueue(item);
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  const interrupted = runTaskList({ noHandleSignals: true, concurrency: 1, pollInterval: 100, gracefulShutdownAbortTimeout: 1 }, { "pack-review": async (payload, helpers) => {
    const id = (payload as { requestId: string }).requestId;
    await executeJob(id, async () => new Promise((_, reject) => { entered(); helpers.abortSignal.addEventListener("abort", () => reject(new Error("Interrupted review")), { once: true }); }));
  } }, migrationPool);
  await started; await interrupted.gracefulShutdown();
  const next = runTaskList({ noHandleSignals: true, concurrency: 1, pollInterval: 100 }, taskList, migrationPool);
  try { for (let i = 0; i < 200; i++) { if ((await getCaseJobs(fixture.headers.deskA, item.caseId))[0].status === "COMPLETE") break; await new Promise((resolve) => setTimeout(resolve, 50)); } } finally { await next.gracefulShutdown(); }
  const completed = (await getCaseJobs(fixture.headers.deskA, item.caseId))[0]; assert.equal(completed.id, job.id); assert.equal(completed.status, "COMPLETE"); assert.equal(completed.attempts, 2);
});

test("three hard process crashes persist attempts and safely enable owner recovery without unlocking a live worker", async () => {
  const item = await fixture.approvedCase(); const job = await enqueue(item);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const child = spawn(process.execPath, ["--import", "tsx", "tests/helpers/crashing-worker.ts"], { env: { ...process.env, NODE_ENV: "test" }, stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Crash fixture did not enter the requested job.")), 15000); child.on("message", (message) => { if ((message as { entered?: string }).entered === job.id) { clearTimeout(timer); resolve(); } }); child.once("error", reject); });
      await recoverStoppedWorkers();
      assert.equal((await getCaseJobs(fixture.headers.deskA, item.caseId))[0].status, "RUNNING");
    } finally { child.kill("SIGKILL"); await exited; }
    await recoverStoppedWorkers();
    const state = (await getCaseJobs(fixture.headers.deskA, item.caseId))[0]; assert.equal(state.attempts, attempt); assert.equal(state.status, attempt === 3 ? "FAILED" : "RETRYING");
  }
  const recovered = await requestCaseJob(fixture.headers.deskA, item.caseId, { expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, packId: item.pack.recordId, idempotencyKey: randomUUID(), retryOf: job.id });
  await executeJob(recovered.id); assert.equal((await getCaseJobs(fixture.headers.deskA, item.caseId))[0].status, "COMPLETE");
});

test("a pre-registration hard stop while the request row is locked remains recoverable", async () => {
  const item = await fixture.approvedCase(); const job = await enqueue(item); const prefetched = await enqueue(item); const blocker = await migrationPool.connect();
  await blocker.query("BEGIN"); await blocker.query("SELECT id FROM case_jobs WHERE id=$1 FOR UPDATE", [job.id]);
  const child = spawn(process.execPath, ["--import", "tsx", "tests/helpers/crashing-worker.ts"], { env: { ...process.env, NODE_ENV: "test" }, stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    let fetched = false;
    for (let i = 0; i < 200; i++) { const queue = await migrationPool.query("SELECT locked_by FROM graphile_worker._private_jobs WHERE payload->>'requestId'=ANY($1::text[])", [[job.id, prefetched.id]]); if (queue.rows.length === 2 && queue.rows.every((row) => row.locked_by)) { fetched = true; break; } await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.equal(fetched, true);
  } finally { child.kill("SIGKILL"); await exited; await blocker.query("ROLLBACK"); blocker.release(); }
  await recoverStoppedWorkers();
  const states = await getCaseJobs(fixture.headers.deskA, item.caseId); for (const id of [job.id, prefetched.id]) { const state = states.find((row) => row.id === id)!; assert.equal(state.status, "RETRYING"); assert.equal(state.attempts, 1); }
});
