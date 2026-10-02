import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, withActorTransaction, type Actor } from "../access";
import { writeAudit } from "../audit";
import { caseIdSchema, fingerprint, scopedCase, requireRevision, recordsForCase, usableRecords } from "./records";
import { patientState } from "./decisions";
import { money, sumPaise } from "./rules";
const evidence = { evidenceCaseId: caseIdSchema, evidenceRevisionId: z.uuid(), reference: z.string().trim().min(1).max(150), occurredAt: z.iso.datetime({ offset: true }).refine((value) => new Date(value).getTime() <= Date.now() + 300000), idempotencyKey: z.string().min(8).max(100), verified: z.literal(true) };
const receiptSchema = z.object({ ...evidence, amountPaise: money.refine((value) => value > 0), allocations: z.array(z.object({ caseId: caseIdSchema, decisionId: z.uuid(), amountPaise: money.refine((value) => value > 0) }).strict()).max(100).refine((rows) => new Set(rows.map((row) => row.caseId)).size === rows.length) }).strict();
const reversalSchema = z.object({ ...evidence, receiptId: z.uuid() }).strict();
async function event(client: PoolClient, actor: Actor, claim: { claim_id: string; branch_id: string; version: number }, receiptId: string, reversing: boolean, occurredAt: string) {
  const id = randomUUID(); const version = claim.version + 1;
  await client.query("UPDATE claims SET version=$1 WHERE claim_id=$2", [version, claim.claim_id]);
  await client.query("INSERT INTO claim_events(event_id,hospital_id,branch_id,claim_id,actor_user_id,event_type,payload,idempotency_key,fingerprint,case_version,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [id, actor.hospitalId, claim.branch_id, claim.claim_id, actor.userId, reversing ? "REMITTANCE_REVERSED" : "REMITTANCE_RECORDED", JSON.stringify({ receiptId }), `${receiptId}:${claim.claim_id}`, fingerprint({ receiptId, reversing }), version, occurredAt]);
  await writeAudit(client, actor, String(claim.branch_id), "claims", reversing ? "REMITTANCE_REVERSED" : "REMITTANCE_RECORDED", String(claim.claim_id), null, { receiptId, version });
}
// ponytail: serialize imports per branch; use ordered reference locks if Finance throughput demands it.
async function branchLock(client: PoolClient, hospitalId: string, branchId: string) { await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,19))", [`${hospitalId}:${branchId}`]); }
function amountNumber(value: string) { const result = BigInt(value); if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new AccessError(400, "The reconciliation exceeds supported monetary precision."); return Number(result); }
export async function settlementState(client: PoolClient, caseId: string, authorizedPaise: number | null) {
  const net = await client.query("SELECT coalesce(sum(a.amount_paise),0)::text AS amount FROM remittance_allocations a WHERE a.claim_id=$1 AND NOT EXISTS(SELECT 1 FROM remittance_reversals x WHERE x.receipt_id=a.receipt_id)", [caseId]);
  const netReceivedPaise = amountNumber(net.rows[0].amount);
  const receipts = await client.query(`SELECT r.id,r.reference,r.amount_paise::text AS amount,r.occurred_at,r.recorded_at,
    EXISTS(SELECT 1 FROM remittance_reversals x WHERE x.receipt_id=r.id) AS reversed,
    (r.amount_paise-coalesce((SELECT sum(a.amount_paise) FROM remittance_allocations a WHERE a.receipt_id=r.id),0))::text AS unallocated
    FROM remittance_receipts r WHERE r.evidence_case_id=$1 OR EXISTS(SELECT 1 FROM remittance_allocations a WHERE a.receipt_id=r.id AND a.claim_id=$1) ORDER BY r.recorded_at DESC`, [caseId]);
  return { netReceivedPaise, receivablePaise: authorizedPaise === null ? null : Math.max(authorizedPaise - netReceivedPaise, 0), overpaidPaise: authorizedPaise === null ? null : Math.max(netReceivedPaise - authorizedPaise, 0),
    remittances: receipts.rows.map((row) => ({ id: String(row.id), reference: String(row.reference), amountPaise: amountNumber(row.amount), unallocatedPaise: row.reversed ? 0 : amountNumber(row.unallocated), reversed: !!row.reversed, occurredAt: row.occurred_at.toISOString(), recordedAt: row.recorded_at.toISOString() })) };
}
export async function recordRemittance(headers: Headers, input: unknown): Promise<{ id: string }> {
  const parsed = receiptSchema.safeParse(input); if (!parsed.success) throw new AccessError(400, "Provide a verified remittance amount, reference, evidence and allocations.");
  const value = parsed.data; const hash = fingerprint(value);
  if (sumPaise(value.allocations.map((row) => row.amountPaise)) > value.amountPaise) throw new AccessError(400, "Allocations exceed the remittance receipt.");
  return withActorTransaction(headers, "finance:write", undefined, async (client, actor) => {
    const source = await scopedCase(client, actor, value.evidenceCaseId); const branchId = String(source.branch_id);
    await branchLock(client, actor.hospitalId, branchId);
    const existing = await client.query("SELECT id,fingerprint,idempotency_key FROM remittance_receipts WHERE hospital_id=$1 AND branch_id=$2 AND (idempotency_key=$3 OR reference=$4)", [actor.hospitalId, branchId, value.idempotencyKey, value.reference]);
    if (existing.rowCount) { if (existing.rows[0].idempotency_key !== value.idempotencyKey || existing.rows[0].fingerprint !== hash) throw new AccessError(409, "This remittance reference or request key is already recorded."); return { id: existing.rows[0].id }; }
    await requireRevision(client, value.evidenceCaseId, value.evidenceRevisionId, "bank-remittance");
    const claims = new Map<string, Awaited<ReturnType<typeof scopedCase>>>();
    for (const id of [...new Set([value.evidenceCaseId, ...value.allocations.map((row) => row.caseId)])].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)) {
      const current = await scopedCase(client, actor, id, true); if (String(current.branch_id) !== branchId || current.claim_status === "CANCELLED") throw new AccessError(409, "All allocations must belong to active cases in the evidence branch."); claims.set(id, current);
    }
    for (const allocation of value.allocations) {
      const current = claims.get(allocation.caseId)!;
      const records = await usableRecords(client, allocation.caseId, current, await recordsForCase(client, allocation.caseId));
      const state = await patientState(client, allocation.caseId, records);
      if (!state.decision || state.decision.id !== allocation.decisionId || state.authorizedPaise === null) throw new AccessError(409, "Every allocation requires the current final payer decision.");
      sumPaise([(await settlementState(client, allocation.caseId, state.authorizedPaise)).netReceivedPaise, allocation.amountPaise]);
    }
    const id = randomUUID();
    await client.query("INSERT INTO remittance_receipts(id,hospital_id,branch_id,evidence_case_id,evidence_revision_id,actor_user_id,amount_paise,reference,idempotency_key,fingerprint,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [id, actor.hospitalId, branchId, value.evidenceCaseId, value.evidenceRevisionId, actor.userId, value.amountPaise, value.reference, value.idempotencyKey, hash, value.occurredAt]);
    for (const allocation of value.allocations) await client.query("INSERT INTO remittance_allocations(id,hospital_id,branch_id,receipt_id,claim_id,decision_id,amount_paise) VALUES($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), actor.hospitalId, branchId, id, allocation.caseId, allocation.decisionId, allocation.amountPaise]);
    for (const claim of claims.values()) await event(client, actor, claim, id, false, value.occurredAt);
    return { id };
  });
}
export async function reverseRemittance(headers: Headers, input: unknown): Promise<{ id: string }> {
  const parsed = reversalSchema.safeParse(input); if (!parsed.success) throw new AccessError(400, "Provide the original receipt and verified reversal evidence.");
  const value = parsed.data; const hash = fingerprint(value);
  return withActorTransaction(headers, "finance:write", undefined, async (client, actor) => {
    const source = await scopedCase(client, actor, value.evidenceCaseId); const branchId = String(source.branch_id); await branchLock(client, actor.hospitalId, branchId);
    const receipt = await client.query("SELECT evidence_case_id::text FROM remittance_receipts WHERE id=$1 AND hospital_id=$2 AND branch_id=$3", [value.receiptId, actor.hospitalId, branchId]);
    if (!receipt.rowCount) throw new AccessError(404, "The original remittance is outside your assigned scope.");
    const old = await client.query("SELECT id,idempotency_key,fingerprint FROM remittance_reversals WHERE hospital_id=$1 AND branch_id=$2 AND (receipt_id=$3 OR idempotency_key=$4 OR reference=$5)", [actor.hospitalId, branchId, value.receiptId, value.idempotencyKey, value.reference]);
    if (old.rowCount) { if (old.rows[0].idempotency_key !== value.idempotencyKey || old.rows[0].fingerprint !== hash) throw new AccessError(409, "This receipt was already reversed or the reversal key/reference was used."); return { id: old.rows[0].id }; }
    await requireRevision(client, value.evidenceCaseId, value.evidenceRevisionId, "bank-remittance");
    const affected = await client.query("SELECT claim_id::text FROM remittance_allocations WHERE receipt_id=$1", [value.receiptId]);
    const claims = [];
    for (const id of [...new Set([receipt.rows[0].evidence_case_id, value.evidenceCaseId, ...affected.rows.map((row) => row.claim_id)])].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)) claims.push(await scopedCase(client, actor, id, true));
    const id = randomUUID(); await client.query("INSERT INTO remittance_reversals(id,hospital_id,branch_id,receipt_id,evidence_case_id,evidence_revision_id,actor_user_id,reference,idempotency_key,fingerprint,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [id, actor.hospitalId, branchId, value.receiptId, value.evidenceCaseId, value.evidenceRevisionId, actor.userId, value.reference, value.idempotencyKey, hash, value.occurredAt]);
    for (const claim of claims) await event(client, actor, claim, id, true, value.occurredAt);
    return { id };
  });
}
