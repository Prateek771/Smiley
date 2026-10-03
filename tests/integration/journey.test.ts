import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closePools, migrationPool } from "../../src/server/db/client";
import { getCase } from "../../src/server/cases";
import { uploadDocument } from "../../src/server/documents";
import { applyCaseAction } from "../../src/server/timeline";
import { workflowFixture } from "../helpers/workflow";

let service: typeof import("../../src/server/journey");
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
const now = () => new Date().toISOString();
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
before(async () => {
  fixture = await workflowFixture();
  const implementation = await import("../../src/server/journey").catch(() => null);
  assert.ok(implementation, "The evidence-backed earlier patient journey must be implemented.");
  service = implementation;
});
after(closePools);
async function setup() {
  const item = await fixture.newCase();
  async function act(action: unknown, key = randomUUID(), version?: number, headers = fixture.headers.deskA) {
    return service.applyJourneyAction(headers, item.caseId, { action, expectedVersion: version ?? (await getCase(fixture.headers.deskA, item.caseId)).version, idempotencyKey: key });
  }
  const eligibility = () => ({ type: "eligibility" as const, reference: randomUUID(), result: "ELIGIBLE" as const, validFrom: "2026-01-01", validThrough: "2026-12-31", text: "Fictional payer confirmed coverage", evidenceRevisionId: item.sources.policy, occurredAt: now(), verified: true as const });
  const eligible = async () => act(eligibility());
  return { ...item, act, eligibility, eligible };
}
const request = (eligibilityEventId: string, evidenceRevisionId: string, parentRequestId: string | null = null) => ({ type: "preauth-request", kind: parentRequestId ? "ENHANCEMENT" : "INITIAL", eligibilityEventId, parentRequestId, reference: randomUUID(), requestedPaise: parentRequestId ? 10000000 : 8000000, estimatePaise: 10000000, text: "Reviewed fictional request", evidenceRevisionId, occurredAt: now(), verified: true });
const response = (requestId: string, evidenceRevisionId: string, supersedesResponseId: string | null = null) => ({ type: "preauth-response", requestId, reference: randomUUID(), result: "APPROVED", authorizedPaise: 8000000, text: "Actual fictional payer response", supersedesResponseId, evidenceRevisionId, occurredAt: now(), verified: true });

test("registration through repeated enhancements, query acknowledgements and discharge is traceable without changing final financial facts", async () => {
  const item = await setup();
  const financialBefore = (await migrationPool.query("SELECT approved_amount,patient_payable_amount,claim_status FROM claims WHERE claim_id=$1", [item.caseId])).rows[0];
  const eligible = await item.eligible();
  const initial = await item.act(request(eligible.eventId, item.sources.preauthorization));
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).currentAuthorization, null);
  await item.act(response(initial.eventId, item.sources["payer-decision"]));
  await item.act({ type: "treatment-update", estimatePaise: 10000000, text: "Fictional treatment day one", evidenceRevisionId: item.sources["discharge-summary"], occurredAt: now(), verified: true });
  let parent = initial.eventId;
  for (const index of [1, 2]) {
    const enhancement = await item.act({ ...request(eligible.eventId, item.sources.preauthorization, parent), requestedPaise: 10000000 + index * 1000000, estimatePaise: 10000000 + index * 1000000 });
    assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).currentAuthorization?.authorizedPaise, index === 1 ? 8000000 : 9500000);
    const query = await item.act({ type: "payer-query", requestId: enhancement.eventId, reference: `JOURNEY-Q-${index}`, text: "Provide fictional treatment update", evidenceRevisionId: item.sources["payer-decision"], occurredAt: now(), verified: true });
    const prepared = await item.act({ type: "query-response-prepared", queryEventId: query.eventId, text: "Reviewed local draft", sourceRevisionIds: [item.sources["discharge-summary"]], occurredAt: now(), verified: true });
    assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).queries.at(-1)?.status, "PREPARED");
    await item.act({ type: "query-acknowledged", responseEventId: prepared.eventId, reference: `JOURNEY-ACK-${index}`, evidenceRevisionId: item.sources["payer-decision"], occurredAt: now(), verified: true });
    await item.act({ ...response(enhancement.eventId, item.sources["payer-decision"]), authorizedPaise: 8500000 + index * 1000000 });
    parent = enhancement.eventId;
  }
  await item.act({ type: "discharge-handoff", text: "Handoff to final bill and discharge preparation", evidenceRevisionId: item.sources["discharge-summary"], occurredAt: now(), verified: true });
  const journey = await service.getJourney(fixture.headers.deskA, item.caseId);
  assert.equal(journey.requests.length, 3);
  assert.equal(journey.queries.length, 2);
  assert.ok(journey.queries.every((query) => query.status === "ACKNOWLEDGED"));
  assert.equal(journey.currentAuthorization?.authorizedPaise, 10500000);
  assert.ok(journey.discharge);
  assert.equal(journey.events[0].action.type, "eligibility");
  const financialAfter = (await migrationPool.query("SELECT approved_amount,patient_payable_amount,claim_status FROM claims WHERE claim_id=$1", [item.caseId])).rows[0];
  assert.deepEqual(financialAfter, financialBefore);
  assert.equal((await getCase(fixture.headers.deskA, item.caseId)).stage, "SUBMISSION");
});

test("expired, unclear and negative eligibility cannot support a preauthorization request", async () => {
  for (const result of ["ELIGIBLE", "UNCLEAR", "NOT_ELIGIBLE"]) {
    const item = await setup();
    const eligible = await item.act({ ...item.eligibility(), result, validThrough: result === "ELIGIBLE" ? day(-1) : "2026-12-31" });
    await assert.rejects(item.act(request(eligible.eventId, item.sources.preauthorization)), { status: 409 });
    const journey = await service.getJourney(fixture.headers.deskA, item.caseId);
    assert.equal(journey.eligibilityUsable, false);
    assert.equal(journey.requests.length, 0);
  }
});

test("discharge handoff requires reviewed current treatment evidence even with a fresh discharge summary", async () => {
  const item = await setup(); const eligible = await item.eligible();
  const initial = await item.act(request(eligible.eventId, item.sources.preauthorization));
  await item.act(response(initial.eventId, item.sources["payer-decision"]));
  await item.act({ type: "treatment-update", estimatePaise: 10000000, text: "Reviewed fictional treatment", evidenceRevisionId: item.sources["discharge-summary"], occurredAt: now(), verified: true });
  const listing = await import("../../src/server/documents").then((documents) => documents.listDocuments(fixture.headers.deskA, item.caseId));
  const summary = listing.revisions.find((revision) => revision.id === item.sources["discharge-summary"])!;
  const updated = await uploadDocument(fixture.headers.deskA, item.caseId, { documentId: summary.documentId, bytes: Buffer.from("Revised fictional treatment details"), name: "summary-v2.txt", mimeType: "text/plain", documentType: "discharge-summary", idempotencyKey: randomUUID() });
  const before = await service.getJourney(fixture.headers.deskA, item.caseId);
  assert.equal(before.treatments.at(-1)?.evidenceCurrent, false);
  await assert.rejects(item.act({ type: "discharge-handoff", text: "Attempt with fresh summary but unreviewed treatment", evidenceRevisionId: updated.revisionId, occurredAt: now(), verified: true }), { status: 409 });
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).version, before.version);
  await item.act({ type: "treatment-update", estimatePaise: 10000000, text: "Treatment reviewed against revised source", evidenceRevisionId: updated.revisionId, occurredAt: now(), verified: true });
  await item.act({ type: "discharge-handoff", text: "Reviewed handoff", evidenceRevisionId: updated.revisionId, occurredAt: now(), verified: true });
  assert.ok((await service.getJourney(fixture.headers.deskA, item.caseId)).discharge);
});

test("discharge handoff cannot precede actual payer acknowledgements or later enhancement request and response events", async () => {
  const item = await setup(); const base = Date.now() - 120000;
  const at = (step: number) => new Date(base + step * 1000).toISOString();
  const eligible = await item.act({ ...item.eligibility(), occurredAt: at(0) });
  const initial = await item.act({ ...request(eligible.eventId, item.sources.preauthorization), occurredAt: at(1) });
  await item.act({ ...response(initial.eventId, item.sources["payer-decision"]), occurredAt: at(2) });
  await item.act({ type: "treatment-update", estimatePaise: 10000000, text: "Fictional treatment", evidenceRevisionId: item.sources["discharge-summary"], occurredAt: at(3), verified: true });
  const query = await item.act({ type: "payer-query", requestId: initial.eventId, reference: "HANDOFF-QUERY", text: "Later actual payer query", evidenceRevisionId: item.sources.policy, occurredAt: at(4), verified: true });
  const prepared = await item.act({ type: "query-response-prepared", queryEventId: query.eventId, text: "Reviewed answer", sourceRevisionIds: [item.sources.policy], occurredAt: at(5), verified: true });
  await item.act({ type: "query-acknowledged", responseEventId: prepared.eventId, reference: "HANDOFF-ACK", evidenceRevisionId: item.sources["payer-decision"], occurredAt: at(6), verified: true });
  const handoff = (occurredAt: string) => ({ type: "discharge-handoff", text: "Chronology checked handoff", evidenceRevisionId: item.sources["discharge-summary"], occurredAt, verified: true });
  await assert.rejects(item.act(handoff(at(3.5))), { status: 409 });
  const enhancement = await item.act({ ...request(eligible.eventId, item.sources.preauthorization, initial.eventId), occurredAt: at(7) });
  await item.act({ ...response(enhancement.eventId, item.sources["payer-decision"]), result: "REJECTED", authorizedPaise: null, occurredAt: at(8) });
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).currentAuthorization?.authorizedPaise, 8000000);
  await assert.rejects(item.act(handoff(at(6.5))), { status: 409 });
  await assert.rejects(item.act(handoff(at(7.5))), { status: 409 });
  await item.act(handoff(at(9)));
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).discharge?.occurredAt, at(9));
});

test("registered PostgreSQL policy dates and admission constrain otherwise eligible payer results", async () => {
  const item = await setup(); const eligible = await item.eligible();
  await migrationPool.query("UPDATE patient_insurance SET valid_to=$1::date WHERE patient_insurance_id=(SELECT patient_insurance_id FROM claims WHERE claim_id=$2)", [day(-1), item.caseId]);
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).eligibilityUsable, false);
  await assert.rejects(item.act(request(eligible.eventId, item.sources.preauthorization)), { status: 409 });
  const earlierAdmission = await setup(); const coveredToday = await earlierAdmission.eligible();
  await migrationPool.query("UPDATE claims SET admission_date='2025-12-01T10:00:00+05:30' WHERE claim_id=$1", [earlierAdmission.caseId]);
  assert.equal((await service.getJourney(fixture.headers.deskA, earlierAdmission.caseId)).eligibilityUsable, false);
  await assert.rejects(earlierAdmission.act(request(coveredToday.eventId, earlierAdmission.sources.preauthorization)), { status: 409 });
});

test("a revised response preserves prior payer evidence and an unclear response grants no authorization", async () => {
  const item = await setup(); const eligible = await item.eligible();
  const initial = await item.act(request(eligible.eventId, item.sources.preauthorization));
  const first = await item.act(response(initial.eventId, item.sources["payer-decision"]));
  const revised = await item.act({ ...response(initial.eventId, item.sources["payer-decision"], first.eventId), authorizedPaise: 7000000 });
  await assert.rejects(item.act(response(initial.eventId, item.sources["payer-decision"], first.eventId)), { status: 409 });
  const unclear = await item.act({ ...response(initial.eventId, item.sources["payer-decision"], revised.eventId), result: "UNCLEAR", authorizedPaise: null });
  const journey = await service.getJourney(fixture.headers.deskA, item.caseId);
  assert.equal(journey.responses.length, 3);
  assert.equal(journey.currentAuthorization, null);
  assert.equal(journey.responses.at(-1)?.id, unclear.eventId);
});

test("prepared query responses are not acknowledged and acknowledgements must match the latest prepared response", async () => {
  const item = await setup(); const eligible = await item.eligible();
  const initial = await item.act(request(eligible.eventId, item.sources.preauthorization));
  const query = await item.act({ type: "payer-query", requestId: initial.eventId, reference: "QUERY-REVISION", text: "Need source details", evidenceRevisionId: item.sources["payer-decision"], occurredAt: now(), verified: true });
  const draft = (text: string) => ({ type: "query-response-prepared", queryEventId: query.eventId, text, sourceRevisionIds: [item.sources.policy], occurredAt: now(), verified: true });
  const first = await item.act(draft("Original prepared draft"));
  await item.act(draft("Revised reviewed draft"));
  await assert.rejects(item.act({ type: "query-acknowledged", responseEventId: first.eventId, reference: "STALE-ACK", evidenceRevisionId: item.sources["payer-decision"], occurredAt: now(), verified: true }), { status: 409 });
  await assert.rejects(item.act(response(initial.eventId, item.sources["payer-decision"])), { status: 409 });
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).queries[0].status, "PREPARED");
});

test("superseding the actual query evidence requires renewed review before recording approval", async () => {
  const item = await setup(); const eligible = await item.eligible();
  const initial = await item.act(request(eligible.eventId, item.sources.preauthorization));
  const query = await item.act({ type: "payer-query", requestId: initial.eventId, reference: "SOURCE-CHANGED", text: "Need source details", evidenceRevisionId: item.sources["discharge-summary"], occurredAt: now(), verified: true });
  const prepared = await item.act({ type: "query-response-prepared", queryEventId: query.eventId, text: "Reviewed response", sourceRevisionIds: [item.sources.policy], occurredAt: now(), verified: true });
  await item.act({ type: "query-acknowledged", responseEventId: prepared.eventId, reference: "SOURCE-CHANGED-ACK", evidenceRevisionId: item.sources["payer-decision"], occurredAt: now(), verified: true });
  const listing = await import("../../src/server/documents").then((documents) => documents.listDocuments(fixture.headers.deskA, item.caseId));
  const summary = listing.revisions.find((revision) => revision.id === item.sources["discharge-summary"])!;
  const updated = await uploadDocument(fixture.headers.deskA, item.caseId, { documentId: summary.documentId, bytes: Buffer.from("Revised fictional query source"), name: "summary-v2.txt", mimeType: "text/plain", documentType: "discharge-summary", idempotencyKey: randomUUID() });
  await assert.rejects(item.act(response(initial.eventId, item.sources["payer-decision"])), { status: 409 });
  assert.notEqual((await service.getJourney(fixture.headers.deskA, item.caseId)).queries[0].status, "ACKNOWLEDGED");
  const revised = await item.act({ type: "payer-query", requestId: initial.eventId, supersedesQueryId: query.eventId, reference: "SOURCE-CHANGED", text: "Revised query reviewed against current source", evidenceRevisionId: updated.revisionId, occurredAt: now(), verified: true });
  const reviewed = await item.act({ type: "query-response-prepared", queryEventId: revised.eventId, text: "Response against the revised query", sourceRevisionIds: [item.sources.policy], occurredAt: now(), verified: true });
  await item.act({ type: "query-acknowledged", responseEventId: reviewed.eventId, reference: "REVISED-SOURCE-ACK", evidenceRevisionId: item.sources["payer-decision"], occurredAt: now(), verified: true });
  await item.act(response(initial.eventId, item.sources["payer-decision"]));
  const recovered = await service.getJourney(fixture.headers.deskA, item.caseId);
  assert.equal(recovered.queries.length, 1); assert.equal(recovered.queries[0].status, "ACKNOWLEDGED");
  assert.equal(recovered.events.filter((event) => event.action.type === "payer-query").length, 2);
});

test("a sent request amendment restores stale evidence without dropping its query work or prior actual authorization", async () => {
  const item = await setup(); const eligible = await item.eligible();
  const originalAction = request(eligible.eventId, item.sources.preauthorization);
  const original = await item.act(originalAction);
  const firstResponse = await item.act(response(original.eventId, item.sources["payer-decision"]));
  const query = await item.act({ type: "payer-query", requestId: original.eventId, reference: "AMENDED-REQUEST-QUERY", text: "Actual follow-up query", evidenceRevisionId: item.sources.policy, occurredAt: now(), verified: true });
  const listing = await import("../../src/server/documents").then((documents) => documents.listDocuments(fixture.headers.deskA, item.caseId));
  const source = listing.revisions.find((revision) => revision.id === item.sources.preauthorization)!;
  const updated = await uploadDocument(fixture.headers.deskA, item.caseId, { documentId: source.documentId, bytes: Buffer.from("Fictional amended sent request"), name: "preauthorization-v2.txt", mimeType: "text/plain", documentType: "preauthorization", idempotencyKey: randomUUID() });
  await assert.rejects(item.act(response(original.eventId, item.sources["payer-decision"], firstResponse.eventId)), { status: 409 });
  const amended = await item.act({ ...originalAction, supersedesRequestId: original.eventId, evidenceRevisionId: updated.revisionId, occurredAt: now() });
  const state = await service.getJourney(fixture.headers.deskA, item.caseId);
  assert.equal(state.currentAuthorization?.authorizedPaise, 8000000);
  assert.deepEqual(state.pendingRequestIds, [amended.eventId]);
  assert.equal(state.queries[0].requestId, amended.eventId);
  await assert.rejects(item.act(response(amended.eventId, item.sources["payer-decision"])), { status: 409 });
  const prepared = await item.act({ type: "query-response-prepared", queryEventId: query.eventId, text: "Amended request reviewed against sources", sourceRevisionIds: [updated.revisionId], occurredAt: now(), verified: true });
  await item.act({ type: "query-acknowledged", responseEventId: prepared.eventId, reference: "AMENDED-ACK", evidenceRevisionId: item.sources["payer-decision"], occurredAt: now(), verified: true });
  await item.act({ ...response(amended.eventId, item.sources["payer-decision"]), authorizedPaise: 7500000 });
  await assert.rejects(item.act({ ...originalAction, supersedesRequestId: original.eventId, evidenceRevisionId: updated.revisionId, occurredAt: now() }), { status: 409 });
  const reviewed = await service.getJourney(fixture.headers.deskA, item.caseId);
  assert.equal(reviewed.currentAuthorization?.authorizedPaise, 7500000);
  assert.equal(reviewed.responses.length, 2);
  assert.equal(reviewed.events.filter((event) => event.action.type === "preauth-request").length, 2);
});

test("exact retries append once while stale concurrent updates and reused keys cannot lose work", async () => {
  const item = await setup(); const version = (await getCase(fixture.headers.deskA, item.caseId)).version;
  const action = item.eligibility(); const key = randomUUID();
  const first = await item.act(action, key, version);
  const retry = await item.act(action, key, version);
  assert.equal(retry.eventId, first.eventId); assert.equal(retry.idempotent, true);
  await assert.rejects(item.act({ ...action, text: "Changed evidence" }, key, version), { status: 409 });
  await assert.rejects(item.act(item.eligibility(), randomUUID(), version), { status: 409 });
  const currentVersion = (await getCase(fixture.headers.deskA, item.caseId)).version;
  const competing = await Promise.allSettled([item.act(item.eligibility(), randomUUID(), currentVersion), item.act(item.eligibility(), randomUUID(), currentVersion)]);
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((competing.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.status, 409);
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).events.length, 2);
});

test("an enhancement amendment must still request a total above the current actual authorization", async () => {
  const item = await setup(); const eligible = await item.eligible();
  const initial = await item.act(request(eligible.eventId, item.sources.preauthorization));
  await item.act(response(initial.eventId, item.sources["payer-decision"]));
  const enhancementAction = request(eligible.eventId, item.sources.preauthorization, initial.eventId);
  const enhancement = await item.act(enhancementAction);
  const before = await service.getJourney(fixture.headers.deskA, item.caseId);
  for (const requestedPaise of [7000000, 8000000]) {
    await assert.rejects(item.act({ ...enhancementAction, supersedesRequestId: enhancement.eventId, requestedPaise, occurredAt: now() }), { status: 409 });
  }
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).version, before.version);
  const amended = await item.act({ ...enhancementAction, supersedesRequestId: enhancement.eventId, requestedPaise: 9000000, occurredAt: now() });
  const after = await service.getJourney(fixture.headers.deskA, item.caseId);
  assert.deepEqual(after.pendingRequestIds, [amended.eventId]);
  assert.equal(after.currentAuthorization?.authorizedPaise, 8000000);
  assert.equal(after.requests.at(-1)?.action.parentRequestId, initial.eventId);
});

test("journey rejects stale evidence, foreign evidence and request IDs from other cases", async () => {
  const item = await setup(); const other = await setup();
  const eligible = await item.eligible();
  const initial = await item.act(request(eligible.eventId, item.sources.preauthorization));
  await assert.rejects(other.act(response(initial.eventId, other.sources["payer-decision"])), { status: 409 });
  await assert.rejects(item.act({ ...item.eligibility(), evidenceRevisionId: other.sources.policy }), { status: 400 });
  const listing = await import("../../src/server/documents").then((documents) => documents.listDocuments(fixture.headers.deskA, item.caseId));
  const policy = listing.revisions.find((revision) => revision.id === item.sources.policy)!;
  await uploadDocument(fixture.headers.deskA, item.caseId, { documentId: policy.documentId, bytes: Buffer.from("Revised fictional policy"), name: "policy-v2.txt", mimeType: "text/plain", documentType: "policy", idempotencyKey: randomUUID() });
  await assert.rejects(item.act(request(eligible.eventId, item.sources.preauthorization, initial.eventId)), { status: 409 });
  assert.equal((await service.getJourney(fixture.headers.deskA, item.caseId)).eligibilityUsable, false);
});

test("wrong role, hospital or branch cannot write the journey and cancelled cases cannot resume", async () => {
  const item = await setup();
  await assert.rejects(item.act(item.eligibility(), randomUUID(), undefined, fixture.headers.billingA), { status: 403 });
  await assert.rejects(item.act(item.eligibility(), randomUUID(), undefined, fixture.headers.deskB), { status: 404 });
  await assert.rejects(item.act(item.eligibility(), randomUUID(), undefined, fixture.headers.deskNorthA), { status: 404 });
  await assert.rejects(service.getJourney(fixture.headers.deskB, item.caseId), { status: 404 });
  await applyCaseAction(fixture.headers.deskA, item.caseId, { expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, idempotencyKey: randomUUID(), action: { type: "status", status: "CANCELLED", reason: "Withdraw fictional case" } });
  await assert.rejects(item.eligible(), { status: 409 });
});

test("money, chronology and enhancement lineage must be explicit and exact", async () => {
  const item = await setup(); const eligible = await item.eligible();
  await assert.rejects(item.act({ ...request(eligible.eventId, item.sources.preauthorization), requestedPaise: 0.1 }), { status: 400 });
  await assert.rejects(item.act(request(eligible.eventId, item.sources.preauthorization, randomUUID())), { status: 409 });
  const initial = await item.act(request(eligible.eventId, item.sources.preauthorization));
  await assert.rejects(item.act({ ...response(initial.eventId, item.sources["payer-decision"]), occurredAt: "2026-01-01T00:00:00Z" }), { status: 409 });
  await assert.rejects(item.act({ ...response(initial.eventId, item.sources["payer-decision"]), result: "UNCLEAR", authorizedPaise: 8000000 }), { status: 400 });
  await assert.rejects(item.act(request(eligible.eventId, item.sources.preauthorization, initial.eventId)), { status: 409 });
});

test("journey HTTP writes require the staff origin and retain a scoped uncached read history", async () => {
  const routes = await import("../../src/app/api/cases/[caseId]/journey/route");
  const item = await setup(); const context = { params: Promise.resolve({ caseId: item.caseId }) };
  const url = `${process.env.BETTER_AUTH_URL}/api/cases/${item.caseId}/journey`;
  assert.equal((await routes.GET(new Request(url), context)).status, 401);
  assert.equal((await routes.GET(new Request(url, { headers: fixture.headers.deskB }), context)).status, 404);
  const headers = new Headers(fixture.headers.deskA); headers.set("content-type", "application/json");
  const body = JSON.stringify({ expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, idempotencyKey: randomUUID(), action: item.eligibility() });
  assert.equal((await routes.POST(new Request(url, { method: "POST", headers, body }), context)).status, 403);
  headers.set("origin", new URL(process.env.BETTER_AUTH_URL!).origin);
  assert.equal((await routes.POST(new Request(url, { method: "POST", headers, body }), context)).status, 200);
  const snapshot = await routes.GET(new Request(url, { headers }), context);
  assert.equal(snapshot.status, 200); assert.equal(snapshot.headers.get("cache-control"), "no-store");
  assert.equal((await snapshot.json()).events[0].action.evidenceRevisionId, item.sources.policy);
});
