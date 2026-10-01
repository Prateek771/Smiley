import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { closePools, migrationPool } from "../../src/server/db/client";
import { seedSynthetic } from "../../src/server/db/seed";
import { auth } from "../../src/server/auth";
import { seedAuthUsers } from "../../src/server/auth/seed";
import { getDeskData, createCase } from "../../src/server/cases";

let timeline: typeof import("../../src/server/timeline");
let users: Awaited<ReturnType<typeof seedAuthUsers>>;
let desk: Headers;
let billing: Headers;
let otherHospital: Headers;
let caseId: string;
let ownerId: string;

async function login(key: keyof typeof users) {
  const result = await auth.api.signInEmail({ body: { email: users[key].email, password: users[key].password }, asResponse: true });
  assert.equal(result.status, 200);
  return new Headers({ cookie: result.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ") });
}
async function newCase() {
  const data = await getDeskData(desk);
  const branchId = users.deskA.branchId;
  const encounter = data.encounters.find((item) => item.branchId === branchId)!;
  const membership = data.memberships.find((item) => item.patientId === encounter.patientId)!;
  assert.ok(encounter && membership);
  const result = await createCase(desk, { branchId, patientId: encounter.patientId, patientInsuranceId: membership.id,
    encounterId: encounter.id, ownerId: users.deskA.userId, nextAction: "Prepare synthetic source documents", creationKey: randomUUID() });
  return result.id;
}
before(async () => {
  const database = await migrationPool.query("SELECT current_database() AS name");
  assert.match(database.rows[0].name, /_test$/u);
  await seedSynthetic(); users = await seedAuthUsers();
  desk = await login("deskA"); billing = await login("billingA"); otherHospital = await login("deskB");
  caseId = await newCase(); ownerId = users.deskA.userId;
  const implementation = await import("../../src/server/timeline").catch(() => null);
  assert.ok(implementation, "Controlled case actions and immutable event history must be implemented.");
  timeline = implementation;
});
after(closePools);
const edit = (nextAction: string) => ({ type: "edit" as const, ownerId, nextAction, dueAt: null });
const request = (expectedVersion: number, action: unknown, key = randomUUID()) => ({ expectedVersion, idempotencyKey: key, action });

test("versioned edit records the actor and immutable before/after history", async () => {
  const result = await timeline.applyCaseAction(desk, caseId, request(1, edit("Verify discharge summary")));
  assert.equal(result.version, 2);
  const history = await timeline.getCaseTimeline(desk, caseId);
  const event = history.events.find((item) => item.event_id === result.eventId)!;
  assert.equal(event.event_type, "CASE_EDITED");
  assert.equal(event.payload.after.nextAction, "Verify discharge summary");
  const audit = await migrationPool.query("SELECT count(*)::int AS count FROM audit_logs WHERE entity_id=$1 AND action_name='CASE_EDITED'", [caseId]);
  assert.equal(audit.rows[0].count, 1);
});
test("exact retry reuses its event while conflicting action-key content is rejected", async () => {
  const isolated = await newCase(); const key = randomUUID(); const body = request(1, edit("Review policy source"), key);
  const first = await timeline.applyCaseAction(desk, isolated, body);
  const repeated = await timeline.applyCaseAction(desk, isolated, body);
  assert.equal(repeated.eventId, first.eventId); assert.equal(repeated.version, 2); assert.equal(repeated.idempotent, true);
  await assert.rejects(timeline.applyCaseAction(desk, isolated, request(1, edit("Different content"), key)), { status: 409 });
});
test("two stale concurrent edits yield one persisted update, never lost work", async () => {
  const isolated = await newCase();
  const results = await Promise.allSettled([
    timeline.applyCaseAction(desk, isolated, request(1, edit("First officer"))),
    timeline.applyCaseAction(desk, isolated, request(1, edit("Second officer"))),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const failure = results.find((item) => item.status === "rejected") as PromiseRejectedResult;
  assert.equal(failure.reason.status, 409);
  const stored = await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [isolated]);
  assert.equal(stored.rows[0].version, 2);
});
test("same action submitted concurrently appends only once", async () => {
  const isolated = await newCase(); const body = request(1, edit("One action"));
  const results = await Promise.all([timeline.applyCaseAction(desk, isolated, body), timeline.applyCaseAction(desk, isolated, body)]);
  assert.equal(results[0].eventId, results[1].eventId);
  assert.equal(results.filter((item) => item.idempotent).length, 1);
});
test("payer and settlement outcomes are unavailable in the preparation API", async () => {
  for (const status of ["APPROVED", "REJECTED", "SETTLED"]) {
    await assert.rejects(timeline.applyCaseAction(desk, caseId, request(2, { type: "status", status, reason: "Invented decision" })), { status: 400 });
  }
  const values = await migrationPool.query("SELECT approved_amount,patient_payable_amount FROM claims WHERE claim_id=$1", [caseId]);
  assert.equal(values.rows[0].approved_amount, null); assert.equal(values.rows[0].patient_payable_amount, null);
});
test("Billing cannot prepare cases and another hospital cannot read or mutate this timeline", async () => {
  await assert.rejects(timeline.applyCaseAction(billing, caseId, request(2, edit("Forbidden"))), { status: 403 });
  await assert.rejects(timeline.getCaseTimeline(otherHospital, caseId), { status: 404 });
  await assert.rejects(timeline.applyCaseAction(otherHospital, caseId, request(2, edit("Forbidden"))), { status: 404 });
});
test("query references are unique per case and every prepared response remains in history", async () => {
  const isolated = await newCase();
  await timeline.applyCaseAction(desk, isolated, request(1, { type: "status", status: "PENDING", reason: "Pack preparation begins" }));
  await timeline.applyCaseAction(desk, isolated, request(2, { type: "status", status: "IN_PROGRESS", reason: "Staff is reviewing" }));
  await timeline.applyCaseAction(desk, isolated, request(3, { type: "query-open", reference: "Q-ONE", text: "Need summary" }));
  await timeline.applyCaseAction(desk, isolated, request(4, { type: "query-open", reference: "Q-TWO", text: "Need revised bill" }));
  await assert.rejects(timeline.applyCaseAction(desk, isolated, request(5, { type: "query-open", reference: "Q-ONE", text: "Duplicate reference" })), { status: 409 });
  await timeline.applyCaseAction(desk, isolated, request(5, { type: "query-response", reference: "Q-ONE", text: "First prepared response" }));
  await timeline.applyCaseAction(desk, isolated, request(6, { type: "query-response", reference: "Q-ONE", text: "Revised prepared response" }));
  const history = await timeline.getCaseTimeline(desk, isolated);
  assert.equal(history.queries.length, 2);
  assert.equal(history.events.filter((item) => item.event_type === "QUERY_RESPONSE_PREPARED").length, 2);
  assert.equal(history.queries.find((item) => item.external_reference === "Q-ONE")?.status, "RESPONDED");
  assert.equal(history.queries.find((item) => item.external_reference === "Q-TWO")?.status, "OPEN");
  const stored = await migrationPool.query("SELECT claim_status FROM claims WHERE claim_id=$1", [isolated]);
  assert.equal(stored.rows[0].claim_status, "QUERY");
});
test("even migration writes cannot silently change or delete persisted events", async () => {
  await assert.rejects(migrationPool.query("UPDATE claim_events SET payload='{}'::jsonb WHERE claim_id=$1", [caseId]));
  await assert.rejects(migrationPool.query("DELETE FROM claim_events WHERE claim_id=$1", [caseId]));
  await assert.rejects(migrationPool.query("UPDATE audit_logs SET new_data='{}'::jsonb WHERE entity_id=$1", [caseId]));
});

test("malformed decimal IDs return validation errors without throwing conversion exceptions", async () => {
  for (const malformed of ["abc", "1.2", "0", "-1", "9223372036854775808"]) {
    await assert.rejects(timeline.applyCaseAction(desk, malformed, request(1, edit("Invalid case"))), { status: 400 });
    await assert.rejects(timeline.getCaseTimeline(desk, malformed), { status: 400 });
    await assert.rejects(timeline.applyCaseAction(desk, caseId, request(2, { ...edit("Invalid owner"), ownerId: malformed })), { status: 400 });
  }
});

test("preparation cannot skip readiness, move backwards or resume after cancellation", async () => {
  const isolated = await newCase();
  await assert.rejects(timeline.applyCaseAction(desk, isolated, request(1, { type: "status", status: "IN_PROGRESS", reason: "Skip readiness" })), { status: 409 });
  await assert.rejects(timeline.applyCaseAction(desk, isolated, request(1, { type: "query-open", reference: "EARLY", text: "Before preparation" })), { status: 409 });
  await migrationPool.query("INSERT INTO claim_queries(hospital_id,branch_id,claim_id,query_no,external_reference,query_text) VALUES($1,$2,$3,$4,'LEGACY','Synthetic imported query')", [users.deskA.hospitalId, users.deskA.branchId, isolated, `SYN-LEGACY-${randomUUID()}`]);
  await assert.rejects(timeline.applyCaseAction(desk, isolated, request(1, { type: "query-response", reference: "LEGACY", text: "Respond before preparation" })), { status: 409 });
  await timeline.applyCaseAction(desk, isolated, request(1, { type: "status", status: "PENDING", reason: "Ready for review" }));
  await timeline.applyCaseAction(desk, isolated, request(2, { type: "status", status: "IN_PROGRESS", reason: "Review started" }));
  await assert.rejects(timeline.applyCaseAction(desk, isolated, request(3, { type: "status", status: "PENDING", reason: "Move backwards" })), { status: 409 });
  await timeline.applyCaseAction(desk, isolated, request(3, { type: "status", status: "CANCELLED", reason: "Withdraw synthetic preparation" }));
  await assert.rejects(timeline.applyCaseAction(desk, isolated, request(4, edit("Resume a cancelled case"))), { status: 409 });
  assert.equal((await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [isolated])).rows[0].version, 4);
});
