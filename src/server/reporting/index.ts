import { z } from "zod";
import { AccessError, withActorTransaction } from "../access";
import { branchScope } from "../access/permissions";
import { caseIdSchema, currentFinancial, recordsForCase, scopedCase, usableRecords } from "../financial/records";
import { patientState } from "../financial/decisions";
import { settlementState } from "../financial/settlement";
import { csv, workflowTiming, type Timing } from "./format";
const filters = z.object({ mode: z.enum(["desk", "finance"]).default("desk"), branchId: caseIdSchema.optional(), caseNumber: z.string().trim().min(1).max(100).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }).strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to);
export type ReportFilters = z.input<typeof filters>;
export function reportFilters(request: Request): ReportFilters {
  const query = new URL(request.url).searchParams;
  return { mode: (query.get("mode") ?? "desk") as "desk" | "finance", ...(query.get("branchId") ? { branchId: query.get("branchId")! } : {}), ...(query.get("caseNumber") ? { caseNumber: query.get("caseNumber")! } : {}), ...(query.get("from") ? { from: query.get("from")! } : {}), ...(query.get("to") ? { to: query.get("to")! } : {}) };
}
export type ReportRow = { caseId: string; caseNumber: string; branchId: string; branchName: string; status: string; stage: string; ownerId: string | null; nextAction: string | null; timing: Timing;
  insurerEstimatePaise?: number | null; authorizedPaise?: number | null; patientConfirmedPaise?: number | null; disputePaise?: number | null;
  patientNetPaise?: number; payerReceivedPaise?: number; receivablePaise?: number | null; collectPaise?: number | null; refundPaise?: number | null };
export async function getReport(headers: Headers, input: ReportFilters) {
  const parsed = filters.safeParse(input); if (!parsed.success) throw new AccessError(400, "Choose a report, assigned branch and ordered date range.");
  const value = parsed.data;
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => {
    const scope = value.mode === "desk" ? branchScope(actor, "case:read") : [...new Set(actor.branchRoles.filter((grant) => ["HOSPITAL_ADMIN", "BILLING_OFFICER", "FINANCE_OFFICER", "REPORT_USER"].includes(grant.role)).map((grant) => grant.branchId))];
    if (!scope.length || (value.branchId && !scope.includes(value.branchId))) throw new AccessError(403, "This report is outside your role or assigned branches.");
    const branches = (await client.query('SELECT branch_id::text AS id,name FROM branches WHERE hospital_id=$1 AND branch_id=ANY($2::bigint[]) AND status=\'ACTIVE\' ORDER BY branch_id', [actor.hospitalId, scope])).rows as { id: string; name: string }[];
    const selected = await client.query(`SELECT c.claim_id,b.name AS branch_name
      FROM claims c JOIN branches b ON b.hospital_id=c.hospital_id AND b.branch_id=c.branch_id
      WHERE c.hospital_id=$1 AND c.branch_id=ANY($2::bigint[]) AND ($3::date IS NULL OR c.created_at >= $3::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ($4::date IS NULL OR c.created_at < ($4::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata') AND ($5::text IS NULL OR c.claim_no=$5) ORDER BY c.created_at DESC,c.claim_id DESC LIMIT 501`, [actor.hospitalId, value.branchId ? [value.branchId] : scope, value.from ?? null, value.to ?? null, value.caseNumber ?? null]);
    const asOf = new Date().toISOString(); const rows: ReportRow[] = [];
    // ponytail: cap scoped snapshots at 500 cases; batch financial lookups if reporting load warrants it.
    for (const selectedCase of selected.rows.slice(0, 500)) {
      const caseId = String(selectedCase.claim_id);
      const current = await scopedCase(client, actor, caseId);
      const records = await usableRecords(client, caseId, current, await recordsForCase(client, caseId));
      const patient = await patientState(client, caseId, records);
      const events = (await client.query("SELECT event_id,event_type,occurred_at,payload FROM claim_events WHERE claim_id=$1 ORDER BY case_version", [caseId])).rows;
      const timingEvents = events.filter((event) => event.event_type !== "FINANCIAL_CONFIRM" || event.event_id === patient.confirmation?.id).map((event) => ({ type: event.event_type === "PREPARATION_STATUS_CHANGED" && event.payload?.after?.status === "CANCELLED" ? "CANCELLED" : event.event_type === "FINANCIAL_DECISION" && event.event_id === patient.decision?.id && patient.decision?.payload.status !== "CONDITIONAL" ? "USABLE_FINAL_DECISION" : String(event.event_type), occurredAt: event.occurred_at.toISOString(), reference: event.event_type === "PAYER_QUERY_RECORDED" ? event.payload?.action?.reference : records.find((record) => record.id === event.event_id)?.payload.queryReference as string | undefined }));
      const row: ReportRow = { caseId, caseNumber: current.claim_no, branchId: String(current.branch_id), branchName: selectedCase.branch_name, status: current.claim_status, stage: current.claim_stage, ownerId: current.assigned_to === null ? null : String(current.assigned_to), nextAction: current.next_action, timing: workflowTiming(current.created_at.toISOString(), timingEvents, asOf) };
      if (value.mode === "finance") {
        const financial = currentFinancial(records); const settlement = await settlementState(client, caseId, patient.authorizedPaise);
        Object.assign(row, { insurerEstimatePaise: financial.assessment?.payload.result.insurerPaise ?? null, authorizedPaise: patient.authorizedPaise, patientConfirmedPaise: patient.patientConfirmedPaise, disputePaise: patient.disputePaise,
          patientNetPaise: patient.patientNetPaise, payerReceivedPaise: settlement.netReceivedPaise, receivablePaise: settlement.receivablePaise, collectPaise: patient.collectPaise, refundPaise: patient.refundPaise });
      }
      rows.push(row);
    }
    const totalFields = ["insurerEstimatePaise", "authorizedPaise", "patientConfirmedPaise", "disputePaise", "patientNetPaise", "payerReceivedPaise", "receivablePaise", "collectPaise", "refundPaise"] as const;
    const totals = value.mode === "finance" ? Object.fromEntries(totalFields.map((field) => [field, { knownPaise: rows.reduce((sum, row) => sum + BigInt(row[field] ?? 0), 0n).toString(), unknownCases: rows.filter((row) => row[field] === null || row[field] === undefined).length }])) : null;
    return { mode: value.mode, asOf, branches, rows, totals, truncated: selected.rows.length > 500, canFinance: actor.branchRoles.some((grant) => ["HOSPITAL_ADMIN", "BILLING_OFFICER", "FINANCE_OFFICER", "REPORT_USER"].includes(grant.role)), timingNote: "Discharge clocks start at the first verified final bill record. Preparation ends at the first reviewed pack; full desk resolution includes payer waits and rework through current Billing sign-off. Query response totals can overlap when queries run concurrently; these are elapsed durations, not active staff minutes. Query times reflect staff recording; external acknowledgements use evidenced occurrence times. Synthetic timings do not prove a real 1–2 hour outcome." };
  });
}
export type ReportData = Awaited<ReturnType<typeof getReport>>;
export async function exportReport(headers: Headers, input: ReportFilters): Promise<string> {
  const report = await getReport(headers, input);
  if (report.truncated) throw new AccessError(409, "Narrow the branch/date range before exporting all matching cases.");
  const base = ["Case", "Branch", "Status", "Stage", "Owner staff ID", "Preparation ms", "Submission delay ms", "Payer waiting ms", "Query response ms", "Billing review ms", "Full desk resolution ms", "Ongoing", "Timing review", "Snapshot UTC", "Timing basis"];
  const amountFields = ["insurerEstimatePaise", "authorizedPaise", "patientConfirmedPaise", "disputePaise", "patientNetPaise", "payerReceivedPaise", "receivablePaise", "collectPaise", "refundPaise"] as const;
  return csv(report.mode === "desk" ? base : [...base, ...amountFields], report.rows.map((row) => [row.caseNumber, row.branchName, row.status, row.stage, row.ownerId, row.timing.preparationMs, row.timing.submissionDelayMs, row.timing.payerWaitingMs, row.timing.queryResponseMs, row.timing.billingReviewMs, row.timing.deskResolutionMs, String(row.timing.ongoing), row.timing.issue, report.asOf, report.timingNote, ...(report.mode === "finance" ? amountFields.map((field) => row[field] ?? null) : [])]));
}
