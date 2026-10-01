import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";

let authentication: typeof import("../../src/server/auth/index.ts");
let staff: typeof import("../../src/server/auth/staff.ts");
let database: typeof import("../../src/server/db/client.ts");
let users: Awaited<ReturnType<typeof import("../../src/server/auth/seed.ts").seedAuthUsers>>;
const password = "Synthetic-Auth-Test-Only-Password!42";

before(async () => {
  const module = await import("../../src/server/auth/index.ts").catch(() => null);
  assert.ok(module, "The staff authentication module must provide database-backed sessions.");
  authentication = module;
  staff = await import("../../src/server/auth/staff.ts");
  database = await import("../../src/server/db/client.ts");
  const result = await database.migrationPool.query("SELECT current_database() AS name");
  assert.match(result.rows[0].name, /_test$/u, "Auth checks must use the isolated test database.");
  const { seedSynthetic } = await import("../../src/server/db/seed.ts");
  await seedSynthetic(database.migrationPool);
  const { seedAuthUsers } = await import("../../src/server/auth/seed.ts");
  users = await seedAuthUsers({ password });
});
after(async () => { if (database) await database.closePools(); });

async function login(key: keyof typeof users) {
  const user = users[key];
  const response = await authentication.auth.api.signInEmail({
    body: { email: user.email, password: user.password }, asResponse: true,
  });
  assert.equal(response.status, 200);
  const headers = new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  const actor = await authentication.getStaffSession(headers);
  assert.ok(actor);
  return { actor, headers };
}
function invitedEmail() { return `invited-${randomUUID()}@smiley.test`; }
function token(url: string) { return new URL(url).searchParams.get("token")!; }

test("an absent session cannot produce a trusted staff actor", async () => {
  assert.equal(await authentication.getStaffSession(new Headers()), null);
  await assert.rejects(authentication.requireStaffSession(new Headers()), { status: 401 });
});
test("valid password resolves exactly one auth-to-domain staff identity", async () => {
  const { actor } = await login("deskA");
  assert.equal(actor.authUserId, users.deskA.authUserId);
  assert.equal(actor.userId, users.deskA.userId);
  assert.equal(actor.hospitalId, users.deskA.hospitalId);
  assert.ok(actor.branchRoles.some((grant) => grant.role === "INSURANCE_EXECUTIVE"));
  const result = await database.migrationPool.query("SELECT count(*)::int AS count FROM users WHERE auth_user_id=$1", [actor.authUserId]);
  assert.equal(result.rows[0].count, 1);
});
test("invalid password does not create a session", async () => {
  const response = await authentication.auth.api.signInEmail({
    body: { email: users.deskA.email, password: "incorrect-password" }, asResponse: true,
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.getSetCookie().some((value) => value.includes("session_token=")), false);
});
test("public signup is closed while invitation provisioning remains internal", async () => {
  const email = invitedEmail();
  const response = await authentication.handleAuthRequest(new Request(
    `${process.env.BETTER_AUTH_URL}/api/auth/sign-up/email`,
    { method: "POST", headers: { "content-type": "application/json", origin: process.env.BETTER_AUTH_URL! }, body: JSON.stringify({ email, password, name: "Synthetic stranger" }) },
  ));
  assert.equal(response.status, 404);
  const result = await database.migrationPool.query("SELECT count(*)::int AS count FROM auth_user WHERE email=$1", [email]);
  assert.equal(result.rows[0].count, 0);
});
test("logout invalidates the previously valid browser cookie", async () => {
  const { headers } = await login("deskA");
  await authentication.auth.api.signOut({ headers });
  assert.equal(await authentication.getStaffSession(headers), null);
});
test("database-expired sessions fail even when the old cookie remains", async () => {
  const { headers, actor } = await login("billingA");
  await database.migrationPool.query("UPDATE auth_session SET expires_at=now()-interval '1 minute' WHERE user_id=$1", [actor.authUserId]);
  assert.equal(await authentication.getStaffSession(headers), null);
});
test("invitation grants require a current hospital administrator and a branch in that hospital", async () => {
  const { actor: desk } = await login("deskA");
  const { actor: admin } = await login("adminA");
  const forged = { ...desk, roles: ["HOSPITAL_ADMIN"] };
  await assert.rejects(staff.createInvitation(forged, { email: invitedEmail(), branchId: users.deskA.branchId, role: "INSURANCE_EXECUTIVE" }), { status: 403 });
  await assert.rejects(staff.createInvitation(admin, { email: invitedEmail(), branchId: users.deskB.branchId, role: "INSURANCE_EXECUTIVE" }), { status: 403 });
  await assert.rejects(staff.createInvitation(admin, { email: invitedEmail(), branchId: users.deskA.branchId, role: "SUPER_ADMIN" }), { status: 403 });
});
test("single-use invitation links create one linked identity and reject replay", async () => {
  const { actor: admin } = await login("adminA");
  const invitation = await staff.createInvitation(admin, { email: invitedEmail(), branchId: users.deskA.branchId, role: "INSURANCE_EXECUTIVE" });
  const accepted = await staff.acceptInvitation(token(invitation.url), "Synthetic invited colleague", password);
  const response = await authentication.auth.api.signInEmail({ body: { email: accepted.email, password }, asResponse: true });
  assert.equal(response.status, 200);
  const headers = new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  const actor = await authentication.getStaffSession(headers);
  assert.equal(actor?.userId, accepted.userId);
  assert.equal(actor?.hospitalId, admin.hospitalId);
  assert.deepEqual(actor?.branchRoles, [{ branchId: users.deskA.branchId, role: "INSURANCE_EXECUTIVE" }]);
  await assert.rejects(staff.acceptInvitation(token(invitation.url), "Replay", password), { status: 409 });
});
test("expired invitations cannot create credentials", async () => {
  const { actor: admin } = await login("adminA");
  const email = invitedEmail();
  const invitation = await staff.createInvitation(admin, { email, branchId: users.deskA.branchId, role: "REPORT_USER" });
  await database.migrationPool.query("UPDATE staff_invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [invitation.id]);
  await assert.rejects(staff.acceptInvitation(token(invitation.url), "Expired colleague", password), { status: 410 });
  const result = await database.migrationPool.query("SELECT count(*)::int AS count FROM auth_user WHERE email=$1", [email]);
  assert.equal(result.rows[0].count, 0);
});
test("concurrent acceptance consumes a token once without orphaning an account", async () => {
  const { actor: admin } = await login("adminA");
  const email = invitedEmail();
  const invitation = await staff.createInvitation(admin, { email, branchId: users.deskA.branchId, role: "REPORT_USER" });
  const results = await Promise.allSettled([
    staff.acceptInvitation(token(invitation.url), "Concurrent colleague", password),
    staff.acceptInvitation(token(invitation.url), "Concurrent colleague", password),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const identities = await database.migrationPool.query("SELECT count(*)::int AS count FROM auth_user a JOIN users u ON u.auth_user_id=a.id WHERE a.email=$1", [email]);
  assert.equal(identities.rows[0].count, 1);
});
test("failed invitation password validation leaves no identity and the token retryable", async () => {
  const { actor: admin } = await login("adminA");
  const email = invitedEmail();
  const invitation = await staff.createInvitation(admin, { email, branchId: users.deskA.branchId, role: "REPORT_USER" });
  await assert.rejects(staff.acceptInvitation(token(invitation.url), "Retry colleague", "short"), { status: 400 });
  const result = await database.migrationPool.query("SELECT (SELECT count(*)::int FROM auth_user WHERE email=$1) AS count,status FROM staff_invitations WHERE id=$2", [email, invitation.id]);
  assert.equal(result.rows[0].count, 0);
  assert.equal(result.rows[0].status, "PENDING");
  assert.ok((await staff.acceptInvitation(token(invitation.url), "Retry colleague", password)).userId);
});
test("removed staff cannot reuse an old session or obtain a trusted session again", async () => {
  const { actor: admin } = await login("adminA");
  const invitation = await staff.createInvitation(admin, { email: invitedEmail(), branchId: users.deskA.branchId, role: "REPORT_USER" });
  const accepted = await staff.acceptInvitation(token(invitation.url), "Removed colleague", password);
  const response = await authentication.auth.api.signInEmail({ body: { email: accepted.email, password }, asResponse: true });
  const headers = new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  assert.ok(await authentication.getStaffSession(headers));
  await staff.disableStaff(admin, accepted.userId);
  assert.equal(await authentication.getStaffSession(headers), null);
  const rejected = await authentication.handleAuthRequest(new Request(
    `${process.env.BETTER_AUTH_URL}/api/auth/sign-in/email`,
    { method: "POST", headers: { "content-type": "application/json", origin: process.env.BETTER_AUTH_URL! }, body: JSON.stringify({ email: accepted.email, password }) },
  ));
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.getSetCookie().some((value) => /session_token=[^;]/u.test(value)), false);
});

test("a profile write failure rolls back Better Auth credentials and leaves the invitation retryable", async () => {
  const { actor: admin } = await login("adminA");
  const email = invitedEmail();
  const invitation = await staff.createInvitation(admin, { email, branchId: users.deskA.branchId, role: "REPORT_USER" });
  const conflict = await database.migrationPool.query(
    "INSERT INTO staff(hospital_id,employee_code,first_name,status) VALUES($1,$2,'Synthetic forced conflict','ACTIVE') RETURNING staff_id",
    [admin.hospitalId, `INV-${invitation.id}`],
  );
  await assert.rejects(staff.acceptInvitation(token(invitation.url), "Rollback colleague", password), { code: "23505" });
  const result = await database.migrationPool.query(
    "SELECT status,(SELECT count(*)::int FROM auth_user WHERE email=$1) AS identities FROM staff_invitations WHERE id=$2",
    [email, invitation.id],
  );
  assert.equal(result.rows[0].identities, 0, "Auth insertion must use the invitation transaction, not a separate connection.");
  assert.equal(result.rows[0].status, "PENDING");
  await database.migrationPool.query("DELETE FROM staff WHERE staff_id=$1 AND employee_code=$2", [conflict.rows[0].staff_id, `INV-${invitation.id}`]);
  assert.ok((await staff.acceptInvitation(token(invitation.url), "Rollback colleague", password)).userId);
});
test("a credential without its staff profile cannot become an authorized actor", async () => {
  const { actor: admin } = await login("adminA");
  const invitation = await staff.createInvitation(admin, { email: invitedEmail(), branchId: users.deskA.branchId, role: "REPORT_USER" });
  const accepted = await staff.acceptInvitation(token(invitation.url), "Missing profile colleague", password);
  const response = await authentication.auth.api.signInEmail({ body: { email: accepted.email, password }, asResponse: true });
  const headers = new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  assert.ok(await authentication.getStaffSession(headers));
  await database.migrationPool.query("UPDATE users SET staff_id=NULL WHERE user_id=$1", [accepted.userId]);
  assert.equal(await authentication.getStaffSession(headers), null);
});

test("an invited hospital administrator receives all active branches in that hospital", async () => {
  const { actor: admin } = await login("adminA");
  const invitation = await staff.createInvitation(admin, { email: invitedEmail(), branchId: users.deskA.branchId, role: "HOSPITAL_ADMIN" });
  const accepted = await staff.acceptInvitation(token(invitation.url), "Invited hospital administrator", password);
  const response = await authentication.auth.api.signInEmail({ body: { email: accepted.email, password }, asResponse: true });
  const headers = new Headers({ cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  const actor = await authentication.getStaffSession(headers);
  assert.deepEqual(actor?.branchIds, admin.branchIds);
  assert.ok(actor?.branchRoles.every((grant) => grant.role === "HOSPITAL_ADMIN"));
  assert.equal(actor?.branchIds.includes(users.deskB.branchId), false);
});
test("platform administration does not imply hospital branch or invitation privileges", async () => {
  const { actor } = await login("platform");
  assert.deepEqual(actor.branchIds, []);
  assert.deepEqual(actor.branchRoles, []);
  await assert.rejects(staff.createInvitation(actor, { email: invitedEmail(), branchId: users.deskA.branchId, role: "REPORT_USER" }), { status: 403 });
});
test("a hospital administrator cannot disable a platform account or revoke its session", async () => {
  const { actor: admin } = await login("adminA");
  const { actor: platform, headers } = await login("platform");
  const before = await database.migrationPool.query("SELECT u.status AS user_status,s.status AS staff_status,(SELECT count(*)::int FROM auth_session WHERE user_id=u.auth_user_id) AS sessions FROM users u JOIN staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id WHERE u.user_id=$1", [platform.userId]);
  await assert.rejects(staff.disableStaff(admin, platform.userId), { status: 403 });
  const after = await database.migrationPool.query("SELECT u.status AS user_status,s.status AS staff_status,(SELECT count(*)::int FROM auth_session WHERE user_id=u.auth_user_id) AS sessions FROM users u JOIN staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id WHERE u.user_id=$1", [platform.userId]);
  assert.deepEqual(after.rows[0], before.rows[0]);
  assert.equal((await authentication.getStaffSession(headers))?.userId, platform.userId);
});
