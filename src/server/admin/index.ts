import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, withActorTransaction, type Actor } from "../access";
import { lookupStaff, requireStaffSession, setIdentityContext } from "../auth";
import { createInvitation, disableStaff } from "../auth/staff";
import { appPool } from "../db/client";
import { writeAudit } from "../audit";
import { isSupportedCalculationVersion, ruleSchema, type RuleInput } from "../financial/rules";
import { caseIdSchema as id } from "../financial/records";

export const branchRoles = ["INSURANCE_EXECUTIVE", "TPA_EXECUTIVE", "CLAIM_VERIFIER", "BILLING_OFFICER", "FINANCE_OFFICER", "DOCTOR", "RECEPTIONIST", "REPORT_USER"] as const;
const reason = z.string().trim().min(1).max(2000);
const name = z.string().trim().min(1).max(150);
const code = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/u);
const status = z.enum(["ACTIVE", "INACTIVE"]);
const ruleInput = ruleSchema.refine((rule) => isSupportedCalculationVersion(rule.version) && rule.validFrom <= rule.validTo, "Use the supported calculation version and ordered dates.");
const adminInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hospital"), name: name.max(200), reason }).strict(),
  z.object({ type: z.literal("branch-create"), code, name }).strict(),
  z.object({ type: z.literal("branch"), branchId: id, name, status, reason }).strict(),
  z.object({ type: z.literal("invite"), email: z.email().max(150), branchId: id, role: z.enum(["HOSPITAL_ADMIN", ...branchRoles]) }).strict(),
  z.object({ type: z.literal("revoke-invitation"), invitationId: z.uuid() }).strict(),
  z.object({ type: z.literal("grant"), userId: id, branchId: id, role: z.enum(branchRoles), reason: reason.default("Administrator assigned branch access") }).strict(),
  z.object({ type: z.literal("revoke-grant"), userId: id, branchId: id, role: z.enum(branchRoles), reason }).strict(),
  z.object({ type: z.literal("disable"), userId: id }).strict(),
  z.object({ type: z.literal("rule-create"), policyId: id, name: name.max(120), rule: ruleInput, reason }).strict(),
  z.object({ type: z.literal("rule-state"), ruleId: z.uuid(), expectedVersion: z.number().int().positive(), status: z.enum(["APPROVED", "RETIRED"]), reason }).strict(),
]);
const platformInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hospital-create"), code, name: name.max(200) }).strict(),
  z.object({ type: z.literal("hospital"), hospitalId: id, name: name.max(200), status, reason }).strict(),
  z.object({ type: z.literal("branch-create"), hospitalId: id, code, name }).strict(),
  z.object({ type: z.literal("branch"), hospitalId: id, branchId: id, name, status, reason }).strict(),
]);
export type RuleRevision = { id: string; policyId: string; name: string; rule: RuleInput; status: string; version: number; reason: string; createdAt: string };
export const ruleSelect = `SELECT r.id,r.policy_id::text AS "policyId",r.name,r.rule,r.reason,r.created_at AS "createdAt",e.status,e.version
 FROM rule_revisions r JOIN LATERAL (SELECT status,version FROM rule_lifecycle_events WHERE rule_id=r.id ORDER BY version DESC LIMIT 1) e ON true`;
export async function rulesForHospital(client: PoolClient, hospitalId: string): Promise<RuleRevision[]> {
  return (await client.query(ruleSelect + " WHERE r.hospital_id=$1 ORDER BY r.created_at DESC,r.id", [hospitalId])).rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
export async function registeredRule(client: PoolClient, hospitalId: string, ruleId: string, policyId: string, serviceDate: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,19))", [`admin:${hospitalId}`]);
  const row = (await client.query(ruleSelect + " WHERE r.id=$1 AND r.hospital_id=$2 AND r.policy_id=$3", [ruleId, hospitalId, policyId])).rows[0];
  if (!row || row.status !== "APPROVED") throw new AccessError(409, "Choose an approved rule revision for this hospital and policy.");
  const rule = ruleInput.safeParse(row.rule);
  if (!rule.success || serviceDate < rule.data.validFrom || serviceDate > rule.data.validTo) throw new AccessError(409, "The approved rule does not cover this service date.");
  return rule.data;
}
export async function adminData(headers: Headers) {
  return withActorTransaction(headers, "staff:manage", undefined, async (client, actor) => {
    const hospital = (await client.query(`SELECT hospital_id::text AS id,hospital_name AS name,hospital_code AS code,status FROM hospitals WHERE hospital_id=$1`, [actor.hospitalId])).rows[0];
    const branches = (await client.query(`SELECT branch_id::text AS id,name,branch_code AS code,status FROM branches WHERE hospital_id=$1 ORDER BY branch_id`, [actor.hospitalId])).rows as { id: string; name: string; code: string; status: string }[];
    const staff = (await client.query(`SELECT u.user_id::text AS id,u.hospital_id::text AS "hospitalId",coalesce(a.name,u.username) AS name,u.email,u.status,
      EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id AND r.role_code='SUPER_ADMIN') AS platform
      FROM users u LEFT JOIN auth_user a ON a.id=u.auth_user_id WHERE u.hospital_id=$1 ORDER BY u.user_id`, [actor.hospitalId])).rows as { id: string; hospitalId: string; name: string; email: string; status: string; platform: boolean }[];
    const grants = (await client.query(`SELECT m.user_id::text AS "userId",m.branch_id::text AS "branchId",r.role_code AS role,m.status,m.granted_by::text AS "grantedBy",m.granted_at AS "grantedAt",m.revoked_at AS "revokedAt" FROM user_branch_memberships m JOIN roles r ON r.role_id=m.role_id WHERE m.hospital_id=$1 ORDER BY m.user_id,m.branch_id,r.role_code`, [actor.hospitalId])).rows as { userId: string; branchId: string; role: string; status: string; grantedBy: string | null; grantedAt: Date; revokedAt: Date | null }[];
    const invitations = (await client.query(`SELECT i.id,i.email,i.branch_id::text AS "branchId",r.role_code AS role,i.status,i.expires_at AS "expiresAt" FROM staff_invitations i JOIN roles r ON r.role_id=i.role_id WHERE i.hospital_id=$1 ORDER BY i.created_at DESC LIMIT 200`, [actor.hospitalId])).rows as { id: string; email: string; branchId: string; role: string; status: string; expiresAt: Date }[];
    const policies = (await client.query(`SELECT policy_id::text AS id,plan_name AS name FROM insurance_policies WHERE status='ACTIVE' ORDER BY policy_id`)).rows as { id: string; name: string }[];
    const ruleHistory = (await client.query('SELECT rule_id AS "ruleId",version,status,reason,actor_id::text AS "actorId",created_at AS "createdAt" FROM rule_lifecycle_events WHERE hospital_id=$1 ORDER BY rule_id,version', [actor.hospitalId])).rows as { ruleId: string; version: number; status: string; reason: string; actorId: string; createdAt: Date }[];
    return { actorId: actor.userId, hospital: hospital as { id: string; name: string; code: string; status: string }, branches, staff, grants: grants.map((row) => ({ ...row, grantedAt: row.grantedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null })), invitations: invitations.map((row) => ({ ...row, expiresAt: row.expiresAt.toISOString() })), policies, rules: await rulesForHospital(client, actor.hospitalId), ruleHistory: ruleHistory.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  });
}
export type AdminData = Awaited<ReturnType<typeof adminData>>;
export async function applyAdminAction(headers: Headers, input: unknown): Promise<{ id: string; url?: string }> {
  const parsed = adminInput.safeParse(input);
  if (!parsed.success) throw new AccessError(400, "Provide a supported administration action and valid fields.");
  const value = parsed.data;
  if (value.type === "invite") return createInvitation(await requireStaffSession(headers), value);
  if (value.type === "disable") {
    const actor = await requireStaffSession(headers);
    await disableStaff(actor, value.userId);
    return { id: value.userId };
  }
  return withActorTransaction(headers, "staff:manage", undefined, async (client, actor) => {
    // Serialize branch grants/rule approval against sibling administration requests.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,19))", [`admin:${actor.hospitalId}`]);
    let resultId = actor.hospitalId;
    let old: unknown = null;
    if (value.type === "hospital") {
      const changed = await client.query("UPDATE hospitals SET hospital_name=$2,updated_at=now() WHERE hospital_id=$1 RETURNING hospital_id", [actor.hospitalId, value.name]);
      if (!changed.rowCount) throw new AccessError(404, "The hospital is unavailable.");
    } else if (value.type === "branch-create") {
      resultId = String((await client.query("INSERT INTO branches(hospital_id,branch_code,name) VALUES($1,$2,$3) RETURNING branch_id", [actor.hospitalId, value.code, value.name])).rows[0].branch_id);
    } else if (value.type === "branch") {
      const branch = await client.query("SELECT name,status FROM branches WHERE hospital_id=$1 AND branch_id=$2 FOR UPDATE", [actor.hospitalId, value.branchId]);
      if (!branch.rowCount) throw new AccessError(404, "The branch is outside your hospital.");
      old = branch.rows[0]; resultId = value.branchId;
      await client.query("UPDATE branches SET name=$3,status=$4,updated_at=now() WHERE hospital_id=$1 AND branch_id=$2", [actor.hospitalId, value.branchId, value.name, value.status]);
    } else if (value.type === "revoke-invitation") {
      const result = await client.query("UPDATE staff_invitations SET status='REVOKED' WHERE hospital_id=$1 AND id=$2 AND status='PENDING' RETURNING id", [actor.hospitalId, value.invitationId]);
      if (!result.rowCount) throw new AccessError(409, "The invitation is no longer pending.");
      resultId = value.invitationId;
    } else if (value.type === "grant" || value.type === "revoke-grant") {
      const user = await client.query("SELECT u.user_id FROM users u JOIN staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id WHERE u.hospital_id=$1 AND u.user_id=$2 AND u.status='ACTIVE' AND s.status='ACTIVE' FOR UPDATE OF u", [actor.hospitalId, value.userId]);
      if (!user.rowCount) throw new AccessError(404, "Choose an active staff account in your hospital.");
      if ((await client.query("SELECT smiley_private.is_platform_profile($1) AS platform", [value.userId])).rows[0].platform) throw new AccessError(403, "Hospital administrators cannot change platform access.");
      if (!(await client.query("SELECT branch_id FROM branches WHERE hospital_id=$1 AND branch_id=$2 AND status='ACTIVE'", [actor.hospitalId, value.branchId])).rowCount) throw new AccessError(403, "Choose an active hospital branch.");
      const roleId = String((await client.query("SELECT role_id FROM roles WHERE role_code=$1 AND status='ACTIVE'", [value.role])).rows[0]?.role_id ?? "");
      if (!roleId) throw new AccessError(400, "This role is unavailable.");
      old = (await client.query("SELECT status,granted_by,granted_at FROM user_branch_memberships WHERE hospital_id=$1 AND user_id=$2 AND branch_id=$3 AND role_id=$4", [actor.hospitalId, value.userId, value.branchId, roleId])).rows[0] ?? null;
      if (value.type === "grant") {
        await client.query("INSERT INTO user_roles(hospital_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [actor.hospitalId, value.userId, roleId]);
        await client.query("INSERT INTO user_branch_memberships(hospital_id,user_id,branch_id,role_id,status,granted_by,granted_at) VALUES($1,$2,$3,$4,'ACTIVE',$5,now()) ON CONFLICT(hospital_id,user_id,branch_id,role_id) DO UPDATE SET status='ACTIVE',granted_by=$5,granted_at=now(),revoked_at=NULL", [actor.hospitalId, value.userId, value.branchId, roleId, actor.userId]);
      } else {
        if (!old) throw new AccessError(404, "This branch grant is unavailable.");
        await client.query("UPDATE user_branch_memberships SET status='REVOKED',revoked_at=now() WHERE hospital_id=$1 AND user_id=$2 AND branch_id=$3 AND role_id=$4", [actor.hospitalId, value.userId, value.branchId, roleId]);
      }
      resultId = value.userId;
    } else if (value.type === "rule-create") {
      if (!(await client.query("SELECT policy_id FROM insurance_policies WHERE policy_id=$1 AND status='ACTIVE'", [value.policyId])).rowCount) throw new AccessError(400, "Choose an active policy.");
      resultId = randomUUID();
      await client.query("INSERT INTO rule_revisions(id,hospital_id,policy_id,name,rule,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [resultId, actor.hospitalId, value.policyId, value.name, JSON.stringify(value.rule), value.reason, actor.userId]);
      await client.query("INSERT INTO rule_lifecycle_events(id,hospital_id,rule_id,version,status,reason,actor_id) VALUES($1,$2,$3,1,'DRAFT',$4,$5)", [randomUUID(), actor.hospitalId, resultId, value.reason, actor.userId]);
    } else if (value.type === "rule-state") {
      const current = (await client.query(ruleSelect + " WHERE r.id=$1 AND r.hospital_id=$2", [value.ruleId, actor.hospitalId])).rows[0];
      if (!current) throw new AccessError(404, "The rule revision is outside your hospital.");
      if (current.version !== value.expectedVersion || (value.status === "APPROVED" ? current.status !== "DRAFT" : current.status !== "APPROVED")) throw new AccessError(409, "The rule lifecycle changed or this transition is unavailable.");
      if (value.status === "APPROVED") {
        const conflict = (await rulesForHospital(client, actor.hospitalId)).some((row) => row.id !== value.ruleId && row.policyId === current.policyId && row.status === "APPROVED" && row.rule.validFrom <= current.rule.validTo && row.rule.validTo >= current.rule.validFrom);
        if (conflict) throw new AccessError(409, "Retire the overlapping approved policy rule before approving this revision.");
      }
      old = { status: current.status, version: current.version }; resultId = value.ruleId;
      await client.query("INSERT INTO rule_lifecycle_events(id,hospital_id,rule_id,version,status,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), actor.hospitalId, value.ruleId, current.version + 1, value.status, value.reason, actor.userId]);
    }
    await writeAudit(client, actor, null, "administration", value.type.toUpperCase(), /^[0-9]+$/u.test(resultId) ? resultId : null, old, { ...value, resultId });
    return { id: resultId };
  });
}
async function withPlatform<T>(headers: Headers, operation: (client: PoolClient, actor: Actor) => Promise<T>) {
  const identity = await requireStaffSession(headers);
  const client = await appPool.connect();
  try {
    await client.query("BEGIN"); await setIdentityContext(client, identity.authUserId);
    // ponytail: serialize low-volume registry access; finer locks if administration traffic warrants it.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('platform-registry',19))");
    const current = await lookupStaff(client, identity.authUserId);
    if (!current || !current.roles.includes("SUPER_ADMIN")) throw new AccessError(403, "A current platform administrator is required.");
    await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.hospital_id',$2,true)", [current.userId, current.hospitalId]);
    const result = await operation(client, current); await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function platformData(headers: Headers) {
  return withPlatform(headers, async (client) => ({
    hospitals: (await client.query("SELECT hospital_id::text AS id,hospital_code AS code,hospital_name AS name,status FROM hospitals ORDER BY hospital_id")).rows as { id: string; name: string; code: string; status: string }[],
    branches: (await client.query('SELECT branch_id::text AS id,hospital_id::text AS "hospitalId",branch_code AS code,name,status FROM branches ORDER BY hospital_id,branch_id')).rows as { id: string; hospitalId: string; name: string; code: string; status: string }[],
  }));
}
export type PlatformData = Awaited<ReturnType<typeof platformData>>;
export async function applyPlatformAction(headers: Headers, input: unknown) {
  const parsed = platformInput.safeParse(input); if (!parsed.success) throw new AccessError(400, "Provide a supported platform registry action.");
  const value = parsed.data;
  return withPlatform(headers, async (client, actor) => {
    let resultId: string;
    if (value.type === "hospital-create") resultId = String((await client.query("INSERT INTO hospitals(hospital_code,hospital_name) VALUES($1,$2) RETURNING hospital_id", [value.code, value.name])).rows[0].hospital_id);
    else if (value.type === "hospital") {
      if (value.hospitalId === actor.hospitalId && value.status === "INACTIVE") throw new AccessError(409, "Another platform administrator must deactivate your own registry hospital.");
      const result = await client.query("UPDATE hospitals SET hospital_name=$2,status=$3,updated_at=now() WHERE hospital_id=$1 RETURNING hospital_id", [value.hospitalId, value.name, value.status]);
      if (!result.rowCount) throw new AccessError(404, "The hospital registry entry is unavailable."); resultId = value.hospitalId;
    } else {
      if (!(await client.query("SELECT hospital_id FROM hospitals WHERE hospital_id=$1", [value.hospitalId])).rowCount) throw new AccessError(404, "The hospital registry entry is unavailable.");
      if (value.type === "branch-create") resultId = String((await client.query("INSERT INTO branches(hospital_id,branch_code,name) VALUES($1,$2,$3) RETURNING branch_id", [value.hospitalId, value.code, value.name])).rows[0].branch_id);
      else {
        const result = await client.query("UPDATE branches SET name=$3,status=$4,updated_at=now() WHERE hospital_id=$1 AND branch_id=$2 RETURNING branch_id", [value.hospitalId, value.branchId, value.name, value.status]);
        if (!result.rowCount) throw new AccessError(404, "The branch registry entry is unavailable."); resultId = value.branchId;
      }
    }
    await writeAudit(client, actor, null, "platform-registry", value.type.toUpperCase(), resultId, null, value);
    return { id: resultId };
  });
}
