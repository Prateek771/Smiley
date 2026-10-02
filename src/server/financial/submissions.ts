import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError } from "../access";
import { currentFinancial, requireRevision, type FinancialRecord } from "./records";

const reference = z.string().trim().min(1).max(150);
const occurrence = z.iso.datetime({ offset: true }).refine((value) => new Date(value).getTime() <= Date.now() + 300000);
export const submissionActions = [
  z.object({ type: z.literal("pack"), assessmentId: z.uuid(), revisionIds: z.array(z.uuid()).min(1).max(100).refine((values) => new Set(values).size === values.length), verified: z.literal(true) }).strict(),
  z.object({ type: z.literal("submission"), packId: z.uuid(), reference, evidenceRevisionId: z.uuid(), occurredAt: occurrence }).strict(),
  z.object({ type: z.literal("query-ack"), queryReference: reference, responseEventId: z.uuid(), reference, evidenceRevisionId: z.uuid(), occurredAt: occurrence, verified: z.literal(true) }).strict(),
  z.object({ type: z.literal("query-resolve"), queryReference: reference, reference, evidenceRevisionId: z.uuid(), occurredAt: occurrence }).strict(),
] as const;
type Action = z.infer<(typeof submissionActions)[number]>;
export type PackRecord = FinancialRecord<{ billId: string; assessmentId: string; sources: { revisionId: string; documentId: string; documentType: string }[] }>;

export async function packState(client: PoolClient, caseId: string, records: FinancialRecord[]) {
  const { bill, assessment } = currentFinancial(records);
  const pack = (records.find((record) => record.kind === "pack") ?? null) as PackRecord | null;
  let packCurrent = !!pack && pack.payload.billId === bill?.id && pack.payload.assessmentId === assessment?.id && assessment?.payload.result.status === "READY";
  if (packCurrent && pack) {
    for (const source of pack.payload.sources) {
      const latest = await client.query("SELECT revision_id FROM document_revisions WHERE claim_id=$1 AND claim_document_id=$2 ORDER BY revision_number DESC LIMIT 1", [caseId, source.documentId]);
      if (latest.rows[0]?.revision_id !== source.revisionId) { packCurrent = false; break; }
    }
  }
  return { pack, packCurrent };
}
export async function prepareSubmission(client: PoolClient, caseId: string, action: Action, records: FinancialRecord[]): Promise<unknown> {
  const { bill, assessment } = currentFinancial(records);
  if (action.type === "pack") {
    if (!bill || !assessment || assessment.id !== action.assessmentId || assessment.payload.result.status !== "READY") throw new AccessError(409, "A current supported assessment is required before pack review.");
    const sources: PackRecord["payload"]["sources"] = [];
    for (const revisionId of action.revisionIds) {
      const revision = await requireRevision(client, caseId, revisionId);
      const latest = await client.query("SELECT revision_id FROM document_revisions WHERE claim_document_id=$1 AND claim_id=$2 ORDER BY revision_number DESC LIMIT 1", [revision.document_id, caseId]);
      if (latest.rows[0]?.revision_id !== revisionId) throw new AccessError(409, "Review the latest revision of every selected document.");
      sources.push({ revisionId, documentId: revision.document_id, documentType: revision.document_type });
    }
    if (["policy", "preauthorization", "final-bill", "discharge-summary"].some((kind) => !sources.some((source) => source.documentType === kind))) throw new AccessError(400, "Policy, preauthorization, final bill and discharge summary evidence are required.");
    const required = [bill.payload.sourceRevisionId, assessment.payload.policyRevisionId, ...(bill.payload.reductionRevisionId ? [bill.payload.reductionRevisionId] : [])];
    if (required.some((id) => !action.revisionIds.includes(id))) throw new AccessError(400, "Include the exact bill, policy and reduction evidence used in this assessment.");
    return { ...action, billId: bill.id, sources };
  }
  await requireRevision(client, caseId, action.evidenceRevisionId);
  if (records.some((row) => row.kind === action.type && row.payload.reference === action.reference)) throw new AccessError(409, "This external reference has already been recorded.");
  if (action.type === "submission") {
    const state = await packState(client, caseId, records);
    if (!state.packCurrent || state.pack?.id !== action.packId) throw new AccessError(409, "The pack is stale or unapproved. Review the current inputs and prepare a new pack.");
    return action;
  }
  const query = await client.query("SELECT query_id,status FROM claim_queries WHERE claim_id=$1 AND external_reference=$2", [caseId, action.queryReference]);
  if (!query.rowCount || query.rows[0].status === "RESOLVED") throw new AccessError(409, "Choose an unresolved query from this case.");
  const response = await client.query("SELECT event_id FROM claim_events WHERE claim_id=$1 AND event_type='QUERY_RESPONSE_PREPARED' AND payload->'action'->>'reference'=$2 ORDER BY case_version DESC LIMIT 1", [caseId, action.queryReference]);
  if (!response.rowCount) throw new AccessError(409, "Prepare and review a response before recording external acknowledgement.");
  if (action.type === "query-ack") {
    if (response.rows[0].event_id !== action.responseEventId) throw new AccessError(409, "The response changed. Acknowledge its latest reviewed revision.");
    return action;
  }
  const acknowledgement = records.find((record) => record.kind === "query-ack" && record.payload.queryReference === action.queryReference);
  if (!acknowledgement || acknowledgement.payload.responseEventId !== response.rows[0].event_id) throw new AccessError(409, "The latest response still needs actual external acknowledgement.");
  await client.query("UPDATE claim_queries SET status='RESOLVED' WHERE query_id=$1", [query.rows[0].query_id]);
  return { ...action, responseEventId: response.rows[0].event_id, acknowledgementId: acknowledgement.id };
}
