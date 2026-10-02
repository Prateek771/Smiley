import { z } from "zod";
import { AccessError, withActorTransaction } from "../access";
import { branchScope, type Permission } from "../access/permissions";
import { assessBill, billSchema, ruleSchema, type Assessment } from "./rules";
import { submissionActions, prepareSubmission, packState, type PackRecord } from "./submissions";
import { decisionActions, prepareDecision, patientState } from "./decisions";
import { settlementState } from "./settlement";
import { caseIdSchema, scopedCase, recordsForCase, currentFinancial, requireRevision, usableRecords, policyContext, fingerprint, appendFinancialRecord, type RecordResult, type FinancialRecord, type BillRecord, type AssessmentRecord } from "./records";
export type { FinancialRecord, RecordResult } from "./records";
const verified = z.literal(true);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bill"), bill: billSchema, sourceRevisionId: z.uuid(), reductionRevisionId: z.uuid().nullable(), verified }).strict(),
  z.object({ type: z.literal("assess"), billId: z.uuid(), rule: ruleSchema.nullable(), policyRevisionId: z.uuid(), verified }).strict(),
  ...submissionActions,
  ...decisionActions,
]);
const requestSchema = z.object({ expectedVersion: z.number().int().positive().max(2147483646), idempotencyKey: z.string().min(8).max(100), action: actionSchema }).strict();
export type FinancialCase = Awaited<ReturnType<typeof patientState>> & Awaited<ReturnType<typeof settlementState>> & { caseId: string; version: number; bill: BillRecord | null; assessment: AssessmentRecord | null; records: FinancialRecord[];
  canBill: boolean; canDesk: boolean; canFinance: boolean; patientConfirmedPaise: number | null; pack: PackRecord | null; packCurrent: boolean;
  queries: { reference: string; status: string; responseEventId: string | null; responseAckCurrent: boolean }[] };
export async function getFinancialCase(headers: Headers, caseId: string): Promise<FinancialCase> {
  if (!caseIdSchema.safeParse(caseId).success) throw new AccessError(400, "Provide a valid case ID.");
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => {
    const current = await scopedCase(client, actor, caseId); const records = await recordsForCase(client, caseId);
    const usable = await usableRecords(client, caseId, current, records);
    const patient = await patientState(client, caseId, usable);
    const queries = await client.query(`SELECT q.external_reference AS reference,q.status,(SELECT e.event_id FROM claim_events e WHERE e.claim_id=q.claim_id AND e.event_type='QUERY_RESPONSE_PREPARED' AND e.payload->'action'->>'reference'=q.external_reference ORDER BY e.case_version DESC LIMIT 1) AS "responseEventId" FROM claim_queries q WHERE q.claim_id=$1 ORDER BY q.query_id`, [caseId]);
    return { caseId, version: current.version, ...currentFinancial(usable), ...await packState(client, caseId, usable), ...patient, ...await settlementState(client, caseId, patient.authorizedPaise), records,
      queries: queries.rows.map((query) => ({ ...query, responseAckCurrent: records.find((row) => row.kind === "query-ack" && row.payload.queryReference === query.reference)?.payload.responseEventId === query.responseEventId && !!query.responseEventId })),
      canBill: branchScope(actor, "billing:write").includes(String(current.branch_id)), canDesk: branchScope(actor, "case:act").includes(String(current.branch_id)), canFinance: branchScope(actor, "finance:write").includes(String(current.branch_id)) };
  });
}
export async function applyFinancialAction(headers: Headers, caseId: string, input: unknown): Promise<RecordResult> {
  const parsed = requestSchema.safeParse(input);
  if (!caseIdSchema.safeParse(caseId).success || !parsed.success) throw new AccessError(400, "Provide a supported financial action, evidence, current version and request key.");
  const value = parsed.data; const action = value.action; const hash = fingerprint(value);
  const permission: Permission = ["bill", "assess", "confirm", "patient-receipt", "patient-reversal"].includes(action.type) ? "billing:write" : action.type === "patient-refund" ? "finance:write" : "case:act";
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
    } else if (["decision", "confirm", "patient-receipt", "patient-reversal", "patient-refund"].includes(action.type)) {
      payload = await prepareDecision(client, caseId, action as Parameters<typeof prepareDecision>[2], await usableRecords(client, caseId, current, await recordsForCase(client, caseId)));
    } else {
      payload = await prepareSubmission(client, caseId, action as Parameters<typeof prepareSubmission>[2], await usableRecords(client, caseId, current, await recordsForCase(client, caseId)));
    }
    return appendFinancialRecord(client, actor, current, action.type, payload, value.idempotencyKey, hash, "occurredAt" in action ? action.occurredAt : undefined);
  });
}
