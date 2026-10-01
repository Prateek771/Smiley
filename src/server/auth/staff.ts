import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { appPool } from "../db/client";
import { AuthError, createAuth, lookupStaff, setIdentityContext, type StaffSession } from "./index";

const invitationInput = z.object({
  email: z.email().max(150).transform((value) => value.toLowerCase()),
  branchId: z.string().regex(/^[1-9][0-9]*$/u),
  role: z.enum(["HOSPITAL_ADMIN", "INSURANCE_EXECUTIVE", "TPA_EXECUTIVE", "CLAIM_VERIFIER", "BILLING_OFFICER", "FINANCE_OFFICER", "DOCTOR", "RECEPTIONIST", "REPORT_USER"]),
  expiresInHours: z.number().int().min(1).max(72).default(24),
});
type InvitationInput = { email: string; branchId: string; role: string; expiresInHours?: number };
async function setStaffContext(client: PoolClient, actor: StaffSession) {
  await client.query(
    `SELECT set_config('app.user_id',$1,true),set_config('app.hospital_id',$2,true),
     set_config('app.branch_ids',$3,true),set_config('app.write_branch_ids',$3,true),
     set_config('app.is_hospital_admin',$4,true)`,
    [actor.userId, actor.hospitalId, actor.branchIds.join(","), String(actor.roles.includes("HOSPITAL_ADMIN"))],
  );
}
async function withAdministrator<T>(actor: StaffSession, operation: (client: PoolClient, current: StaffSession) => Promise<T>) {
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await setIdentityContext(client, actor.authUserId);
    const current = await lookupStaff(client, actor.authUserId);
    if (!current || current.userId !== actor.userId || current.hospitalId !== actor.hospitalId || (!current.roles.includes("HOSPITAL_ADMIN") || current.roles.includes("SUPER_ADMIN"))) {
      throw new AuthError(403, "A current hospital administrator is required.");
    }
    await setStaffContext(client, current);
    const result = await operation(client, current);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function createInvitation(actor: StaffSession, input: InvitationInput) {
  if (input.role === "SUPER_ADMIN") throw new AuthError(403, "Platform roles cannot be granted through hospital invitations.");
  const parsed = invitationInput.safeParse(input);
  if (!parsed.success) throw new AuthError(400, "Provide a valid email, hospital branch, role, and expiry.");
  const value = parsed.data;
  return withAdministrator(actor, async (client, current) => {
    const branch = await client.query("SELECT branch_id FROM branches WHERE branch_id=$1 AND hospital_id=$2 AND status='ACTIVE'", [value.branchId, current.hospitalId]);
    if (branch.rowCount !== 1) throw new AuthError(403, "The branch is outside your active hospital.");
    const role = await client.query("SELECT role_id FROM roles WHERE role_code=$1 AND status='ACTIVE'", [value.role]);
    if (role.rowCount !== 1) throw new AuthError(400, "This staff role is unavailable.");
    const existing = await client.query("SELECT id FROM auth_user WHERE email=$1", [value.email]);
    if (existing.rowCount) throw new AuthError(409, "This email already has a staff identity.");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + value.expiresInHours * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO staff_invitations(id,hospital_id,branch_id,role_id,email,token_hash,expires_at,status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8)`,
      [id, current.hospitalId, value.branchId, role.rows[0].role_id, value.email, tokenHash, expiresAt, current.userId],
    );
    const url = new URL("/invite", process.env.BETTER_AUTH_URL);
    url.searchParams.set("token", token);
    return { id, url: url.toString(), expiresAt: expiresAt.toISOString() };
  });
}

export async function acceptInvitation(token: string, name: string, password: string) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new AuthError(400, "The invitation token is invalid.");
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 100 || password.length < 12 || password.length > 128) {
    throw new AuthError(400, "Provide your name and a password between 12 and 128 characters.");
  }
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await client.query("SELECT set_config('app.invitation_token_hash',$1,true)", [tokenHash]);
    const result = await client.query("SELECT * FROM staff_invitations WHERE token_hash=$1 FOR UPDATE", [tokenHash]);
    const invitation = result.rows[0];
    if (!invitation) throw new AuthError(404, "The invitation is unavailable.");
    if (invitation.status !== "PENDING") throw new AuthError(409, "The invitation has already been used or revoked.");
    if (new Date(invitation.expires_at).getTime() <= Date.now()) throw new AuthError(410, "The invitation has expired.");
    // Every context value is derived from the locked token row, never a request-supplied identity.
    await client.query(
      `SELECT set_config('app.accepting_invitation_id',$1,true),set_config('app.hospital_id',$2,true),
       set_config('app.branch_ids',$3,true),set_config('app.write_branch_ids',$3,true)`,
      [invitation.id, String(invitation.hospital_id), String(invitation.branch_id)],
    );
    const eligibility = await client.query(
      `SELECT 1 FROM branches b JOIN hospitals h ON h.hospital_id=b.hospital_id JOIN roles r ON r.role_id=$3
       WHERE b.branch_id=$1 AND b.hospital_id=$2 AND b.status='ACTIVE' AND h.status='ACTIVE'
       AND r.status='ACTIVE' AND r.role_code<>'SUPER_ADMIN'`,
      [invitation.branch_id, invitation.hospital_id, invitation.role_id],
    );
    if (eligibility.rowCount !== 1) throw new AuthError(403, "The invitation's hospital, branch, or role is inactive.");
    const existing = await client.query("SELECT id FROM auth_user WHERE email=$1", [invitation.email]);
    if (existing.rowCount) throw new AuthError(409, "This email already has an identity; request an administrator review.");
    const transactionAuth = createAuth(client, false);
    const created = await transactionAuth.api.signUpEmail({ body: { email: invitation.email, name: cleanName, password } });
    await setIdentityContext(client, created.user.id);
    const profile = await client.query(
      "INSERT INTO staff(hospital_id,employee_code,first_name,email,status) VALUES($1,$2,$3,$4,'ACTIVE') RETURNING staff_id",
      [invitation.hospital_id, `INV-${invitation.id}`, cleanName, invitation.email],
    );
    const domain = await client.query(
      "INSERT INTO users(hospital_id,auth_user_id,staff_id,username,email,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING user_id",
      [invitation.hospital_id, created.user.id, profile.rows[0].staff_id, created.user.id, invitation.email],
    );
    const userId = String(domain.rows[0].user_id);
    await client.query("SELECT set_config('app.user_id',$1,true)", [userId]);
    await client.query("INSERT INTO user_roles(hospital_id,user_id,role_id) VALUES($1,$2,$3)", [invitation.hospital_id, userId, invitation.role_id]);
    await client.query("INSERT INTO user_branch_memberships(hospital_id,user_id,branch_id,role_id,status) VALUES($1,$2,$3,$4,'ACTIVE')", [invitation.hospital_id, userId, invitation.branch_id, invitation.role_id]);
    await client.query("UPDATE staff_invitations SET status='ACCEPTED',accepted_user_id=$2 WHERE id=$1", [invitation.id, userId]);
    await client.query("COMMIT");
    return { userId, email: String(invitation.email) };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function disableStaff(actor: StaffSession, targetUserId: string) {
  if (!/^[1-9][0-9]*$/u.test(targetUserId)) throw new AuthError(400, "Provide a valid staff ID.");
  return withAdministrator(actor, async (client, current) => {
    if (targetUserId === current.userId) throw new AuthError(409, "Another administrator must disable your account.");
    const platform = await client.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.role_id=ur.role_id WHERE ur.user_id=$1 AND ur.hospital_id=$2 AND r.role_code='SUPER_ADMIN'", [targetUserId, current.hospitalId]);
    if (platform.rowCount) throw new AuthError(403, "Hospital administrators cannot disable platform accounts.");
    const target = await client.query("SELECT auth_user_id,staff_id FROM users WHERE user_id=$1 AND hospital_id=$2 FOR UPDATE", [targetUserId, current.hospitalId]);
    if (target.rowCount !== 1) throw new AuthError(404, "The staff account is unavailable in your hospital.");
    await client.query("UPDATE users SET status='INACTIVE' WHERE user_id=$1 AND hospital_id=$2", [targetUserId, current.hospitalId]);
    await client.query("UPDATE staff SET status='INACTIVE' WHERE staff_id=$1 AND hospital_id=$2", [target.rows[0].staff_id, current.hospitalId]);
    await client.query("UPDATE user_branch_memberships SET status='REVOKED' WHERE user_id=$1 AND hospital_id=$2", [targetUserId, current.hospitalId]);
    await client.query("DELETE FROM auth_session WHERE user_id=$1", [target.rows[0].auth_user_id]);
    await client.query("UPDATE staff_invitations SET status='REVOKED' WHERE hospital_id=$1 AND email=(SELECT email FROM users WHERE user_id=$2) AND status='PENDING'", [current.hospitalId, targetUserId]);
  });
}
