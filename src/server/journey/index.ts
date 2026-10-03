import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, withActorTransaction } from "../access";
import { branchScope } from "../access/permissions";
import { writeAudit } from "../audit";
import { caseIdSchema, fingerprint, requireRevision, revisionCurrent, scopedCase } from "../financial/records";
import { money } from "../financial/rules";

const text = z.string().trim().min(1).max(2000);
const reference = z.string().trim().min(1).max(150);
const occurredAt = z.iso.datetime({ offset: true }).refine((value) => new Date(value).getTime() <= Date.now() + 300000);
const evidenced = { text, evidenceRevisionId: z.uuid(), occurredAt, verified: z.literal(true) };
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("eligibility"), reference, result: z.enum(["ELIGIBLE", "PARTIAL", "NOT_ELIGIBLE", "UNCLEAR"]), validFrom: z.iso.date(), validThrough: z.iso.date(), ...evidenced }).strict(),
  z.object({ type: z.literal("preauth-request"), kind: z.enum(["INITIAL", "ENHANCEMENT"]), eligibilityEventId: z.uuid(), parentRequestId: z.uuid().nullable(), supersedesRequestId: z.uuid().nullable().default(null), reference, requestedPaise: money.positive(), estimatePaise: money.positive(), ...evidenced }).strict(),
  z.object({ type: z.literal("preauth-response"), requestId: z.uuid(), reference, result: z.enum(["APPROVED", "PARTIAL", "QUERY", "REJECTED", "UNCLEAR"]), authorizedPaise: money.nullable(), supersedesResponseId: z.uuid().nullable(), ...evidenced }).strict(),
  z.object({ type: z.literal("treatment-update"), estimatePaise: money, ...evidenced }).strict(),
  z.object({ type: z.literal("payer-query"), requestId: z.uuid(), supersedesQueryId: z.uuid().nullable().default(null), reference, ...evidenced }).strict(),
  z.object({ type: z.literal("query-response-prepared"), queryEventId: z.uuid(), text, sourceRevisionIds: z.array(z.uuid()).min(1).max(20).refine((values) => new Set(values).size === values.length), occurredAt, verified: z.literal(true) }).strict(),
  z.object({ type: z.literal("query-acknowledged"), responseEventId: z.uuid(), reference, evidenceRevisionId: z.uuid(), occurredAt, verified: z.literal(true) }).strict(),
  z.object({ type: z.literal("discharge-handoff"), ...evidenced }).strict(),
]).superRefine((action, context) => {
  if (action.type === "eligibility" && action.validFrom > action.validThrough) context.addIssue({ code: "custom", message: "Eligibility dates must be ordered." });
  if (action.type === "preauth-request" && ((action.kind === "INITIAL") !== (action.parentRequestId === null) || action.requestedPaise > action.estimatePaise)) context.addIssue({ code: "custom", message: "Provide the request kind, parent and supported total estimate." });
  if (action.type === "preauth-response") {
    const grants = action.result === "APPROVED" || action.result === "PARTIAL";
    if (grants ? action.authorizedPaise === null || action.authorizedPaise <= 0 : action.authorizedPaise !== null) context.addIssue({ code: "custom", message: "Only an actual positive approval has an authorized amount." });
  }
});
const requestSchema = z.object({ expectedVersion: z.number().int().positive().max(2147483646), idempotencyKey: z.string().min(8).max(100), action: actionSchema }).strict();
export type JourneyAction = z.infer<typeof actionSchema>;
export type JourneyInput = z.infer<typeof requestSchema>;
export type JourneyEvent = { id: string; action: JourneyAction; caseVersion: number; actorId: string; occurredAt: string; recordedAt: string; evidenceCurrent: boolean };
type EventOf<T extends JourneyAction["type"]> = Omit<JourneyEvent, "action"> & { action: Extract<JourneyAction, { type: T }> };
export type JourneyQuery = { id: string; requestId: string; reference: string; text: string; status: "OPEN" | "PREPARED" | "ACKNOWLEDGED"; preparedResponseId: string | null; acknowledgementId: string | null };
export type Journey = {
  caseId: string; version: number; closed: boolean; events: JourneyEvent[];
  eligibility: EventOf<"eligibility"> | null; eligibilityUsable: boolean;
  requests: EventOf<"preauth-request">[]; responses: EventOf<"preauth-response">[];
  treatments: EventOf<"treatment-update">[]; queries: JourneyQuery[];
  currentAuthorization: (EventOf<"preauth-response"> & { authorizedPaise: number }) | null;
  activeRequestIds: string[]; pendingRequestIds: string[]; discharge: EventOf<"discharge-handoff"> | null;
};
export type JourneyResult = { caseId: string; eventId: string; version: number; idempotent: boolean };

const instant = (value: Date | string) => value instanceof Date ? value.toISOString() : value;
const last = <T,>(values: T[]): T | null => values[values.length - 1] ?? null;
function indiaDay(value: string | Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const field = (name: string) => parts.find((part) => part.type === name)!.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}
function sourceIds(action: JourneyAction): string[] {
  return action.type === "query-response-prepared" ? action.sourceRevisionIds : [action.evidenceRevisionId];
}
async function readJourney(client: PoolClient, current: Record<string, unknown>): Promise<Journey> {
  const caseId = String(current.claim_id);
  const scope = [caseId, String(current.hospital_id), String(current.branch_id)];
  const rows = await client.query(`SELECT event_id AS id,payload,case_version AS "caseVersion",actor_user_id::text AS "actorId",occurred_at AS "occurredAt",recorded_at AS "recordedAt" FROM claim_events WHERE claim_id=$1 AND hospital_id=$2 AND branch_id=$3 AND event_type LIKE 'JOURNEY_%' ORDER BY case_version,event_id`, scope);
  const latest = await client.query("SELECT DISTINCT ON(claim_document_id) revision_id FROM document_revisions WHERE claim_id=$1 AND hospital_id=$2 AND branch_id=$3 ORDER BY claim_document_id,revision_number DESC", scope);
  const currentSources = new Set<string>(latest.rows.map((row) => String(row.revision_id)));
  const events: JourneyEvent[] = rows.rows.map((row) => {
    const parsed = actionSchema.safeParse(row.payload.action);
    if (!parsed.success) throw new AccessError(409, "A journey record needs administrator review before this workflow can continue.");
    return { id: row.id, action: parsed.data, caseVersion: row.caseVersion, actorId: row.actorId, occurredAt: instant(row.occurredAt), recordedAt: instant(row.recordedAt), evidenceCurrent: sourceIds(parsed.data).every((id) => currentSources.has(id)) };
  });
  const eligibility = last(events.filter((event): event is EventOf<"eligibility"> => event.action.type === "eligibility"));
  const today = indiaDay();
  const covered = (date: string) => !!eligibility && eligibility.action.validFrom <= date && eligibility.action.validThrough >= date && typeof current.valid_from === "string" && typeof current.valid_to === "string" && current.valid_from <= date && current.valid_to >= date;
  const eligibilityUsable = !!eligibility && eligibility.evidenceCurrent && ["ELIGIBLE", "PARTIAL"].includes(eligibility.action.result) && covered(today) && (!current.admission_date || covered(indiaDay(current.admission_date as Date)));
  const requests = events.filter((event): event is EventOf<"preauth-request"> => event.action.type === "preauth-request");
  const responses = events.filter((event): event is EventOf<"preauth-response"> => event.action.type === "preauth-response");
  const requestRoots = new Map<string, string>(); const activeByRoot = new Map<string, string>();
  for (const request of requests) {
    const root = request.action.supersedesRequestId ? requestRoots.get(request.action.supersedesRequestId)! : request.id;
    requestRoots.set(request.id, root); activeByRoot.set(root, request.id);
  }
  const activeRequestIds = [...activeByRoot.values()];
  const activeRequests = requests.filter((request) => activeRequestIds.includes(request.id));
  const responseByRequest = new Map(responses.map((response) => [response.action.requestId, response]));
  const responseByRoot = new Map(responses.map((response) => [requestRoots.get(response.action.requestId), response]));
  const pendingRequestIds = activeRequests.filter((request) => !responseByRequest.has(request.id) || ["QUERY", "UNCLEAR"].includes(responseByRequest.get(request.id)!.action.result)).map((request) => request.id);
  const approved = responses.filter((response) => responseByRoot.get(requestRoots.get(response.action.requestId))?.id === response.id && response.evidenceCurrent && ["APPROVED", "PARTIAL"].includes(response.action.result) && response.action.authorizedPaise !== null);
  const authorization = last(approved);
  const recordedQueries = events.filter((event): event is EventOf<"payer-query"> => event.action.type === "payer-query");
  const supersededQueries = new Set(recordedQueries.map((query) => query.action.supersedesQueryId));
  const preparedByQuery = new Map(events.filter((event): event is EventOf<"query-response-prepared"> => event.action.type === "query-response-prepared").map((event) => [event.action.queryEventId, event]));
  const acknowledgementByResponse = new Map(events.filter((event): event is EventOf<"query-acknowledged"> => event.action.type === "query-acknowledged").map((event) => [event.action.responseEventId, event]));
  const queries = recordedQueries.filter((query) => !supersededQueries.has(query.id)).map((query): JourneyQuery => {
    const prepared = preparedByQuery.get(query.id);
    const acknowledgement = prepared && acknowledgementByResponse.get(prepared.id);
    const requestId = activeByRoot.get(requestRoots.get(query.action.requestId)!);
    return { id: query.id, requestId: requestId ?? query.action.requestId, reference: query.action.reference, text: query.action.text, status: query.evidenceCurrent && acknowledgement && prepared?.evidenceCurrent && acknowledgement.evidenceCurrent ? "ACKNOWLEDGED" : prepared ? "PREPARED" : "OPEN", preparedResponseId: prepared?.id ?? null, acknowledgementId: acknowledgement?.id ?? null };
  });
  return { caseId, version: Number(current.version), closed: current.claim_status === "CANCELLED" || current.claim_stage === "CLOSED", events, eligibility, eligibilityUsable, requests, responses, queries,
    currentAuthorization: authorization ? { ...authorization, authorizedPaise: authorization.action.authorizedPaise! } : null, activeRequestIds, pendingRequestIds,
    treatments: events.filter((event): event is EventOf<"treatment-update"> => event.action.type === "treatment-update"), discharge: last(events.filter((event): event is EventOf<"discharge-handoff"> => event.action.type === "discharge-handoff")) };
}
export async function getJourney(headers: Headers, caseId: string): Promise<Journey> {
  if (!caseIdSchema.safeParse(caseId).success) throw new AccessError(400, "Provide a valid case ID.");
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => readJourney(client, await scopedCase(client, actor, caseId)));
}
function after(action: JourneyAction, event: JourneyEvent): void {
  if (new Date(action.occurredAt).getTime() < new Date(event.occurredAt).getTime()) throw new AccessError(409, "The actual event time precedes the event it refers to.");
}
export async function applyJourneyAction(headers: Headers, caseId: string, input: unknown): Promise<JourneyResult> {
  const parsed = requestSchema.safeParse(input);
  if (!caseIdSchema.safeParse(caseId).success || !parsed.success) throw new AccessError(400, "Provide a supported journey action, exact amounts, reviewed evidence, current version and request key.");
  const value = parsed.data; const action = value.action; const hash = fingerprint(value);
  return withActorTransaction(headers, "case:act", undefined, async (client, actor) => {
    const current = await scopedCase(client, actor, caseId, true);
    if (!branchScope(actor, "case:act").includes(String(current.branch_id))) throw new AccessError(404, "The case is unavailable in your assigned branches.");
    const previous = await client.query("SELECT event_id,fingerprint,case_version FROM claim_events WHERE claim_id=$1 AND idempotency_key=$2 AND hospital_id=$3", [caseId, value.idempotencyKey, actor.hospitalId]);
    if (previous.rowCount) {
      if (previous.rows[0].fingerprint !== hash) throw new AccessError(409, "This request key was already used for different information.");
      return { caseId, eventId: previous.rows[0].event_id, version: previous.rows[0].case_version, idempotent: true };
    }
    if (current.version !== value.expectedVersion) throw new AccessError(409, "The case changed. Reload and review before saving.");
    const journey = await readJourney(client, current);
    if (journey.closed) throw new AccessError(409, "This case is closed for journey actions.");
    if (journey.discharge) throw new AccessError(409, "The earlier journey has been handed over for final discharge preparation.");
    for (const revisionId of sourceIds(action)) {
      await requireRevision(client, caseId, revisionId, action.type === "discharge-handoff" ? "discharge-summary" : undefined);
      if (!await revisionCurrent(client, caseId, revisionId)) throw new AccessError(409, "Review the latest revision of the journey evidence before saving.");
    }
    let stage: string = current.claim_stage;
    if (action.type === "eligibility") stage = "ELIGIBILITY_VERIFICATION";
    else if (action.type === "preauth-request") {
      if (!journey.eligibilityUsable || journey.eligibility?.id !== action.eligibilityEventId) throw new AccessError(409, "Current evidenced eligibility must cover today and admission before requesting authorization.");
      after(action, journey.eligibility);
      const date = indiaDay(action.occurredAt);
      if (date < journey.eligibility.action.validFrom || date > journey.eligibility.action.validThrough || date < current.valid_from || date > current.valid_to) throw new AccessError(409, "Eligibility and the registered policy must cover the request date.");
      const superseded = action.supersedesRequestId && journey.requests.find((request) => request.id === action.supersedesRequestId && journey.activeRequestIds.includes(request.id));
      if (action.supersedesRequestId && (!superseded || superseded.action.kind !== action.kind || superseded.action.parentRequestId !== action.parentRequestId || superseded.action.reference !== action.reference)) throw new AccessError(409, "Amend the latest request in this case with the same request reference, kind and enhancement parent.");
      if (journey.requests.some((request) => journey.activeRequestIds.includes(request.id) && request.id !== action.supersedesRequestId && request.action.reference === action.reference)) throw new AccessError(409, "This request reference is already recorded.");
      if (journey.pendingRequestIds.some((id) => id !== action.supersedesRequestId)) throw new AccessError(409, "Review the outstanding request before submitting another request.");
      if (superseded) {
        after(action, superseded);
        const previousResponse = last(journey.responses.filter((response) => response.action.requestId === superseded.id));
        if (previousResponse) after(action, previousResponse);
      } else if (action.kind === "ENHANCEMENT") {
        const parent = journey.requests.find((request) => request.id === action.parentRequestId);
        if (!parent || journey.currentAuthorization?.action.requestId !== parent.id || !parent.evidenceCurrent) throw new AccessError(409, "An enhancement must refer to the current actual authorization and request evidence.");
        after(action, journey.currentAuthorization);
      } else if (journey.currentAuthorization) throw new AccessError(409, "Use a linked enhancement for an already authorized case.");
      if (action.kind === "ENHANCEMENT" && (!journey.currentAuthorization || action.requestedPaise <= journey.currentAuthorization.authorizedPaise)) throw new AccessError(409, "An enhancement requests a new total above the current authorization.");
      stage = "PRE_AUTH";
    } else if (action.type === "preauth-response") {
      const request = journey.requests.find((request) => request.id === action.requestId);
      if (!request || !request.evidenceCurrent || !journey.activeRequestIds.includes(request.id)) throw new AccessError(409, "Choose the latest request belonging to this case with current source evidence.");
      after(action, request);
      const previousResponse = last(journey.responses.filter((response) => response.action.requestId === action.requestId));
      if ((previousResponse?.id ?? null) !== action.supersedesResponseId) throw new AccessError(409, "A revised response must identify the latest response it supersedes.");
      if (previousResponse) after(action, previousResponse);
      if (action.authorizedPaise !== null && action.authorizedPaise > request.action.requestedPaise) throw new AccessError(400, "An authorization cannot exceed the evidenced requested total.");
      if (["APPROVED", "PARTIAL"].includes(action.result)) {
        for (const query of journey.queries.filter((query) => query.requestId === request.id)) {
          if (query.status !== "ACKNOWLEDGED") throw new AccessError(409, "Record actual acknowledgement of the latest response to every linked payer query.");
          after(action, journey.events.find((event) => event.id === query.acknowledgementId)!);
        }
      }
      stage = ["APPROVED", "PARTIAL"].includes(action.result) ? "TREATMENT" : "PRE_AUTH";
    } else if (action.type === "treatment-update") {
      const request = last(journey.requests.filter((request) => journey.activeRequestIds.includes(request.id)));
      if (!request) throw new AccessError(409, "Record the initial preauthorization request before treatment updates.");
      after(action, last(journey.treatments) ?? request); stage = "TREATMENT";
    } else if (action.type === "payer-query") {
      const request = journey.requests.find((request) => request.id === action.requestId);
      if (!request || !request.evidenceCurrent || !journey.activeRequestIds.includes(request.id)) throw new AccessError(409, "Choose a current evidenced request belonging to this case.");
      const superseded = action.supersedesQueryId && journey.queries.find((query) => query.id === action.supersedesQueryId);
      if (action.supersedesQueryId && (!superseded || superseded.requestId !== action.requestId || superseded.reference !== action.reference)) throw new AccessError(409, "Revise the latest query in this request family with the same external reference.");
      if (journey.queries.some((query) => query.reference === action.reference && query.id !== action.supersedesQueryId)) throw new AccessError(409, "This payer query reference is already recorded.");
      if (superseded) {
        after(action, journey.events.find((event) => event.id === superseded.id)!);
        if (superseded.preparedResponseId) after(action, journey.events.find((event) => event.id === superseded.preparedResponseId)!);
        if (superseded.acknowledgementId) after(action, journey.events.find((event) => event.id === superseded.acknowledgementId)!);
      }
      after(action, request); stage = "QUERY";
    } else if (action.type === "query-response-prepared") {
      const query = journey.events.find((event) => event.id === action.queryEventId && event.action.type === "payer-query");
      if (!query || !query.evidenceCurrent || !journey.queries.some((currentQuery) => currentQuery.id === query.id)) throw new AccessError(409, "Choose the latest recorded payer query with current evidence in this case.");
      after(action, query);
      const latestPrepared = last(journey.events.filter((event) => event.action.type === "query-response-prepared" && event.action.queryEventId === query.id));
      if (latestPrepared) after(action, latestPrepared);
    } else if (action.type === "query-acknowledged") {
      const prepared = journey.events.find((event): event is EventOf<"query-response-prepared"> => event.id === action.responseEventId && event.action.type === "query-response-prepared");
      const query = prepared && journey.queries.find((query) => query.id === prepared.action.queryEventId);
      if (!prepared || !prepared.evidenceCurrent || query?.preparedResponseId !== prepared.id) throw new AccessError(409, "Acknowledge the latest reviewed response and current source evidence.");
      if (query.status === "ACKNOWLEDGED" || journey.events.some((event) => event.action.type === "query-acknowledged" && event.action.reference === action.reference)) throw new AccessError(409, "This response or acknowledgement reference is already acknowledged.");
      after(action, prepared);
    } else {
      const treatment = last(journey.treatments);
      if (!journey.currentAuthorization || !treatment?.evidenceCurrent || journey.pendingRequestIds.length || journey.queries.some((query) => query.status !== "ACKNOWLEDGED")) throw new AccessError(409, "Review actual authorization, current treatment evidence and outstanding payer work before discharge handoff.");
      after(action, journey.currentAuthorization); after(action, treatment);
      for (const request of journey.requests.filter((request) => journey.activeRequestIds.includes(request.id))) {
        after(action, request);
        const response = last(journey.responses.filter((response) => response.action.requestId === request.id));
        if (response) after(action, response);
      }
      for (const query of journey.queries) after(action, journey.events.find((event) => event.id === query.acknowledgementId)!);
      if (current.admission_date && new Date(action.occurredAt).getTime() < new Date(current.admission_date).getTime()) throw new AccessError(409, "Discharge cannot precede admission.");
      stage = "SUBMISSION";
    }
    const eventId = randomUUID(); const version = current.version + 1;
    const eventType = `JOURNEY_${action.type.toUpperCase().replaceAll("-", "_")}`;
    await client.query("UPDATE claims SET version=$1,claim_stage=$2,discharge_date=CASE WHEN $3::boolean THEN $4::timestamptz ELSE discharge_date END WHERE claim_id=$5", [version, stage, action.type === "discharge-handoff", action.occurredAt, caseId]);
    await client.query("INSERT INTO claim_events(event_id,hospital_id,branch_id,claim_id,actor_user_id,event_type,occurred_at,payload,idempotency_key,fingerprint,case_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [eventId, actor.hospitalId, current.branch_id, caseId, actor.userId, eventType, action.occurredAt, JSON.stringify({ action }), value.idempotencyKey, hash, version]);
    await writeAudit(client, actor, String(current.branch_id), "claims", eventType, caseId, null, { eventId, version, stage });
    return { caseId, eventId, version, idempotent: false };
  });
}
