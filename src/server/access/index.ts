import type { PoolClient } from "pg";
import { appPool } from "../db/client";
import { AuthError, lookupStaff, requireStaffSession, setIdentityContext, type StaffSession } from "../auth";
import { branchScope, type Permission } from "./permissions";

export class AccessError extends AuthError {}
export type Actor = StaffSession;

export async function withActorTransaction<T>(headers: Headers, permission: Permission, branchId: string | undefined,
  operation: (client: PoolClient, actor: Actor) => Promise<T>): Promise<T> {
  const authenticated = await requireStaffSession(headers);
  return withIdentityTransaction(authenticated.authUserId, permission, branchId, operation);
}
// Background work must rehydrate current grants; persisted sessions or role snapshots are never trusted.
export async function withIdentityTransaction<T>(authUserId: string, permission: Permission, branchId: string | undefined,
  operation: (client: PoolClient, actor: Actor) => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await setIdentityContext(client, authUserId);
    const actor = await lookupStaff(client, authUserId);
    if (!actor) throw new AccessError(401, "Your staff access is no longer active.");
    const readable = branchScope(actor, "case:read");
    const permitted = branchScope(actor, permission);
    const isAdmin = actor.roles.includes("HOSPITAL_ADMIN") && !actor.roles.includes("SUPER_ADMIN");
    if ((permission === "staff:manage" && !isAdmin) || (permission !== "staff:manage" && !permitted.length)
      || (branchId !== undefined && !permitted.includes(branchId))) {
      throw new AccessError(403, "This action is outside your staff permissions or assigned branch.");
    }
    const writes = permission.endsWith(":read") ? [] : permitted;
    await client.query(`SELECT set_config('app.user_id',$1,true),set_config('app.hospital_id',$2,true),
      set_config('app.branch_ids',$3,true),set_config('app.write_branch_ids',$4,true),
      set_config('app.is_hospital_admin',$5,true),set_config('app.can_register',$6,true),set_config('app.permission',$7,true)`,
    [actor.userId, actor.hospitalId, readable.join(","), writes.join(","), String(isAdmin), String(permission === "patient:write" || isAdmin), permission]);
    const result = await operation(client, actor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
