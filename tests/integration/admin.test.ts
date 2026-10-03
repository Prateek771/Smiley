import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { auth, createAuth, requireStaffSession, type StaffSession } from "../../src/server/auth";
import { disableStaff } from "../../src/server/auth/staff";
import { appPool, migrationPool } from "../../src/server/db/client";
import { workflowFixture, syntheticRule } from "../helpers/workflow";
import { adminData, applyAdminAction, platformData, applyPlatformAction } from "../../src/server/admin";
import { getFinancialCase } from "../../src/server/financial";
import { withActorTransaction } from "../../src/server/access";
import { GET as adminGET, POST as adminPOST } from "../../src/app/api/admin/route";
import { GET as platformGET } from "../../src/app/api/platform/route";
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
before(async () => {
  fixture = await workflowFixture();
  for (const key of ["adminA", "adminB", "platform"] as const) {
    const user = fixture.users[key];
    const response = await auth.api.signInEmail({ body: { email: user.email, password: user.password }, asResponse: true });
    fixture.headers[key] = new Headers({ cookie: response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ") });
  }
});
after(async () => { await appPool.end(); await migrationPool.end(); });
async function raceAdministrator(hospitalId: string, role: "HOSPITAL_ADMIN" | "SUPER_ADMIN") {
  const roleId = (await migrationPool.query("SELECT role_id FROM roles WHERE role_code=$1 AND status='ACTIVE'", [role])).rows[0].role_id;
  const email = `race-${randomUUID()}@smiley.test`;
  const password = "Synthetic-Race-Password-Only!42";
  const created = await createAuth(migrationPool).api.signUpEmail({ body: { email, name: "Fictional race administrator", password } });
  const staffId = (await migrationPool.query("INSERT INTO staff(hospital_id,employee_code,first_name,email,status) VALUES($1,$2,$3,$4,'ACTIVE') RETURNING staff_id", [hospitalId, `RACE-${randomUUID()}`, "Fictional race administrator", email])).rows[0].staff_id;
  const userId = (await migrationPool.query("INSERT INTO users(hospital_id,auth_user_id,staff_id,username,email,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING user_id", [hospitalId, created.user.id, staffId, created.user.id, email])).rows[0].user_id;
  await migrationPool.query("INSERT INTO user_roles(hospital_id,user_id,role_id) VALUES($1,$2,$3)", [hospitalId, userId, roleId]);
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  assert.equal(response.status, 200);
  const headers = new Headers({ cookie: response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ") });
  return { actor: await requireStaffSession(headers), headers };
}
test("hospital administration denies desk staff and excludes other hospitals and token hashes", async () => {
  await assert.rejects(adminData(fixture.headers.deskA), { status: 403 });
  const data = await adminData(fixture.headers.adminA);
  assert.equal(data.hospital.id, fixture.users.adminA.hospitalId);
  assert.ok(data.staff.every((user) => user.hospitalId === data.hospital.id));
  assert.equal(JSON.stringify(data).includes("token_hash"), false);
  await assert.rejects(applyAdminAction(fixture.headers.adminA, { type: "disable", userId: fixture.users.deskB.userId }), { status: 404 });
});
test("hospital admins create and revoke invitations without permitting platform grants", async () => {
  const invited = await applyAdminAction(fixture.headers.adminA, { type: "invite", email: `${randomUUID()}@smiley.test`, branchId: fixture.users.deskA.branchId, role: "REPORT_USER" });
  assert.ok(invited.url);
  await applyAdminAction(fixture.headers.adminA, { type: "revoke-invitation", invitationId: invited.id });
  const data = await adminData(fixture.headers.adminA);
  assert.equal(data.invitations.find((row) => row.id === invited.id)?.status, "REVOKED");
  await assert.rejects(applyAdminAction(fixture.headers.adminA, { type: "grant", userId: fixture.users.deskA.userId, branchId: fixture.users.deskA.branchId, role: "SUPER_ADMIN" }), { status: 400 });
});
test("approved rule revisions are immutable and retired versions cannot produce new assessments", async () => {
  const data = await adminData(fixture.headers.adminA);
  const id = (await applyAdminAction(fixture.headers.adminA, { type: "rule-create", policyId: data.policies[0].id, name: `Synthetic ${randomUUID()}`, rule: syntheticRule, reason: "Synthetic reviewed rule" })).id;
  await applyAdminAction(fixture.headers.adminA, { type: "rule-state", ruleId: id, expectedVersion: 1, status: "APPROVED", reason: "Reviewed fictional policy" });
  await assert.rejects(withActorTransaction(fixture.headers.adminA, "staff:manage", undefined, (client) => client.query("UPDATE rule_revisions SET name='changed' WHERE id=$1", [id])), { code: "42501" });
  await assert.rejects(applyAdminAction(fixture.headers.adminB, { type: "rule-state", ruleId: id, expectedVersion: 2, status: "RETIRED", reason: "Outside hospital" }), { status: 404 });
  await assert.rejects(applyAdminAction(fixture.headers.adminA, { type: "rule-state", ruleId: id, expectedVersion: 1, status: "RETIRED", reason: "Stale request" }), { status: 409 });
  const item = await fixture.newCase();
  const assessed = await item.act("billingA", { type: "assess", billId: item.bill.recordId, rule: null, registeredRuleId: id, policyRevisionId: item.sources.policy, verified: true });
  assert.equal((await getFinancialCase(fixture.headers.billingA, item.caseId)).assessment?.id, assessed.recordId);
  await applyAdminAction(fixture.headers.adminA, { type: "rule-state", ruleId: id, expectedVersion: 2, status: "RETIRED", reason: "Superseded synthetic revision" });
  await assert.rejects(item.act("billingA", { type: "assess", billId: item.bill.recordId, rule: null, registeredRuleId: id, policyRevisionId: item.sources.policy, verified: true }), { status: 409 });
});
test("branch grant revocation is enforced for an existing staff session", async () => {
  const input = { userId: fixture.users.deskA.userId, branchId: fixture.users.deskNorthA.branchId, role: "REPORT_USER", reason: "Synthetic reporting assignment" };
  await applyAdminAction(fixture.headers.adminA, { type: "grant", ...input });
  const { getReport } = await import("../../src/server/reporting");
  await getReport(fixture.headers.deskA, { mode: "desk", branchId: input.branchId });
  await applyAdminAction(fixture.headers.adminA, { type: "revoke-grant", ...input });
  await assert.rejects(getReport(fixture.headers.deskA, { mode: "desk", branchId: input.branchId }), { status: 403 });
});

test("hospital rule registry assesses a supported version independent of synthetic fixture identifiers", async () => {
  const data = await adminData(fixture.headers.adminA);
  const rule = { ...syntheticRule, version: "CASHLESS-DISCHARGE-1" };
  const created = await applyAdminAction(fixture.headers.adminA, {
    type: "rule-create", policyId: data.policies[0].id, name: "Reviewed discharge benefit",
    rule, reason: "Policy evidence reviewed by hospital administration",
  });
  await applyAdminAction(fixture.headers.adminA, {
    type: "rule-state", ruleId: created.id, expectedVersion: 1, status: "APPROVED", reason: "Reviewed calculation inputs",
  });
  try {
    const item = await fixture.newCase();
    await item.act("billingA", { type: "assess", billId: item.bill.recordId, rule: null, registeredRuleId: created.id, policyRevisionId: item.sources.policy, verified: true });
    const financial = await getFinancialCase(fixture.headers.billingA, item.caseId);
    assert.equal(financial.assessment?.payload.rule?.version, "CASHLESS-DISCHARGE-1");
    assert.equal(financial.assessment?.payload.result.status, "READY");
    assert.equal(financial.assessment?.payload.ruleSource, "approved-registry");
    assert.equal(financial.decision, null);
    await item.act("billingA", { type: "assess", billId: item.bill.recordId, rule, policyRevisionId: item.sources.policy, verified: true });
    assert.equal((await getFinancialCase(fixture.headers.billingA, item.caseId)).assessment?.payload.ruleSource, "manual-reviewed");
  } finally {
    await applyAdminAction(fixture.headers.adminA, {
      type: "rule-state", ruleId: created.id, expectedVersion: 2, status: "RETIRED", reason: "Calculation test completed",
    });
  }
});
test("unsupported rules, nonfinite money and self disabling are denied", async () => {
  const data = await adminData(fixture.headers.adminA);
  const action = { type: "rule-create", policyId: data.policies[0].id, name: "Invalid synthetic rule", reason: "Negative probe" };
  await assert.rejects(applyAdminAction(fixture.headers.adminA, { ...action, rule: { ...syntheticRule, deductiblePaise: Infinity } }), { status: 400 });
  await assert.rejects(applyAdminAction(fixture.headers.adminA, { ...action, rule: { ...syntheticRule, version: "unsupported" } }), { status: 400 });
  await assert.rejects(applyAdminAction(fixture.headers.adminA, { type: "disable", userId: fixture.users.adminA.userId }), { status: 409 });
});
test("platform registry can maintain metadata while clinical access remains denied", async () => {
  await assert.rejects(platformData(fixture.headers.adminA), { status: 403 });
  const result = await applyPlatformAction(fixture.headers.platform, { type: "hospital-create", code: `SYN-REG-${randomUUID().slice(0, 12)}`, name: "Fictional hospital registry" });
  assert.ok((await platformData(fixture.headers.platform)).hospitals.some((row) => row.id === result.id));
  await assert.rejects(getFinancialCase(fixture.headers.platform, (await fixture.newCase()).caseId), { status: 403 });
});
test("administration HTTP requires active authority, same origin and bounded JSON", async () => {
  const url = `${process.env.BETTER_AUTH_URL}/api/admin`;
  assert.equal((await adminGET(new Request(url))).status, 401);
  assert.equal((await adminGET(new Request(url, { headers: fixture.headers.deskA }))).status, 403);
  assert.equal((await platformGET(new Request(`${process.env.BETTER_AUTH_URL}/api/platform`, { headers: fixture.headers.adminA }))).status, 403);
  const headers = new Headers(fixture.headers.adminA); headers.set("content-type", "application/json");
  assert.equal((await adminPOST(new Request(url, { method: "POST", headers, body: "{}" }))).status, 403);
  headers.set("origin", new URL(process.env.BETTER_AUTH_URL!).origin);
  assert.equal((await adminPOST(new Request(url, { method: "POST", headers, body: "{" }))).status, 400);
  assert.equal((await adminPOST(new Request(url, { method: "POST", headers, body: " ".repeat(65537) }))).status, 413);
  const response = await adminGET(new Request(url, { headers })); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
});
test("concurrent administrators cannot disable each other and remove every active administrator", async () => {
  const hospitalId = (await applyPlatformAction(fixture.headers.platform, { type: "hospital-create", code: `SYN-RACE-${randomUUID().slice(0, 12)}`, name: "Fictional administrator race hospital" })).id;
  await applyPlatformAction(fixture.headers.platform, { type: "branch-create", hospitalId, code: "RACE-ONLY", name: "Fictional race branch" });
  const actors: StaffSession[] = [];
  for (let index = 0; index < 2; index++) {
    actors.push((await raceAdministrator(hospitalId, "HOSPITAL_ADMIN")).actor);
  }
  // Hold both targets until both real requests have reached a lock. Without hospital
  // serialization they have already authorized each other before either can commit.
  const blocker = await migrationPool.connect();
  let operations: Promise<PromiseSettledResult<void>[]> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT user_id FROM users WHERE user_id=ANY($1::bigint[]) ORDER BY user_id FOR UPDATE", [actors.map((actor) => actor.userId)]);
    operations = Promise.allSettled([disableStaff(actors[0], actors[1].userId), disableStaff(actors[1], actors[0].userId)]);
    let waiting = 0;
    for (let attempt = 0; attempt < 200 && waiting !== 2; attempt++) {
      waiting = Number((await migrationPool.query("SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND usename='smiley_app' AND cardinality(pg_blocking_pids(pid))>0")).rows[0].total);
      if (waiting !== 2) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(waiting, 2, "Both disable calls must be in flight before releasing their targets.");
    await blocker.query("COMMIT");
  } finally {
    await blocker.query("ROLLBACK"); blocker.release();
    if (operations) await operations;
  }
  const results = await operations!;
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const denied = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(denied.reason.status, 403);
  const remaining = await migrationPool.query("SELECT count(*) AS total FROM users u JOIN staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id JOIN user_roles ur ON ur.user_id=u.user_id AND ur.hospital_id=u.hospital_id JOIN roles r ON r.role_id=ur.role_id WHERE u.hospital_id=$1 AND u.status='ACTIVE' AND s.status='ACTIVE' AND r.status='ACTIVE' AND r.role_code='HOSPITAL_ADMIN'", [hospitalId]);
  assert.equal(Number(remaining.rows[0].total), 1);
  const audit = await migrationPool.query("SELECT count(*) AS total FROM audit_logs WHERE hospital_id=$1 AND module_name='staff' AND action_name='DISABLED'", [hospitalId]);
  assert.equal(Number(audit.rows[0].total), 1, "Only the committed disable receives an atomic audit.");
});
test("concurrent platform admins cannot deactivate each other's registry hospital", async () => {
  const administrators = [];
  for (let index = 0; index < 2; index++) {
    const hospitalId = (await applyPlatformAction(fixture.headers.platform, { type: "hospital-create", code: `SYN-PLAT-${randomUUID().slice(0, 12)}`, name: "Fictional platform race hospital" })).id;
    administrators.push(await raceAdministrator(hospitalId, "SUPER_ADMIN"));
  }
  const hospitalIds = administrators.map(({ actor }) => actor.hospitalId);
  await assert.rejects(applyPlatformAction(administrators[0].headers, { type: "hospital", hospitalId: hospitalIds[0], name: "Fictional own hospital", status: "INACTIVE", reason: "Synthetic own-hospital safety probe" }), { status: 409 });
  const blocker = await migrationPool.connect();
  let operations: Promise<PromiseSettledResult<{ id: string }>[]> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT hospital_id FROM hospitals WHERE hospital_id=ANY($1::bigint[]) ORDER BY hospital_id FOR UPDATE", [hospitalIds]);
    operations = Promise.allSettled(administrators.map(({ headers }, index) => applyPlatformAction(headers, { type: "hospital", hospitalId: hospitalIds[1 - index], name: "Fictional platform race hospital", status: "INACTIVE", reason: "Synthetic concurrent deactivation probe" })));
    let waiting = 0;
    for (let attempt = 0; attempt < 200 && waiting !== 2; attempt++) {
      waiting = Number((await migrationPool.query("SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND usename='smiley_app' AND cardinality(pg_blocking_pids(pid))>0")).rows[0].total);
      if (waiting !== 2) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(waiting, 2, "Both registry changes must be in flight before releasing the target hospitals.");
    await blocker.query("COMMIT");
  } finally {
    await blocker.query("ROLLBACK"); blocker.release();
    if (operations) await operations;
  }
  const results = await operations!;
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const denied = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(denied.reason.status, 403);
  const remaining = await migrationPool.query("SELECT count(*) AS total FROM hospitals WHERE hospital_id=ANY($1::bigint[]) AND status='ACTIVE'", [hospitalIds]);
  assert.equal(Number(remaining.rows[0].total), 1);
  const audit = await migrationPool.query("SELECT count(*) AS total FROM audit_logs WHERE hospital_id=ANY($1::bigint[]) AND module_name='platform-registry' AND action_name='HOSPITAL'", [hospitalIds]);
  assert.equal(Number(audit.rows[0].total), 1);
});
