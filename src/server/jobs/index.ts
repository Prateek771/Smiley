import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, withActorTransaction } from "../access";
import { writeAudit } from "../audit";
import { caseIdSchema, fingerprint, scopedCase, recordsForCase, usableRecords, currentFinancial } from "../financial/records";
import { packState } from "../financial/submissions";
const requestSchema = z.object({ expectedVersion: z.number().int().positive(), packId: z.uuid(), idempotencyKey: z.string().min(8).max(100), retryOf: z.uuid().optional() }).strict();
export type JobDto = { id: string; ownerId: string; status: string; attempts: number; reason: string | null; result: { summary: string } | null; createdAt: string; updatedAt: string };
export async function jobsForCase(client: PoolClient, caseId: string): Promise<JobDto[]> {
  const result = await client.query(`SELECT id,actor_user_id::text AS "ownerId",status,attempts,reason,result,created_at AS "createdAt",updated_at AS "updatedAt" FROM case_jobs WHERE claim_id=$1 ORDER BY created_at DESC,id DESC`, [caseId]);
  return result.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
}
export async function getCaseJobs(headers: Headers, caseId: string) {
  if (!caseIdSchema.safeParse(caseId).success) throw new AccessError(400, "Choose a valid case.");
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => { await scopedCase(client, actor, caseId); return jobsForCase(client, caseId); });
}
export async function jobInputs(client: PoolClient, caseId: string, current: Record<string, unknown>) {
  const records = await usableRecords(client, caseId, current, await recordsForCase(client, caseId));
  const state = await packState(client, caseId, records); const { bill, assessment } = currentFinancial(records);
  return { packId: state.pack?.id, ready: state.packCurrent, fingerprint: fingerprint([current.version, bill?.id, assessment?.id, state.pack?.id, state.pack?.payload.sources]) };
}
export async function requestCaseJob(headers: Headers, caseId: string, input: unknown): Promise<{ id: string }> {
  const parsed = requestSchema.safeParse(input); if (!parsed.success || !caseIdSchema.safeParse(caseId).success) throw new AccessError(400, "Provide the current case version, reviewed pack and request key.");
  const value = parsed.data; const hash = fingerprint(value);
  return withActorTransaction(headers, "case:act", undefined, async (client, actor) => {
    const current = await scopedCase(client, actor, caseId, true);
    const old = await client.query("SELECT id,request_fingerprint FROM case_jobs WHERE claim_id=$1 AND idempotency_key=$2", [caseId, value.idempotencyKey]);
    if (old.rowCount) { if (old.rows[0].request_fingerprint !== hash) throw new AccessError(409, "This job request key was already used for different input."); return { id: old.rows[0].id }; }
    const state = await jobInputs(client, caseId, current);
    if (current.claim_status === "CANCELLED" || current.version !== value.expectedVersion || !state.ready || state.packId !== value.packId) throw new AccessError(409, "Review the current case and approved pack before requesting background review.");
    if (value.retryOf) {
      const failed = await client.query("SELECT status,actor_user_id::text AS owner FROM case_jobs WHERE id=$1 AND claim_id=$2", [value.retryOf, caseId]);
      if (!failed.rowCount || failed.rows[0].owner !== actor.userId || !["FAILED", "STALE", "DENIED"].includes(failed.rows[0].status)) throw new AccessError(409, "Only the active request owner can recover a stopped job.");
    }
    const id = randomUUID();
    await client.query("INSERT INTO case_jobs(id,hospital_id,branch_id,claim_id,actor_user_id,auth_owner_id,pack_id,input_version,input_fingerprint,request_fingerprint,idempotency_key,retry_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [id, actor.hospitalId, current.branch_id, caseId, actor.userId, actor.authUserId, value.packId, current.version, state.fingerprint, hash, value.idempotencyKey, value.retryOf ?? null]);
    await client.query("SELECT smiley_private.enqueue_case_job($1)", [id]);
    await writeAudit(client, actor, String(current.branch_id), "claims", "JOB_REQUESTED", caseId, null, { jobId: id, retryOf: value.retryOf ?? null });
    return { id };
  });
}
