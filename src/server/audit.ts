import type { PoolClient } from "pg";
import type { StaffSession } from "./auth";

export async function writeAudit(client: PoolClient, actor: StaffSession, branchId: string | null,
  moduleName: string, action: string, entityId: string | null, oldData: unknown, newData: unknown): Promise<void> {
  await client.query(`INSERT INTO audit_logs(hospital_id,branch_id,user_id,module_name,entity_type,entity_id,action_name,old_data,new_data)
    VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8)`,
  [actor.hospitalId, branchId, actor.userId, moduleName, entityId, action,
    oldData === null ? null : JSON.stringify(oldData), newData === null ? null : JSON.stringify(newData)]);
}
