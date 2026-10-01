import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";

let cases: typeof import("../../src/server/cases/index.ts");
let database: typeof import("../../src/server/db/client.ts");
let authentication: typeof import("../../src/server/auth/index.ts");
let users: Awaited<ReturnType<typeof import("../../src/server/auth/seed.ts").seedAuthUsers>>;
const password = "Synthetic-Cases-Test-Only-Password!42";

before(async () => {
  cases = await import("../../src/server/cases/index.ts").catch(() => null) as typeof cases;
  assert.ok(cases, "The persisted case services must exist before the registration journey can run.");
  database = await import("../../src/server/db/client.ts");
  assert.match(String((await database.migrationPool.query("SELECT current_database() AS name")).rows[0].name), /_test$/u);
  const { seedSynthetic } = await import("../../src/server/db/seed.ts");
  await seedSynthetic(database.migrationPool);
  const { seedAuthUsers } = await import("../../src/server/auth/seed.ts");
  users = await seedAuthUsers({ password });
  authentication = await import("../../src/server/auth/index.ts");
});
after(async () => { if (database) await database.closePools(); });

async function login(key: keyof typeof users) {
  const user = users[key];
  const response = await authentication.auth.api.signInEmail({ body: { email: user.email, password }, asResponse: true });
  assert.equal(response.status, 200);
  return new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
}
async function inputs(headers: Headers, branchId = users.deskA.branchId, ownerId = users.deskA.userId) {
  const code = `P8-${randomUUID()}`;
  const data = await cases.getDeskData(headers);
  const policy = data.policies[0];
  assert.ok(policy, "The synthetic active cashless policy must be available.");
  const patient = await cases.registerPatient(headers, { patientCode: code, firstName: "Fictional", lastName: "PhaseEight" });
  const membership = await cases.addMembership(headers, { patientId: patient.id, policyId: policy.id, policyNumber: `SYN-${code}`, validFrom: "2026-01-01", validTo: "2026-12-31" });
  const encounter = await cases.registerEncounter(headers, { branchId, patientId: patient.id, encounterType: "IPD", admissionDate: "2026-10-01T10:00:00+05:30" });
  return { branchId, patientId: patient.id, patientInsuranceId: membership.id, encounterId: encounter.id, ownerId, nextAction: "Obtain and review the final bill.", creationKey: randomUUID() };
}

// These check persisted results and independently expected relationships, rather than query implementation details.
test("patient, membership, encounter and draft case persist with unknown financial amounts", async () => {
  const headers = await login("deskA");
  const value = await inputs(headers);
  const created = await cases.createCase(headers, value);
  const record = await cases.getCase(headers, created.id);
  assert.equal(record.patientId, value.patientId);
  assert.equal(record.patientInsuranceId, value.patientInsuranceId);
  assert.equal(record.encounterId, value.encounterId);
  assert.equal(record.branchId, value.branchId);
  assert.equal(record.ownerId, value.ownerId);
  assert.equal(record.status, "DRAFT");
  assert.equal(record.stage, "REGISTERED");
  assert.equal(record.version, 1);
  assert.equal(record.nextAction, value.nextAction);
  const stored = (await database.migrationPool.query("SELECT claim_type,estimated_amount,approved_amount,patient_payable_amount FROM claims WHERE claim_id=$1", [created.id])).rows[0];
  assert.equal(stored.claim_type, "CASHLESS");
  assert.equal(stored.estimated_amount, null);
  assert.equal(stored.approved_amount, null);
  assert.equal(stored.patient_payable_amount, null);
  assert.ok((await cases.getDeskData(headers)).cases.some((item) => item.id === created.id));
});
test("case creation appends one CREATED event and one audit entry in the same transaction", async () => {
  const headers = await login("deskA");
  const value = await inputs(headers);
  const created = await cases.createCase(headers, value);
  const events = await database.migrationPool.query("SELECT event_type,case_version,actor_user_id,payload FROM claim_events WHERE claim_id=$1", [created.id]);
  assert.equal(events.rowCount, 1);
  assert.equal(events.rows[0].event_type, "CREATED");
  assert.equal(events.rows[0].case_version, 1);
  assert.equal(String(events.rows[0].actor_user_id), users.deskA.userId);
  assert.equal(events.rows[0].payload.patientId, value.patientId);
  const audit = await database.migrationPool.query("SELECT count(*)::int AS count FROM audit_logs WHERE entity_type='claims' AND entity_id=$1 AND action_name='CREATED'", [created.id]);
  assert.equal(audit.rows[0].count, 1);
});
test("missing session and read-only staff cannot register records or create a case", async () => {
  await assert.rejects(cases.getDeskData(new Headers()), { status: 401 });
  const headers = await login("billingA");
  const data = await cases.getDeskData(headers);
  assert.equal(data.canRegister, false);
  assert.equal(data.canCreate, false);
  await assert.rejects(cases.registerPatient(headers, { patientCode: `NO-${randomUUID()}`, firstName: "Denied" }), { status: 403 });
  const value = await inputs(await login("deskA"));
  await assert.rejects(cases.createCase(headers, value), { status: 403 });
});
test("hospital and branch scopes reject foreign patient membership and case lookup", async () => {
  const a = await login("deskA");
  const b = await login("deskB");
  const foreign = await inputs(b, users.deskB.branchId, users.deskB.userId);
  const record = await cases.createCase(b, foreign);
  await assert.rejects(cases.getCase(a, record.id), { status: 404 });
  const data = await cases.getDeskData(a);
  assert.equal(data.cases.some((item) => item.id === record.id), false);
  assert.deepEqual(data.branches.map((branch) => branch.id), [users.deskA.branchId]);
  await assert.rejects(cases.addMembership(a, { patientId: foreign.patientId, policyId: data.policies[0].id, policyNumber: `FOREIGN-${randomUUID()}`, validFrom: "2026-01-01", validTo: "2026-12-31" }), { status: 404 });
  const value = await inputs(a);
  await assert.rejects(cases.createCase(a, { ...value, branchId: users.deskNorthA.branchId }), { status: 403 });
});
test("case creation rejects a membership or encounter belonging to another patient", async () => {
  const headers = await login("deskA");
  const first = await inputs(headers);
  const second = await inputs(headers);
  await assert.rejects(cases.createCase(headers, { ...first, patientInsuranceId: second.patientInsuranceId }), { status: 400 });
  await assert.rejects(cases.createCase(headers, { ...first, encounterId: second.encounterId }), { status: 400 });
  const result = await database.migrationPool.query("SELECT count(*)::int AS count FROM claims WHERE creation_key=$1", [first.creationKey]);
  assert.equal(result.rows[0].count, 0);
});
test("a hospital administrator cannot link a case to an encounter in a different branch", async () => {
  const headers = await login("adminA");
  const central = await inputs(headers);
  const north = await cases.registerEncounter(headers, { branchId: users.deskNorthA.branchId, patientId: central.patientId, encounterType: "IPD", admissionDate: "2026-10-01T10:00:00+05:30" });
  await assert.rejects(cases.createCase(headers, { ...central, encounterId: north.id }), { status: 400 });
});
test("unavailable policy and invalid membership dates are rejected without creating insurance links", async () => {
  const headers = await login("deskA");
  const value = await inputs(headers);
  const data = await cases.getDeskData(headers);
  await assert.rejects(cases.addMembership(headers, { patientId: value.patientId, policyId: data.policies[0].id, policyNumber: `BAD-DATES-${randomUUID()}`, validFrom: "2026-12-31", validTo: "2026-01-01" }), { status: 400 });
  await assert.rejects(cases.addMembership(headers, { patientId: value.patientId, policyId: "9223372036854775807", policyNumber: `BAD-POLICY-${randomUUID()}`, validFrom: "2026-01-01", validTo: "2026-12-31" }), { status: 400 });
});
test("inactive or wrong-branch owners cannot receive a new case", async () => {
  const headers = await login("adminA");
  const value = await inputs(headers);
  await assert.rejects(cases.createCase(headers, { ...value, ownerId: users.deskNorthA.userId }), { status: 400 });
  await database.migrationPool.query("UPDATE users SET status='INACTIVE' WHERE user_id=$1", [users.deskA.userId]);
  try { await assert.rejects(cases.createCase(headers, value), { status: 400 }); }
  finally { await database.migrationPool.query("UPDATE users SET status='ACTIVE' WHERE user_id=$1", [users.deskA.userId]); }
});
test("concurrent exact creation retries return one case, event and audit entry", async () => {
  const headers = await login("deskA");
  const value = await inputs(headers);
  const reordered = { creationKey: value.creationKey, nextAction: value.nextAction, ownerId: value.ownerId, encounterId: value.encounterId, patientInsuranceId: value.patientInsuranceId, patientId: value.patientId, branchId: value.branchId };
  const [first, second] = await Promise.all([cases.createCase(headers, value), cases.createCase(headers, reordered)]);
  assert.equal(first.id, second.id);
  const counts = await database.migrationPool.query("SELECT (SELECT count(*)::int FROM claims WHERE creation_key=$1) AS claims,(SELECT count(*)::int FROM claim_events WHERE claim_id=$2) AS events,(SELECT count(*)::int FROM audit_logs WHERE entity_type='claims' AND entity_id=$2 AND action_name='CREATED') AS audits", [value.creationKey, first.id]);
  assert.deepEqual(counts.rows[0], { claims: 1, events: 1, audits: 1 });
  await database.migrationPool.query("UPDATE claims SET version=2,next_action='Later staff action' WHERE claim_id=$1", [first.id]);
  assert.equal((await cases.createCase(headers, value)).id, first.id);
  assert.equal((await cases.getCase(headers, first.id)).nextAction, "Later staff action");
});
test("reuse of a creation key with a changed payload returns conflict and preserves original", async () => {
  const headers = await login("deskA");
  const value = await inputs(headers);
  const original = await cases.createCase(headers, value);
  await assert.rejects(cases.createCase(headers, { ...value, nextAction: "Changed action" }), { status: 409 });
  assert.equal((await cases.getCase(headers, original.id)).nextAction, value.nextAction);
});

test("the policy DTO preserves its curated category, subcategory, insurer and optional TPA", async () => {
  const data = await cases.getDeskData(await login("deskA"));
  const policy = data.policies[0];
  assert.ok(policy);
  const source = (await database.migrationPool.query(
    `SELECT p.plan_name AS name,p.policy_code AS "policyCode",cat.category_name AS "categoryName",sub.subcategory_name AS "subcategoryName",i.company_name AS "companyName",t.tpa_name AS "tpaName"
     FROM insurance_policies p JOIN insurance_companies i ON i.insurance_company_id=p.insurance_company_id
     LEFT JOIN tpas t ON t.tpa_id=p.tpa_id LEFT JOIN insurance_subcategories sub ON sub.insurance_subcategory_id=p.insurance_subcategory_id
     LEFT JOIN insurance_categories cat ON cat.insurance_category_id=sub.insurance_category_id WHERE p.policy_id=$1`, [policy.id]
  )).rows[0];
  assert.deepEqual({ name: policy.name, policyCode: policy.policyCode, categoryName: policy.categoryName, subcategoryName: policy.subcategoryName, companyName: policy.companyName, tpaName: policy.tpaName }, source);
  assert.ok(policy.categoryName);
  assert.ok(policy.subcategoryName);
  assert.ok(policy.companyName);
});
test("an inactive source policy cannot be selected or used for a new membership", async () => {
  const headers = await login("deskA");
  const value = await inputs(headers);
  const policy = (await cases.getDeskData(headers)).policies[0];
  await database.migrationPool.query("UPDATE insurance_policies SET status='INACTIVE' WHERE policy_id=$1", [policy.id]);
  try {
    assert.equal((await cases.getDeskData(headers)).policies.some((item) => item.id === policy.id), false);
    await assert.rejects(cases.addMembership(headers, { patientId: value.patientId, policyId: policy.id, policyNumber: `INACTIVE-${randomUUID()}`, validFrom: "2026-01-01", validTo: "2026-12-31" }), { status: 400 });
    await assert.rejects(cases.createCase(headers, value), { status: 400 });
  } finally { await database.migrationPool.query("UPDATE insurance_policies SET status='ACTIVE' WHERE policy_id=$1", [policy.id]); }
});

test("malformed decimal IDs fail validation with400 across service API fields", async () => {
  const headers = await login("deskA");
  const value = await inputs(headers);
  const policyId = (await cases.getDeskData(headers)).policies[0].id;
  for (const invalid of ["abc", "1.2", "", "0", "-1", "9223372036854775808", "9".repeat(1000)]) {
    await assert.rejects(cases.getCase(headers, invalid), { status: 400 });
    for (const field of ["branchId", "patientId", "patientInsuranceId", "encounterId", "ownerId"]) {
      await assert.rejects(cases.createCase(headers, { ...value, [field]: invalid }), { status: 400 });
    }
    await assert.rejects(cases.addMembership(headers, { patientId: invalid, policyId, policyNumber: "Malformed", validFrom: "2026-01-01", validTo: "2026-12-31" }), { status: 400 });
    await assert.rejects(cases.addMembership(headers, { patientId: value.patientId, policyId: invalid, policyNumber: "Malformed", validFrom: "2026-01-01", validTo: "2026-12-31" }), { status: 400 });
    await assert.rejects(cases.registerEncounter(headers, { branchId: invalid, patientId: value.patientId, encounterType: "IPD", admissionDate: "2026-10-01T10:00:00+05:30" }), { status: 400 });
    await assert.rejects(cases.registerEncounter(headers, { branchId: value.branchId, patientId: invalid, encounterType: "IPD", admissionDate: "2026-10-01T10:00:00+05:30" }), { status: 400 });
  }
});

test("deactivated related catalog records hide memberships and block new cases", async () => {
  const headers = await login("deskA");
  const value = await inputs(headers);
  const policyId = (await cases.getDeskData(headers)).policies[0].id;
  const source = (await database.migrationPool.query("SELECT p.insurance_company_id,p.tpa_id,p.insurance_subcategory_id,s.insurance_category_id FROM insurance_policies p LEFT JOIN insurance_subcategories s ON s.insurance_subcategory_id=p.insurance_subcategory_id WHERE p.policy_id=$1", [policyId])).rows[0];
  const tpaId = (await database.migrationPool.query("INSERT INTO tpas(tpa_code,tpa_name,status) VALUES($1,'Fictional catalog regression TPA','ACTIVE') RETURNING tpa_id::text AS id", [randomUUID()])).rows[0].id;
  await database.migrationPool.query("INSERT INTO insurance_company_tpas(insurance_company_id,tpa_id,status) VALUES($1,$2,'ACTIVE')", [source.insurance_company_id, tpaId]);
  await database.migrationPool.query("UPDATE insurance_policies SET tpa_id=$2 WHERE policy_id=$1", [policyId, tpaId]);
  const related = [
    { table: "insurance_companies", column: "insurance_company_id", id: source.insurance_company_id },
    { table: "tpas", column: "tpa_id", id: tpaId },
    { table: "insurance_subcategories", column: "insurance_subcategory_id", id: source.insurance_subcategory_id },
    { table: "insurance_categories", column: "insurance_category_id", id: source.insurance_category_id },
  ];
  try {
    for (const record of related) {
      assert.ok(record.id, "The regression catalog record must exist.");
      await database.migrationPool.query("UPDATE " + record.table + " SET status='INACTIVE' WHERE " + record.column + "=$1", [record.id]);
      try {
        const data = await cases.getDeskData(headers);
        assert.equal(data.policies.some((item) => item.id === policyId), false);
        assert.equal(data.memberships.some((item) => item.id === value.patientInsuranceId), false);
        await assert.rejects(cases.createCase(headers, value), { status: 400 });
      } finally { await database.migrationPool.query("UPDATE " + record.table + " SET status='ACTIVE' WHERE " + record.column + "=$1", [record.id]); }
    }
  } finally {
    await database.migrationPool.query("UPDATE insurance_policies SET tpa_id=$2 WHERE policy_id=$1", [policyId, source.tpa_id]);
    await database.migrationPool.query("DELETE FROM insurance_company_tpas WHERE tpa_id=$1", [tpaId]);
    await database.migrationPool.query("DELETE FROM tpas WHERE tpa_id=$1", [tpaId]);
  }
});

test("queue search and branch scope apply before the disclosed500case result limit", async () => {
  const headers = await login("adminA");
  const value = await inputs(headers);
  const original = await cases.createCase(headers, value);
  const originalRecord = await cases.getCase(headers, original.id);
  const northValue = await inputs(headers, users.deskNorthA.branchId, users.deskNorthA.userId);
  const north = await cases.createCase(headers, northValue);
  const prefix = randomUUID();
  // Independent synthetic bulk fixture puts both genuine service-created cases beyond the unfiltered cap.
  await database.migrationPool.query("INSERT INTO claims(hospital_id,branch_id,claim_no,patient_id,patient_insurance_id,encounter_id,claim_type,claim_stage,claim_status,created_by,assigned_to,version,next_action,created_at) SELECT hospital_id,branch_id,$2||'-'||series,patient_id,patient_insurance_id,encounter_id,'CASHLESS','REGISTERED','DRAFT',created_by,assigned_to,1,'Synthetic queue filler',now()+interval '1 minute' FROM claims CROSS JOIN generate_series(1,501) series WHERE claim_id=$1", [original.id, prefix]);
  try {
    const all = await cases.getDeskData(headers);
    assert.equal(all.cases.length, 500);
    assert.equal(all.casesTruncated, true);
    const searched = await cases.getDeskData(headers, { q: originalRecord.claimNo });
    assert.deepEqual(searched.cases.map((item) => item.id), [original.id]);
    assert.equal(searched.casesTruncated, false);
    const branch = await cases.getDeskData(headers, { branchId: users.deskNorthA.branchId });
    assert.ok(branch.cases.some((item) => item.id === north.id));
    assert.ok(branch.cases.every((item) => item.branchId === users.deskNorthA.branchId));
    assert.equal((await cases.getDeskData(headers, { q: "%" })).cases.length, 0);
  } finally { await database.migrationPool.query("DELETE FROM claims WHERE claim_no LIKE $1", [prefix + "-%"]); }
});
