import { z } from "zod";
import { hostname } from "node:os";
import { mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { runTaskList, type TaskList, type WorkerEvents, type WorkerPoolOptions } from "graphile-worker";
import { migrationPool } from "../server/db/client";
import { AccessError, withIdentityTransaction } from "../server/access";
import { scopedCase } from "../server/financial/records";
import { jobInputs } from "../server/jobs";
import { executeAIRun } from "./ai";
const terminal = ["COMPLETE", "FAILED", "STALE", "DENIED"];
export async function executeJob(id: string, review: () => Promise<{ summary: string }> = async () => ({ summary: "Current pack inputs remain valid. Human approval and external submission stay separate." }), queue?: { attempts: number; locked_by: string | null }) {
  z.uuid().parse(id); const client = await migrationPool.connect(); let retryFailure = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,23))", [id]);
    await client.query("BEGIN"); const result = await client.query("SELECT * FROM case_jobs WHERE id=$1 FOR UPDATE", [id]);
    if (!result.rowCount || terminal.includes(result.rows[0].status)) { await client.query("COMMIT"); return; }
    const job = result.rows[0]; const attempts = Math.max(job.attempts + 1, queue?.attempts ?? 0);
    await client.query("UPDATE case_jobs SET status='RUNNING',attempts=$2,worker_pid=$3,worker_host=$4,queue_worker_id=$5,updated_at=now() WHERE id=$1", [id, attempts, queue ? process.pid : null, queue ? hostname() : null, queue?.locked_by ?? null]);
    await client.query("COMMIT");
    try {
      const output = await withIdentityTransaction(job.auth_owner_id, "case:act", String(job.branch_id), async (business, actor) => {
        if (actor.hospitalId !== String(job.hospital_id) || actor.userId !== String(job.actor_user_id)) throw new AccessError(403, "Request ownership changed.");
        const current = await scopedCase(business, actor, String(job.claim_id), true); const state = await jobInputs(business, String(job.claim_id), current);
        if (current.claim_status === "CANCELLED" || !state.ready || state.packId !== job.pack_id || current.version !== job.input_version || state.fingerprint !== job.input_fingerprint) throw new AccessError(409, "Review current inputs before recovery.");
        return review();
      });
      await client.query("UPDATE case_jobs SET status='COMPLETE',result=$2,reason=NULL,updated_at=now() WHERE id=$1", [id, JSON.stringify(output)]);
    } catch (error) {
      const status = error instanceof AccessError ? error.status === 409 ? "STALE" : "DENIED" : attempts >= 3 ? "FAILED" : "RETRYING";
      const reason = status === "STALE" ? "Inputs changed. Review the current pack, then request recovery." : status === "DENIED" ? "Staff access or request ownership changed. Restore authorized access before recovery." : status === "FAILED" ? "Review failed after three attempts. The active request owner can recover it." : "Temporary review failure. The queue will retry within its three-attempt limit.";
      await client.query("UPDATE case_jobs SET status=$2,reason=$3,updated_at=now() WHERE id=$1", [id, status, reason]); retryFailure = status === "RETRYING" || status === "FAILED";
    }
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,23))", [id]); client.release(); }
  if (retryFailure) throw new Error("Background review failed; see the sanitized case job status.");
}
export const taskList: TaskList = {
  "pack-review": async (payload, helpers) => { const value = z.object({ requestId: z.uuid() }).strict().parse(payload); await executeJob(value.requestId, undefined, helpers.job); },
  "ai-review": async (payload, helpers) => { const value = z.object({ requestId: z.uuid() }).strict().parse(payload); await executeAIRun(value.requestId, { signal: helpers.abortSignal }, helpers.job); },
};

const registry = join(process.cwd(), "tmp", "worker-instances");
export function startRegisteredWorker(options: WorkerPoolOptions = {}, tasks: TaskList = taskList) {
  mkdirSync(registry, { recursive: true }); const events = new EventEmitter() as WorkerEvents; let registrationFailure: unknown;
  // Graphile emits pool:create synchronously before fetching jobs. Queue locks use the pool ID.
  events.once("pool:create", ({ workerPool }) => {
    try {
      const fd = openSync(join(registry, `${workerPool.id}.json`), "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ queueWorkerId: workerPool.id, pid: process.pid, host: hostname() })); fsyncSync(fd); } finally { closeSync(fd); }
    } catch (error) { registrationFailure = error; }
  });
  const worker = runTaskList({ ...options, events }, tasks, migrationPool);
  if (registrationFailure) { void worker.gracefulShutdown(); throw new Error("Worker identity could not be persisted before queue delivery."); }
  return worker;
}

export async function recoverStoppedWorkers() {
  const jobs = await migrationPool.query("SELECT DISTINCT j.locked_by AS queue_worker_id FROM graphile_worker._private_jobs j JOIN graphile_worker._private_tasks t ON t.id=j.task_id WHERE t.identifier IN ('pack-review','ai-review') AND j.locked_by IS NOT NULL");
  for (const row of jobs.rows) {
    if (!/^pool-[a-f0-9]{18}$/u.test(row.queue_worker_id)) continue;
    let identity: { queueWorkerId: string; pid: number; host: string };
    try { identity = JSON.parse(readFileSync(join(registry, `${row.queue_worker_id}.json`), "utf8")); } catch { continue; }
    if (identity.queueWorkerId !== row.queue_worker_id || identity.host !== hostname() || !Number.isInteger(identity.pid) || identity.pid <= 0) continue;
    let dead = false;
    try { process.kill(identity.pid, 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    if (!dead) continue; // Permission denial and reused live PIDs are never evidence that a worker stopped.
    const client = await migrationPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,27))", [row.queue_worker_id]);
      const deliveries = await client.query("SELECT j.payload->>'requestId' AS id,j.attempts,t.identifier FROM graphile_worker._private_jobs j JOIN graphile_worker._private_tasks t ON t.id=j.task_id WHERE j.locked_by=$1 AND t.identifier IN ('pack-review','ai-review') FOR UPDATE OF j", [row.queue_worker_id]);
      if (deliveries.rowCount) {
        for (const delivery of deliveries.rows) {
          if (!z.uuid().safeParse(delivery.id).success) continue;
          const table = delivery.identifier === "ai-review" ? "ai_runs" : "case_jobs";
          await client.query(`UPDATE ${table} SET attempts=greatest(attempts,$2),status=CASE WHEN greatest(attempts,$2)>=3 THEN 'FAILED' ELSE 'RETRYING' END,reason=CASE WHEN greatest(attempts,$2)>=3 THEN 'The worker stopped after three deliveries. The active owner can recover the review.' ELSE 'The stopped local worker was recovered. A new worker will resume this review.' END,updated_at=now() WHERE id=$1 AND status NOT IN ('COMPLETE','FAILED','STALE','DENIED','REVIEW_REQUIRED')`, [delivery.id, Math.min(3, delivery.attempts)]);
        }
        await client.query("SELECT graphile_worker.force_unlock_workers($1::text[])", [[row.queue_worker_id]]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
