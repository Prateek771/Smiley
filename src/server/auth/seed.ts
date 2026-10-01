import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { migrationPool } from "../db/client";
import { createAuth, type StaffSession } from "./index";

type SeedKey = "adminA" | "deskA" | "deskNorthA" | "billingA" | "financeA" | "auditorA" | "adminB" | "deskB" | "platform";
export type SyntheticStaffUser = StaffSession & { password: string; branchId: string };
export async function seedAuthUsers(options: { pool?: Pool; password?: string } = {}): Promise<Record<SeedKey, SyntheticStaffUser>> {
  const pool = options.pool ?? migrationPool;
  const database = await pool.query("SELECT current_database() AS name");
  const databaseName = String(database.rows[0].name);
  if (!/^sehospitaldb(?:_test)?$/u.test(databaseName)) throw new Error("Auth seed supports only the isolated synthetic development/test databases.");
  const fixturePath = resolve("tmp", `synthetic-auth-${databaseName}.json`);
  const saved = await readFile(fixturePath, "utf8").then((text) => JSON.parse(text) as Partial<Record<SeedKey, SyntheticStaffUser>>).catch(() => ({} as Partial<Record<SeedKey, SyntheticStaffUser>>));
  const defaultPassword = options.password ?? saved.adminA?.password ?? randomBytes(24).toString("base64url");
  if (defaultPassword.length < 12 || defaultPassword.length > 128) throw new Error("Synthetic password must be 12–128 characters.");
  const definitions = [
    { key: "adminA", email: "admin.a@smiley.test", name: "Synthetic Hospital A Admin", hospital: "SYN-A", branches: ["A-CENTRAL", "A-NORTH"], role: "HOSPITAL_ADMIN" },
    { key: "deskA", email: "desk.a@smiley.test", name: "Synthetic Hospital A Desk", hospital: "SYN-A", branches: ["A-CENTRAL"], role: "INSURANCE_EXECUTIVE" },
    { key: "deskNorthA", email: "desk.north.a@smiley.test", name: "Synthetic Hospital A North Desk", hospital: "SYN-A", branches: ["A-NORTH"], role: "INSURANCE_EXECUTIVE" },
    { key: "billingA", email: "billing.a@smiley.test", name: "Synthetic Hospital A Billing", hospital: "SYN-A", branches: ["A-CENTRAL"], role: "BILLING_OFFICER" },
    { key: "financeA", email: "finance.a@smiley.test", name: "Synthetic Hospital A Finance", hospital: "SYN-A", branches: ["A-CENTRAL"], role: "FINANCE_OFFICER" },
    { key: "auditorA", email: "auditor.a@smiley.test", name: "Synthetic Hospital A Auditor", hospital: "SYN-A", branches: ["A-CENTRAL"], role: "REPORT_USER" },
    { key: "adminB", email: "admin.b@smiley.test", name: "Synthetic Hospital B Admin", hospital: "SYN-B", branches: ["B-CENTRAL"], role: "HOSPITAL_ADMIN" },
    { key: "deskB", email: "desk.b@smiley.test", name: "Synthetic Hospital B Desk", hospital: "SYN-B", branches: ["B-CENTRAL"], role: "INSURANCE_EXECUTIVE" },
    { key: "platform", email: "platform@smiley.test", name: "Synthetic Platform Registry Admin", hospital: "SYN-A", branches: [], role: "SUPER_ADMIN" },
  ] as const;
  const results = {} as Record<SeedKey, SyntheticStaffUser>;
  for (const definition of definitions) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const hospital = await client.query("SELECT hospital_id FROM hospitals WHERE hospital_code=$1 AND status='ACTIVE'", [definition.hospital]);
      const role = await client.query("SELECT role_id FROM roles WHERE role_code=$1 AND status='ACTIVE'", [definition.role]);
      if (hospital.rowCount !== 1 || role.rowCount !== 1) throw new Error("Synthetic hospital and role fixtures must exist before auth provisioning.");
      const hospitalId = String(hospital.rows[0].hospital_id);
      const roleId = String(role.rows[0].role_id);
      const branchResult = await client.query("SELECT branch_id,branch_code FROM branches WHERE hospital_id=$1 AND branch_code=ANY($2::text[]) ORDER BY branch_id", [hospitalId, [...definition.branches]]);
      if (branchResult.rowCount !== definition.branches.length) throw new Error("Synthetic branch fixture is missing.");
      const branchIds = branchResult.rows.map((row) => String(row.branch_id));
      await client.query(
        "SELECT set_config('app.hospital_id',$1,true),set_config('app.branch_ids',$2,true),set_config('app.write_branch_ids',$2,true),set_config('app.is_hospital_admin','true',true)",
        [hospitalId, branchIds.join(",")],
      );
      const transactionAuth = createAuth(client, false);
      const existing = await client.query("SELECT id FROM auth_user WHERE email=$1", [definition.email]);
      let authUserId: string;
      if (existing.rowCount) {
        authUserId = String(existing.rows[0].id);
        const hash = await hashPassword(defaultPassword);
        await client.query("UPDATE auth_account SET password=$2 WHERE user_id=$1 AND provider_id='credential'", [authUserId, hash]);
      } else {
        const created = await transactionAuth.api.signUpEmail({ body: { email: definition.email, name: definition.name, password: defaultPassword } });
        authUserId = created.user.id;
      }
      await client.query("SELECT set_config('app.auth_user_id',$1,true)", [authUserId]);
      const profile = await client.query(
        "INSERT INTO staff(hospital_id,employee_code,first_name,email,status) VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT (hospital_id,employee_code) DO UPDATE SET status='ACTIVE' RETURNING staff_id",
        [hospitalId, `SYN-${definition.key}`, definition.name, definition.email],
      );
      const domain = await client.query(
        "INSERT INTO users(hospital_id,auth_user_id,staff_id,username,email,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') ON CONFLICT (auth_user_id) DO UPDATE SET status='ACTIVE' RETURNING user_id,hospital_id",
        [hospitalId, authUserId, profile.rows[0].staff_id, `SYN-${definition.key}`, definition.email],
      );
      if (String(domain.rows[0].hospital_id) !== hospitalId) throw new Error("Synthetic identity is already linked to another hospital.");
      const userId = String(domain.rows[0].user_id);
      await client.query("SELECT set_config('app.user_id',$1,true)", [userId]);
      await client.query("INSERT INTO user_roles(hospital_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [hospitalId, userId, roleId]);
      for (const branchId of branchIds) {
        await client.query("INSERT INTO user_branch_memberships(hospital_id,user_id,branch_id,role_id,status) VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(hospital_id,user_id,branch_id,role_id) DO UPDATE SET status='ACTIVE'", [hospitalId, userId, branchId, roleId]);
      }
      await client.query("COMMIT");
      results[definition.key] = {
        authUserId, userId, hospitalId, email: definition.email, name: definition.name,
        roles: [definition.role], branchIds, branchId: branchIds[0] ?? "",
        branchRoles: branchIds.map((branchId) => ({ branchId, role: definition.role })),
        password: defaultPassword,
      };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  await mkdir(resolve("tmp"), { recursive: true });
  await writeFile(fixturePath, JSON.stringify(results, null, 2) + "\n", { mode: 0o600 });
  return results;
}
