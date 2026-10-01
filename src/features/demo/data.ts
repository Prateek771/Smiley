import fixture from "../../../docs/fixtures/phase-2-cashless-discharge.json";

export const roles = ["Desk", "Billing", "Finance"] as const;
export type DemoRole = (typeof roles)[number];
export type SearchValues = Record<string, string | string[] | undefined>;
export type DemoContext = { q: string; filter: string; role: DemoRole };

type DemoEvent = {
  id: string;
  type: string;
  occurredAt: string;
  recordedAt: string;
  actorRole: string;
  evidenceRefs: string[];
};
type DemoDocument = {
  id: string;
  kind: string;
  version: number;
  page: number;
  availableFromEventId: string;
  content: Record<string, unknown>;
};
type DemoQuery = {
  reference: string;
  text: string;
  receivedAtEventId: string;
  responseAcknowledgedAtEventId: string;
  responseReference: string;
  responseSources: string[];
};
export type DemoCheckpoint = {
  id: string;
  billVersion: number;
  authoritativeBillVersion: number | null;
  ruleVersion: string;
  factsVerified: boolean;
  billingSignedOff: boolean;
  asOfEventId: string;
  availableDocumentIds: string[];
  currentQueryStates: { reference: string; responseAcknowledged: boolean }[];
  activeQueryReferences: string[];
  reviewReasons: string[];
  invalidatedArtifacts?: string[];
  financialInputs: { grossBillPaise: number; netPatientPaymentsPaise: number; payerAuthorizationPaise: number | null };
  expected: Record<string, number | null>;
  expectedState: { discharge: string; decisionDispute: string; settlement: string; wholeCaseClosed: boolean };
  nextActions: { ownerRole: string; action: string }[];
};
export type DemoPack = {
  id: string;
  title: string;
  hospitalId: string;
  branchId: string;
  events: DemoEvent[];
  sourceDocuments: DemoDocument[];
  queries: DemoQuery[];
  checkpoints: DemoCheckpoint[];
};
export type DemoSnapshot = ReturnType<typeof snapshot>;
export const packs = fixture.packs as unknown as DemoPack[];

export function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
export function contextFrom(values: SearchValues): DemoContext {
  const role = firstValue(values.role);
  const filter = firstValue(values.filter);
  return {
    q: firstValue(values.q).slice(0, 100),
    filter: ["review", "queries", "disputes", "settlement"].includes(filter) ? filter : "all",
    role: roles.includes(role as DemoRole) ? role as DemoRole : "Desk",
  };
}
export function demoUrl(path: string, context: DemoContext, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (context.q) params.set("q", context.q);
  if (context.filter !== "all") params.set("filter", context.filter);
  params.set("role", context.role);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  return `${path}?${params.toString()}`;
}
export function snapshot(pack: DemoPack, checkpointId?: string) {
  const defaultId = pack.id === "P2-03" ? "P2-03-query-2" : pack.checkpoints[0].id;
  const checkpoint = pack.checkpoints.find((item) => item.id === checkpointId)
    ?? pack.checkpoints.find((item) => item.id === defaultId)!;
  const cutoff = pack.events.findIndex((event) => event.id === checkpoint.asOfEventId);
  const events = cutoff < 0 ? [] : pack.events.slice(0, cutoff + 1);
  const eventIds = new Set(events.map((event) => event.id));
  const allowed = new Set(checkpoint.availableDocumentIds);
  const documents = pack.sourceDocuments.filter((doc) => allowed.has(doc.id) && eventIds.has(doc.availableFromEventId));
  const queries = pack.queries.filter((query) => eventIds.has(query.receivedAtEventId)).map((query) => ({
    ...query,
    acknowledged: Boolean(checkpoint.currentQueryStates.find((state) => state.reference === query.reference)?.responseAcknowledged)
      && eventIds.has(query.responseAcknowledgedAtEventId),
  }));
  const hasAuthorization = documents.some((doc) => doc.kind === "final-authorization")
    && events.some((event) => event.type === "final-decision-received");
  const authorization = hasAuthorization ? checkpoint.financialInputs.payerAuthorizationPaise : null;
  const firstBill = events.find((event) => event.type === "bill-ready");
  const signoff = events.findLast((event) => event.type === "patient-amount-confirmed");
  const asOf = events.at(-1);
  const timerEnd = signoff ?? asOf;
  const elapsedMinutes = firstBill && timerEnd
    ? Math.round((Date.parse(timerEnd.occurredAt) - Date.parse(firstBill.occurredAt)) / 60_000) : null;
  return { pack, checkpoint, events, documents, queries, authorization, asOf, elapsedMinutes, resolutionConfirmed: Boolean(signoff) };
}
export function matchesWork(snapshot: DemoSnapshot, filter: string) {
  const state = snapshot.checkpoint.expectedState;
  if (filter === "review") return snapshot.checkpoint.reviewReasons.length > 0;
  if (filter === "queries") return snapshot.checkpoint.activeQueryReferences.length > 0;
  if (filter === "disputes") return state.decisionDispute === "open";
  if (filter === "settlement") return snapshot.authorization !== null && state.settlement !== "authorized-receipts-reconciled";
  return true;
}
export function money(paise: number | null | undefined) {
  if (paise === null || paise === undefined) return "Needs review";
  return `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(paise / 100)}`;
}
export function istTime(timestamp: string) {
  return `${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp))} IST`;
}
export function readableAction(action: string) {
  return action.replace(/\b(\d+) paise\b/g, (_, paise: string) => money(Number(paise)));
}
export const eventLabels: Record<string, string> = {
  "bill-ready": "Final bill ready",
  "pack-ready": "Reviewed pack ready",
  "submission-acknowledged": "External submission acknowledged",
  "final-decision-received": "Final payer decision",
  "patient-amount-confirmed": "Billing confirmed patient amount",
  "evidence-review-required": "Evidence review required",
  "bill-authority-confirmed": "Authoritative bill selected",
  "facts-verified": "Source facts verified",
  "query-received": "Payer query received",
  "query-response-acknowledged": "Response acknowledged externally",
  "bill-revised": "Bill revised; earlier artifacts invalidated",
  "financial-facts-verified": "Current financial facts verified",
  "payer-receipt-matched": "Payer receipt matched",
  "duplicate-receipt-import-ignored": "Duplicate receipt ignored",
  "payer-receipt-reversed": "Payer receipt reversed",
};
export const reviewLabels: Record<string, string> = {
  "missing-summary": "Missing discharge summary",
  "policy-id-conflict": "Policy ID conflicts with its source",
  "bill-version-conflict": "Conflicting bill versions need Billing review",
};
export const checkpointLabels: Record<string, string> = {
  "P2-01-confirmed": "Patient amount confirmed",
  "P2-02-blocked": "Missing / conflicting evidence",
  "P2-02-corrected-confirmed": "Corrected facts and Billing sign-off",
  "P2-03-query-1": "Query 1 received",
  "P2-03-query-2": "Query 2 · revised bill verified",
  "P2-03-confirmed": "Both responses acknowledged · confirmed",
  "P2-04-dispute-open": "Billing confirmed · dispute open",
  "P2-05-partial": "Partial receipt · ₹2,000 outstanding",
  "P2-05-duplicate-import": "Duplicate import ignored",
  "P2-05-authorized-paid": "Authorized receipts reconciled",
  "P2-05-reversal": "Receipt reversal · follow-up reopened",
};
