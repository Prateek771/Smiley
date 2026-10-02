import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { closePools, migrationPool } from "../../src/server/db/client";
import { seedSynthetic } from "../../src/server/db/seed";
import { auth } from "../../src/server/auth";
import { seedAuthUsers } from "../../src/server/auth/seed";
import { createCase, getCase, getDeskData } from "../../src/server/cases";
import { uploadDocument } from "../../src/server/documents";

let financial: typeof import("../../src/server/financial");
let users: Awaited<ReturnType<typeof seedAuthUsers>>;
const staff: Record<string, Headers> = {};
let caseId: string; let revisionId: string;
const bill = { serviceDate: "2026-10-02", lines: [{ description: "Synthetic treatment", grossPaise: 10000000, excludedPaise: 800000, reductionPaise: 700000 }] };
const rule = { version: "SYN-DISCHARGE-1", validFrom: "2026-01-01", validTo: "2026-12-31", deductiblePaise: 0, copayBps: 0, benefitLimitPaise: 20000000, tariffCapsPaise: [] };
async function login(key: keyof typeof users) {
  const response = await auth.api.signInEmail({ body: { email: users[key].email, password: users[key].password }, asResponse: true });
  assert.equal(response.status, 200);
  return new Headers({ cookie: response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ") });
}
async function act(key: string, action: unknown, requestKey = randomUUID(), version?: number) {
  return financial.applyFinancialAction(staff[key], caseId, { expectedVersion: version ?? (await getCase(staff.deskA, caseId)).version, idempotencyKey: requestKey, action });
}
before(async () => {
  assert.match((await migrationPool.query("SELECT current_database() AS name")).rows[0].name, /_test$/u);
  await seedSynthetic(); users = await seedAuthUsers();
  for (const key of ["deskA", "billingA", "financeA", "deskB", "deskNorthA"] as const) staff[key] = await login(key);
  const data = await getDeskData(staff.deskA); const encounter = data.encounters.find((entry) => entry.branchId === users.deskA.branchId)!;
  const membership = data.memberships.find((entry) => entry.patientId === encounter.patientId)!;
  // Financial tests pin a known coverage interval, independently of wall-clock fixtures.
  await migrationPool.query("UPDATE patient_insurance SET valid_from='2026-01-01',valid_to='2026-12-31' WHERE patient_insurance_id=$1", [membership.id]);
  caseId = (await createCase(staff.deskA, { branchId: encounter.branchId, patientId: encounter.patientId, patientInsuranceId: membership.id, encounterId: encounter.id, ownerId: users.deskA.userId, nextAction: "Review synthetic discharge", creationKey: randomUUID() })).id;
  const upload = await uploadDocument(staff.deskA, caseId, { bytes: Buffer.from("Fictional reviewed bill and reduction evidence"), name: "synthetic-financial-source.txt", mimeType: "text/plain", documentType: "final-bill", idempotencyKey: randomUUID() });
  revisionId = upload.revisionId;
  const implementation = await import("../../src/server/financial").catch(() => null);
  assert.ok(implementation, "Implement versioned scoped financial case actions."); financial = implementation;
});
after(closePools);

test("Billing stores a bill revision and assessment; Desk cannot write financial estimates", async () => {
  const action = { type: "bill", bill, sourceRevisionId: revisionId, reductionRevisionId: revisionId, verified: true };
  await assert.rejects(act("deskA", action), { status: 403 });
  const saved = await act("billingA", action);
  const estimate = await act("billingA", { type: "assess", billId: saved.recordId, rule, policyRevisionId: revisionId, verified: true });
  const detail = await financial.getFinancialCase(staff.deskA, caseId);
  assert.equal(detail.bill?.id, saved.recordId); assert.equal(detail.assessment?.id, estimate.recordId);
  assert.equal(detail.assessment?.payload.result.insurerPaise, 8500000);
  assert.equal(detail.assessment?.payload.result.patientPaise, 800000);
  assert.equal(detail.patientConfirmedPaise, null);
});

test("financial retries preserve one immutable record and reject changed keys and stale versions", async () => {
  const version = (await getCase(staff.deskA, caseId)).version; const key = randomUUID();
  const action = { type: "bill", bill, sourceRevisionId: revisionId, reductionRevisionId: revisionId, verified: true };
  const first = await act("billingA", action, key, version); const retry = await act("billingA", action, key, version);
  assert.equal(first.recordId, retry.recordId); assert.equal(retry.idempotent, true);
  await assert.rejects(act("billingA", { ...action, bill: { ...bill, serviceDate: "2026-10-03" } }, key, version), { status: 409 });
  await assert.rejects(act("billingA", action, randomUUID(), version), { status: 409 });
  assert.equal((await financial.getFinancialCase(staff.deskA, caseId)).assessment, null);
  await assert.rejects(migrationPool.query("UPDATE claim_records SET payload='{}' WHERE id=$1", [first.recordId]), { code: "42501" });
});

test("financial evidence and records cannot cross assigned branch or hospital", async () => {
  await assert.rejects(financial.getFinancialCase(staff.deskB, caseId), { status: 404 });
  await assert.rejects(financial.getFinancialCase(staff.deskNorthA, caseId), { status: 404 });
  await assert.rejects(act("billingA", { type: "bill", bill, sourceRevisionId: randomUUID(), reductionRevisionId: revisionId, verified: true }), { status: 400 });
});
