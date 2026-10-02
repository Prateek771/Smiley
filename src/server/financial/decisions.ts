import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError } from "../access";
import { currentFinancial, requireRevision, type FinancialRecord } from "./records";
import { packState } from "./submissions";
import { money, sumPaise } from "./rules";
const receipt = { reference: z.string().trim().min(1).max(150), evidenceRevisionId: z.uuid(), occurredAt: z.iso.datetime({ offset: true }).refine((value) => new Date(value).getTime() <= Date.now() + 300000), verified: z.literal(true) };
export const decisionActions = [
  z.object({ type: z.literal("decision"), packId: z.uuid(), status: z.enum(["APPROVED", "REJECTED", "CONDITIONAL"]), authorizedPaise: money, conditions: z.string().trim().max(2000), ...receipt }).strict(),
  z.object({ type: z.literal("confirm"), decisionId: z.uuid(), patientPaise: money, disputePaise: money, evidenceRevisionId: z.uuid(), reason: z.string().trim().min(1).max(2000), verified: z.literal(true) }).strict(),
  z.object({ type: z.literal("patient-receipt"), amountPaise: money.refine((value) => value > 0), ...receipt }).strict(),
  z.object({ type: z.literal("patient-refund"), amountPaise: money.refine((value) => value > 0), ...receipt }).strict(),
  z.object({ type: z.literal("patient-reversal"), receiptId: z.uuid(), ...receipt }).strict(),
] as const;
type Action = z.infer<(typeof decisionActions)[number]>;
export type DecisionRecord = FinancialRecord<{ packId: string; status: string; authorizedPaise: number; reference: string; conditions: string; evidenceRevisionId: string }>;
type ConfirmationRecord = FinancialRecord<{ decisionId: string; assessmentId: string; billId: string; patientPaise: number; disputePaise: number }>;
export function netPatientReceipts(records: FinancialRecord[]) {
  const reversed = new Set(records.filter((row) => row.kind === "patient-reversal").map((row) => row.payload.receiptId));
  const total = records.reduce((sum, row) => sum + (row.kind === "patient-receipt" && !reversed.has(row.id) ? BigInt(Number(row.payload.amountPaise)) : row.kind === "patient-refund" ? -BigInt(Number(row.payload.amountPaise)) : 0n), 0n);
  if (total < 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) throw new AccessError(400, "Patient receipts and refunds exceed supported reconciliation bounds.");
  return Number(total);
}
export async function patientState(client: PoolClient, caseId: string, records: FinancialRecord[]) {
  const { bill, assessment } = currentFinancial(records); const state = await packState(client, caseId, records);
  const candidate = records.find((row) => row.kind === "decision") as DecisionRecord | undefined;
  const decision = state.packCurrent && candidate?.payload.packId === state.pack?.id ? candidate : null;
  const confirmation = records.find((row) => row.kind === "confirm") as ConfirmationRecord | undefined;
  const current = !!confirmation && !!decision && decision.payload.status !== "CONDITIONAL" && confirmation.payload.decisionId === decision.id && confirmation.payload.billId === bill?.id && confirmation.payload.assessmentId === assessment?.id;
  const patientConfirmedPaise = current ? confirmation!.payload.patientPaise : null;
  const patientNetPaise = netPatientReceipts(records);
  return { decision, confirmation: current ? confirmation! : null, authorizedPaise: decision?.payload.status === "CONDITIONAL" ? null : decision?.payload.authorizedPaise ?? null,
    patientConfirmedPaise, disputePaise: current ? confirmation!.payload.disputePaise : null, patientNetPaise,
    collectPaise: patientConfirmedPaise === null ? null : Math.max(patientConfirmedPaise - patientNetPaise, 0), refundPaise: patientConfirmedPaise === null ? null : Math.max(patientNetPaise - patientConfirmedPaise, 0) };
}
export async function prepareDecision(client: PoolClient, caseId: string, action: Action, records: FinancialRecord[]): Promise<unknown> {
  await requireRevision(client, caseId, action.evidenceRevisionId, action.type === "decision" ? "payer-decision" : action.type.startsWith("patient-") ? "patient-payment" : undefined);
  if ("reference" in action && records.some((row) => row.kind === action.type && row.payload.reference === action.reference)) throw new AccessError(409, "This external reference is already recorded.");
  const { bill, assessment } = currentFinancial(records); const state = await patientState(client, caseId, records);
  if (action.type === "decision") {
    const pack = await packState(client, caseId, records);
    if (!pack.packCurrent || pack.pack?.id !== action.packId || !records.some((row) => row.kind === "submission" && row.payload.packId === action.packId)) throw new AccessError(409, "Record a current reviewed pack and actual submission before the payer decision.");
    if (!bill || !assessment || action.authorizedPaise > assessment.payload.result.grossPaise - assessment.payload.result.reductionPaise || (action.status === "REJECTED" && action.authorizedPaise !== 0) || (action.status === "CONDITIONAL" && !action.conditions)) throw new AccessError(400, "Decision amount or conditions conflict with the current bill.");
    return action;
  }
  if (action.type === "confirm") {
    if (!bill || !assessment || !state.decision || state.decision.id !== action.decisionId || state.decision.payload.status === "CONDITIONAL") throw new AccessError(409, "A current final payer decision is required for Billing confirmation.");
    const result = assessment.payload.result;
    if (action.patientPaise !== result.patientPaise || sumPaise([state.decision.payload.authorizedPaise, action.patientPaise, action.disputePaise, result.reductionPaise]) !== result.grossPaise) throw new AccessError(400, "Keep the verified patient estimate; record unexplained payer deductions as a decision dispute. All allocations must equal the bill.");
    return { ...action, billId: bill.id, assessmentId: assessment.id };
  }
  if (action.type === "patient-receipt") { sumPaise([state.patientNetPaise, action.amountPaise]); return action; }
  if (action.type === "patient-refund") {
    if (state.refundPaise === null) throw new AccessError(409, "Current Billing sign-off is required before refund execution.");
    if (action.amountPaise > state.refundPaise) throw new AccessError(400, "Refund execution exceeds the currently owed refund.");
    return { ...action, confirmationId: state.confirmation!.id };
  }
  const original = records.find((row) => row.id === action.receiptId && row.kind === "patient-receipt");
  if (!original || records.some((row) => row.kind === "patient-reversal" && row.payload.receiptId === action.receiptId)) throw new AccessError(409, "Choose an unreversed patient receipt from this case.");
  if (Number(original.payload.amountPaise) > state.patientNetPaise) throw new AccessError(400, "This reversal would leave refunds exceeding remaining patient receipts.");
  return action;
}
