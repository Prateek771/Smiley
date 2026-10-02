import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, withActorTransaction, type Actor } from "../access";
import { branchScope, type Permission } from "../access/permissions";
import { writeAudit } from "../audit";
import { assessBill, billSchema, ruleSchema, type BillInput, type Assessment, type RuleInput } from "./rules";
import { submissionActions, prepareSubmission, packState, type PackRecord } from "./submissions";

export const caseIdSchema = z.string().regex(/^[1-9][0-9]{0,18}$/u).refine((id) => BigInt(id) <= 9223372036854775807n);
const verified = z.literal(true);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bill"), bill: billSchema, sourceRevisionId: z.uuid(), reductionRevisionId: z.uuid().nullable(), verified }).strict(),
  z.object({ type: z.literal("assess"), billId: z.uuid(), rule: ruleSchema.nullable(), policyRevisionId: z.uuid(), verified }).strict(),
  ...submissionActions,
]);
const requestSchema = z.object({ expectedVersion: z.number().int().positive().max(2147483646), idempotencyKey: z.string().min(8).max(100), action: actionSchema }).strict();
export type FinancialRecord<T = Record<string, unknown>> = { id: string; kind: string; caseVersion: number; actorId: string; occurredAt: string; recordedAt: string; payload: T };
type BillRecord = FinancialRecord<{ bill: BillInput; sourceRevisionId: string; reductionRevisionId: string | null }>;
type AssessmentRecord = FinancialRecord<{ billId: string; rule: RuleInput | null; result: Assessment; policyRevisionId: string; contextFingerprint: string }>;
export type FinancialCase = { caseId: string; version: number; bill: BillRecord | null; assessment: AssessmentRecord | null; records: FinancialRecord[];
  canBill: boolean; canDesk: boolean; canFinance: boolean; patientConfirmedPaise: number | null; pack: PackRecord | null; packCurrent: boolean;
  queries: { reference: string; status: string; responseEventId: string | null; responseAckCurrent: boolean }[] };
export type RecordResult = { caseId: string; version: number; recordId: string; idempotent: boolean };
export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function scopedCase(client: PoolClient, actor: Actor, caseId: string, lock = false) {
  const result = await client.query(`SELECT c.*,pi.valid_from,pi.valid_to,pi.policy_id FROM claims c JOIN patient_insurance pi ON pi.patient_insurance_id=c.patient_insurance_id AND pi.hospital_id=c.hospital_id WHERE c.claim_id=$1 AND c.hospital_id=$2 ${lock ? "FOR UPDATE OF c" : ""}`, [caseId, actor.hospitalId]);
  if (!result.rowCount) throw new AccessError(404, "The case is unavailable in your hospital or assigned branches.");
  return result.rows[0];
}
export async function recordsForCase(client: PoolClient, caseId: string): Promise<FinancialRecord[]> {
  const result = await client.query(`SELECT id,kind,case_version AS "caseVersion",actor_user_id::text AS "actorId",occurred_at AS "occurredAt",recorded_at AS "recordedAt",payload FROM claim_records WHERE claim_id=$1 ORDER BY case_version DESC`, [caseId]);
  return result.rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString(), recordedAt: row.recordedAt.toISOString() }));
}
export function currentFinancial(records: FinancialRecord[]) {
  const bill = (records.find((row) => row.kind === "bill") ?? null) as BillRecord | null;
  const assessment = (records.find((row) => row.kind === "assess" && row.payload.billId === bill?.id) ?? null) as AssessmentRecord | null;
  return { bill, assessment };
}
export async function requireRevision(client: PoolClient, caseId: string, revisionId: string, documentType?: string): Promise<{ document_id: string; document_type: string }> {
  const revision = await client.query(`SELECT r.claim_document_id::text AS document_id, d.document_type FROM document_revisions r JOIN claim_documents d ON d.claim_document_id=r.claim_document_id AND d.hospital_id=r.hospital_id AND d.branch_id=r.branch_id AND d.claim_id=r.claim_id WHERE r.revision_id=$1 AND r.claim_id=$2`, [revisionId, caseId]);
  if (!revision.rowCount) throw new AccessError(400, "Choose an evidence revision belonging to this case and branch.");
  if (documentType && revision.rows[0].document_type !== documentType) throw new AccessError(400, `Choose evidence with purpose ${documentType}.`);
  return revision.rows[0];
}
export const policyContext = (current: Record<string, unknown>) => fingerprint([current.patient_insurance_id, current.policy_id, current.valid_from, current.valid_to]);
export async function usableRecords(client: PoolClient, caseId: string, current: Record<string, unknown>, records: FinancialRecord[]) {
  const { bill, assessment } = currentFinancial(records);
  let valid = !!assessment && assessment.payload.contextFingerprint === policyContext(current);
  if (valid && bill && assessment) {
    for (const id of [bill.payload.sourceRevisionId, assessment.payload.policyRevisionId, ...(bill.payload.reductionRevisionId ? [bill.payload.reductionRevisionId] : [])]) {
      const latest = await client.query("SELECT revision_id FROM document_revisions WHERE claim_id=$1 AND claim_document_id=(SELECT claim_document_id FROM document_revisions WHERE revision_id=$2) ORDER BY revision_number DESC LIMIT 1", [caseId, id]);
      if (latest.rows[0]?.revision_id !== id) { valid = false; break; }
    }
  }
  return valid ? records : records.filter((row) => row.kind !== "assess");
}
export async function getFinancialCase(headers: Headers, caseId: string): Promise<FinancialCase> {
  if (!caseIdSchema.safeParse(caseId).success) throw new AccessError(400, "Provide a valid case ID.");
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => {
    const current = await scopedCase(client, actor, caseId); const records = await recordsForCase(client, caseId);
    const usable = await usableRecords(client, caseId, current, records);
    const queries = await client.query(`SELECT q.external_reference AS reference,q.status,(SELECT e.event_id FROM claim_events e WHERE e.claim_id=q.claim_id AND e.event_type='QUERY_RESPONSE_PREPARED' AND e.payload->'action'->>'reference'=q.external_reference ORDER BY e.case_version DESC LIMIT 1) AS "responseEventId" FROM claim_queries q WHERE q.claim_id=$1 ORDER BY q.query_id`, [caseId]);
    return { caseId, version: current.version, ...currentFinancial(usable), ...await packState(client, caseId, usable), records, patientConfirmedPaise: null,
      queries: queries.rows.map((query) => ({ ...query, responseAckCurrent: records.find((row) => row.kind === "query-ack" && row.payload.queryReference === query.reference)?.payload.responseEventId === query.responseEventId && !!query.responseEventId })),
      canBill: branchScope(actor, "billing:write").includes(String(current.branch_id)), canDesk: branchScope(actor, "case:act").includes(String(current.branch_id)), canFinance: branchScope(actor, "finance:write").includes(String(current.branch_id)) };
  });
}
export async function appendFinancialRecord(client: PoolClient, actor: Actor, current: { claim_id: string; branch_id: string; version: number }, kind: string,
  payload: unknown, key: string, hash: string, occurredAt = new Date().toISOString()): Promise<RecordResult> {
  const recordId = randomUUID(); const version = current.version + 1; const caseId = String(current.claim_id);
  await client.query("INSERT INTO claim_records(id,hospital_id,branch_id,claim_id,actor_user_id,kind,case_version,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [recordId, actor.hospitalId, current.branch_id, caseId, actor.userId, kind, version, occurredAt, JSON.stringify(payload)]);
  await client.query("UPDATE claims SET version=$1 WHERE claim_id=$2", [version, caseId]);
  await client.query("INSERT INTO claim_events(event_id,hospital_id,branch_id,claim_id,actor_user_id,event_type,occurred_at,payload,idempotency_key,fingerprint,case_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [recordId, actor.hospitalId, current.branch_id, caseId, actor.userId, `FINANCIAL_${kind.toUpperCase().replaceAll("-", "_")}`, occurredAt, JSON.stringify({ recordId, kind }), key, hash, version]);
  await writeAudit(client, actor, String(current.branch_id), "claims", kind.toUpperCase(), caseId, null, { recordId, version });
  return { caseId, version, recordId, idempotent: false };
}
export async function applyFinancialAction(headers: Headers, caseId: string, input: unknown): Promise<RecordResult> {
  const parsed = requestSchema.safeParse(input);
  if (!caseIdSchema.safeParse(caseId).success || !parsed.success) throw new AccessError(400, "Provide a supported financial action, evidence, current version and request key.");
  const value = parsed.data; const action = value.action; const hash = fingerprint(value);
  const permission: Permission = ["bill", "assess"].includes(action.type) ? "billing:write" : "case:act";
  return withActorTransaction(headers, permission, undefined, async (client, actor) => {
    const current = await scopedCase(client, actor, caseId, true);
    if (!branchScope(actor, permission).includes(String(current.branch_id))) throw new AccessError(403, "This financial action is outside your branch permissions.");
    const old = await client.query("SELECT event_id,fingerprint,case_version FROM claim_events WHERE claim_id=$1 AND idempotency_key=$2", [caseId, value.idempotencyKey]);
    if (old.rowCount) {
      if (old.rows[0].fingerprint !== hash) throw new AccessError(409, "This request key was already used for different information.");
      return { caseId, recordId: old.rows[0].event_id, version: old.rows[0].case_version, idempotent: true };
    }
    if (current.version !== value.expectedVersion) throw new AccessError(409, "The case changed. Reload and review before saving.");
    if (current.claim_status === "CANCELLED") throw new AccessError(409, "This case is cancelled.");
    let payload: unknown;
    if (action.type === "bill") {
      try { assessBill(action.bill, null); } catch { throw new AccessError(400, "Bill amounts must be exact paise with non-overlapping exclusions and reductions."); }
      await requireRevision(client, caseId, action.sourceRevisionId, "final-bill");
      if (action.bill.lines.some((line) => line.reductionPaise > 0)) {
        if (!action.reductionRevisionId) throw new AccessError(400, "A nonzero hospital reduction requires its approval evidence.");
        await requireRevision(client, caseId, action.reductionRevisionId, "approved-hospital-reduction");
      }
      payload = action;
    } else if (action.type === "assess") {
      const { bill } = currentFinancial(await recordsForCase(client, caseId));
      if (!bill || bill.id !== action.billId) throw new AccessError(409, "Choose the current bill revision before assessment.");
      await requireRevision(client, caseId, action.policyRevisionId, "policy");
      let result: Assessment;
      try { result = assessBill(bill.payload.bill, action.rule); } catch { throw new AccessError(400, "The rule and monetary values are invalid."); }
      if (!current.valid_from || !current.valid_to || bill.payload.bill.serviceDate < current.valid_from || bill.payload.bill.serviceDate > current.valid_to) {
        result = { ...result, status: "NEEDS_REVIEW", blocks: [...result.blocks, "The registered policy coverage dates do not cover this service date."], insurerPaise: null, patientPaise: null };
      }
      payload = { ...action, result, contextFingerprint: policyContext(current) };
    } else {
      payload = await prepareSubmission(client, caseId, action, await usableRecords(client, caseId, current, await recordsForCase(client, caseId)));
    }
    return appendFinancialRecord(client, actor, current, action.type, payload, value.idempotencyKey, hash, "occurredAt" in action ? action.occurredAt : undefined);
  });
}
