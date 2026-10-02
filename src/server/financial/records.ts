import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, type Actor } from "../access";
import { writeAudit } from "../audit";
import type { BillInput, Assessment, RuleInput } from "./rules";

export const caseIdSchema = z.string().regex(/^[1-9][0-9]{0,18}$/u).refine((id) => BigInt(id) <= 9223372036854775807n);
export type FinancialRecord<T = Record<string, unknown>> = { id: string; kind: string; caseVersion: number; actorId: string; occurredAt: string; recordedAt: string; payload: T };
export type BillRecord = FinancialRecord<{ bill: BillInput; sourceRevisionId: string; reductionRevisionId: string | null }>;
export type AssessmentRecord = FinancialRecord<{ billId: string; rule: RuleInput | null; result: Assessment; policyRevisionId: string; contextFingerprint: string }>;
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
export async function appendFinancialRecord(client: PoolClient, actor: Actor, current: { claim_id: string; branch_id: string; version: number }, kind: string,
  payload: unknown, key: string, hash: string, occurredAt = new Date().toISOString()): Promise<RecordResult> {
  const recordId = randomUUID(); const version = current.version + 1; const caseId = String(current.claim_id);
  await client.query("INSERT INTO claim_records(id,hospital_id,branch_id,claim_id,actor_user_id,kind,case_version,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [recordId, actor.hospitalId, current.branch_id, caseId, actor.userId, kind, version, occurredAt, JSON.stringify(payload)]);
  await client.query("UPDATE claims SET version=$1 WHERE claim_id=$2", [version, caseId]);
  await client.query("INSERT INTO claim_events(event_id,hospital_id,branch_id,claim_id,actor_user_id,event_type,occurred_at,payload,idempotency_key,fingerprint,case_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [recordId, actor.hospitalId, current.branch_id, caseId, actor.userId, `FINANCIAL_${kind.toUpperCase().replaceAll("-", "_")}`, occurredAt, JSON.stringify({ recordId, kind }), key, hash, version]);
  await writeAudit(client, actor, String(current.branch_id), "claims", kind.toUpperCase(), caseId, null, { recordId, version });
  return { caseId, version, recordId, idempotent: false };
}
