import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { appPool, migrationPool, closePools } from "../../src/server/db/client";
import { seedSynthetic } from "../../src/server/db/seed";
import { seedAuthUsers } from "../../src/server/auth/seed";
import { auth } from "../../src/server/auth";
import { withActorTransaction } from "../../src/server/access";

let users: Awaited<ReturnType<typeof seedAuthUsers>>;
const sessions = new Map<string, Headers>();
const cases: { id: string; hospitalId: string; branchId: string; patientId: string; membershipId: string; encounterId: string }[] = [];
before(async () => {
  const database = await migrationPool.query("SELECT current_database() AS name");
  assert.match(database.rows[0].name, /_test$/u);
  await seedSynthetic(); users = await seedAuthUsers();
  for (const key of ["deskA", "deskNorthA", "deskB", "adminA", "billingA", "platform"] as const) {
    const user = users[key];
    const login = await auth.api.signInEmail({ body: { email: user.email, password: user.password }, asResponse: true });
    assert.equal(login.status, 200);
    sessions.set(key, new Headers({ cookie: login.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ") }));
  }
  const links = await migrationPool.query(`SELECT e.hospital_id,e.branch_id,e.patient_id,e.encounter_id,pi.patient_insurance_id
    FROM encounters e JOIN patient_insurance pi ON pi.hospital_id=e.hospital_id AND pi.patient_id=e.patient_id
    JOIN branches b ON b.branch_id=e.branch_id ORDER BY b.branch_code`);
  for (const link of links.rows) {
    const inserted = await migrationPool.query(`INSERT INTO claims(hospital_id,branch_id,patient_id,patient_insurance_id,encounter_id,claim_no,claim_type,next_action)
      VALUES($1,$2,$3,$4,$5,$6,'CASHLESS','Verify synthetic access fixture') RETURNING claim_id`,
    [link.hospital_id,link.branch_id,link.patient_id,link.patient_insurance_id,link.encounter_id,`ACCESS-${randomUUID()}`]);
    cases.push({ id: String(inserted.rows[0].claim_id), hospitalId: String(link.hospital_id), branchId: String(link.branch_id), patientId: String(link.patient_id), membershipId: String(link.patient_insurance_id), encounterId: String(link.encounter_id) });
  }
  assert.ok(cases.some((item) => item.branchId === users.deskA.branchId));
  assert.ok(cases.some((item) => item.branchId === users.deskNorthA.branchId));
  assert.ok(cases.some((item) => item.hospitalId === users.deskB.hospitalId));
});
after(closePools);
const headers = (name: string) => sessions.get(name)!;
test("the application connection is non-owner and has no BYPASSRLS", async () => {
  const role = await appPool.query("SELECT current_user,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user");
  assert.equal(role.rows[0].rolsuper, false); assert.equal(role.rows[0].rolbypassrls, false);
  const owner = await appPool.query("SELECT pg_get_userbyid(relowner) AS owner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='claims'::regclass");
  assert.notEqual(owner.rows[0].owner, role.rows[0].current_user);
  assert.equal(owner.rows[0].relrowsecurity, true); assert.equal(owner.rows[0].relforcerowsecurity, true);
});
test("direct SQL without trusted staff context cannot read clinical tables or invoker views", async () => {
  for (const table of ["patients", "patient_insurance", "encounters", "claims"]) {
    const result = await appPool.query(`SELECT count(*)::int AS count FROM ${table}`);
    assert.equal(result.rows[0].count, 0, table);
  }
  const views = await appPool.query("SELECT viewname FROM pg_views WHERE schemaname='public'");
  for (const view of views.rows) {
    assert.match(view.viewname, /^[a-z_]+$/u);
    const result = await appPool.query(`SELECT count(*)::int AS count FROM ${view.viewname}`);
    assert.equal(result.rows[0].count, 0, view.viewname);
  }
});
test("hospital administrators cannot grant platform roles or mutate platform identities", async () => {
  await assert.rejects(withActorTransaction(headers("adminA"), "staff:manage", undefined, async (client, actor) => {
    await client.query("INSERT INTO user_roles(hospital_id,user_id,role_id) SELECT $1,$2,role_id FROM roles WHERE role_code='SUPER_ADMIN'", [actor.hospitalId, users.deskA.userId]);
    throw new Error("Platform grant unexpectedly succeeded; roll back the negative probe.");
  }), { code: "42501" });
  const updates = await withActorTransaction(headers("adminA"), "staff:manage", undefined, async (client) => {
    await client.query("SAVEPOINT negative_profile_probe");
    const identity = await client.query("UPDATE users SET status='INACTIVE' WHERE user_id=$1 RETURNING user_id", [users.platform.userId]);
    const profile = await client.query("UPDATE staff SET status='INACTIVE' WHERE staff_id=(SELECT staff_id FROM users WHERE user_id=$1) RETURNING staff_id", [users.platform.userId]);
    const grants = await client.query("DELETE FROM user_roles WHERE user_id=$1 RETURNING user_id", [users.platform.userId]);
    const counts = [identity.rowCount, profile.rowCount, grants.rowCount];
    await client.query("ROLLBACK TO SAVEPOINT negative_profile_probe");
    return counts;
  });
  assert.deepEqual(updates, [0, 0, 0]);
  const platform = await migrationPool.query("SELECT status FROM users WHERE user_id=$1", [users.platform.userId]);
  assert.equal(platform.rows[0].status, "ACTIVE");
});
test("assigned staff see only their branch while hospital admins see their own hospital", async () => {
  const own = await withActorTransaction(headers("deskA"), "case:read", undefined, (client) => client.query("SELECT claim_id,hospital_id,branch_id FROM claims"));
  assert.ok(own.rowCount! > 0);
  assert.ok(own.rows.every((item) => String(item.hospital_id) === users.deskA.hospitalId && String(item.branch_id) === users.deskA.branchId));
  const admin = await withActorTransaction(headers("adminA"), "case:read", undefined, (client) => client.query("SELECT hospital_id,branch_id FROM claims"));
  assert.ok(admin.rows.every((item) => String(item.hospital_id) === users.adminA.hospitalId));
  assert.ok(admin.rows.some((item) => String(item.branch_id) === users.deskNorthA.branchId));
});
test("wrong hospital and branch assertions cannot widen verified identity scope", async () => {
  await assert.rejects(withActorTransaction(headers("deskA"), "case:read", users.deskNorthA.branchId, async () => undefined), { status: 403 });
  const wrongHospital = await withActorTransaction(headers("deskA"), "case:read", undefined, async (client) => {
    await client.query("SELECT set_config('app.hospital_id',$1,true),set_config('app.branch_ids',$2,true)", [users.deskB.hospitalId, users.deskB.branchId]);
    return client.query("SELECT count(*)::int AS count FROM claims");
  });
  assert.equal(wrongHospital.rows[0].count, 0);
  const wrongBranch = await withActorTransaction(headers("deskA"), "case:read", undefined, async (client) => {
    await client.query("SELECT set_config('app.branch_ids',$1,true)", [users.deskNorthA.branchId]);
    return client.query("SELECT count(*)::int AS count FROM claims");
  });
  assert.equal(wrongBranch.rows[0].count, 0);
});
test("Billing is denied case preparation in both service and direct scoped SQL", async () => {
  await assert.rejects(withActorTransaction(headers("billingA"), "case:write", users.billingA.branchId, async () => undefined), { status: 403 });
  const fixture = cases.find((item) => item.branchId === users.billingA.branchId)!;
  await assert.rejects(withActorTransaction(headers("billingA"), "case:read", undefined, async (client) => {
    await client.query("SELECT set_config('app.write_branch_ids',$1,true),set_config('app.permission','case:write',true)", [fixture.branchId]);
    await client.query(`INSERT INTO claims(hospital_id,branch_id,patient_id,patient_insurance_id,encounter_id,claim_no,claim_type)
      VALUES($1,$2,$3,$4,$5,$6,'CASHLESS')`, [fixture.hospitalId,fixture.branchId,fixture.patientId,fixture.membershipId,fixture.encounterId,`FORBIDDEN-${randomUUID()}`]);
    throw new Error("Billing write unexpectedly succeeded; roll back the negative probe.");
  }), { code: "42501" });
});
test("platform administrators have hospital metadata scope and no default clinical access", async () => {
  await assert.rejects(withActorTransaction(headers("platform"), "case:read", undefined, async () => undefined), { status: 403 });
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.auth_user_id',$1,true),set_config('app.user_id',$2,true),set_config('app.hospital_id',$3,true),set_config('app.branch_ids',$4,true)", [users.platform.authUserId,users.platform.userId,users.deskA.hospitalId,users.deskA.branchId]);
    const hospital = await client.query("SELECT count(*)::int AS count FROM hospitals"); assert.ok(hospital.rows[0].count >= 2);
    const clinical = await client.query("SELECT count(*)::int AS count FROM patients"); assert.equal(clinical.rows[0].count, 0);
    await client.query("ROLLBACK");
  } finally { client.release(); }
});
test("branch revocation removes access from an existing session on the next request", async () => {
  await migrationPool.query("UPDATE user_branch_memberships SET status='REVOKED' WHERE user_id=$1", [users.deskNorthA.userId]);
  try {
    await assert.rejects(withActorTransaction(headers("deskNorthA"), "case:read", undefined, async () => undefined), { status: 403 });
  } finally { await migrationPool.query("UPDATE user_branch_memberships SET status='ACTIVE' WHERE user_id=$1", [users.deskNorthA.userId]); }
});
test("transaction-local context never carries into another pooled request", async () => {
  await withActorTransaction(headers("deskA"), "case:read", undefined, (client) => client.query("SELECT claim_id FROM claims"));
  const reset = await appPool.query("SELECT count(*)::int AS count FROM patients"); assert.equal(reset.rows[0].count, 0);
});
