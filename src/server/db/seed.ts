import type { Pool, PoolClient } from "pg";
import { migrationPool, loadEnvironment } from "./client";
import { masterSeedStatements } from "./seed-data";

export interface SyntheticSeedIds {
  hospitals: { a: string; b: string };
  branches: { aCentral: string; aNorth: string; bCentral: string };
  roles: Record<string, string>;
  patients: { a: string; aOther: string; b: string };
  memberships: { a: string; aOther: string; b: string };
  encounters: { a: string; aNorth: string; aOther: string; b: string };
  payer: { company: string; policy: string };
}

function identifier(value: string): string {
  if (!/^[a-z_]+$/.test(value)) {
    throw new Error("Seed identifiers must be fixed database names.");
  }
  return `"${value}"`;
}

async function upsert(
  client: PoolClient,
  table: string,
  idColumn: string,
  values: Record<string, string>,
  conflict: string[],
): Promise<string> {
  const columns = Object.keys(values);
  const statement = `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")}) ON CONFLICT (${conflict.map(identifier).join(", ")}) DO UPDATE SET ${identifier(conflict[0])}=EXCLUDED.${identifier(conflict[0])} RETURNING ${identifier(idColumn)}::text AS id`;
  const result = await client.query<{ id: string }>(statement, Object.values(values));
  return result.rows[0].id;
}

export async function seedSynthetic(pool: Pool = migrationPool): Promise<SyntheticSeedIds> {
  loadEnvironment();
  const client = await pool.connect();
  try {
    const info = await client.query<{ name: string }>("SELECT current_database() AS name");
    const { name } = info.rows[0];
    const configuredUrl = process.env.NODE_ENV === "test" ? process.env.TEST_MIGRATION_DATABASE_URL : process.env.MIGRATION_DATABASE_URL;
    const connection = configuredUrl ? new URL(configuredUrl) : null;
    if ((name !== "sehospitaldb" && !name.endsWith("_test")) || !connection || !["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname) || decodeURIComponent(connection.pathname.slice(1)) !== name) {
      throw new Error("Synthetic seeding is limited to the explicit local development/test databases.");
    }
    const existing = await client.query("SELECT 1 FROM hospitals WHERE hospital_code NOT LIKE 'SYN-%' LIMIT 1");
    if (existing.rowCount) {
      throw new Error("Refusing to add synthetic patients to an unrecognized existing hospital database.");
    }
    await client.query("BEGIN");
    for (const statement of masterSeedStatements) {
      await client.query(statement);
    }
    const a = await upsert(client, "hospitals", "hospital_id", { hospital_code: "SYN-A", hospital_name: "Synthetic Hospital A" }, ["hospital_code"]);
    const b = await upsert(client, "hospitals", "hospital_id", { hospital_code: "SYN-B", hospital_name: "Synthetic Hospital B" }, ["hospital_code"]);
    const aCentral = await upsert(client, "branches", "branch_id", { hospital_id: a, branch_code: "A-CENTRAL", name: "Synthetic A Central" }, ["hospital_id", "branch_code"]);
    const aNorth = await upsert(client, "branches", "branch_id", { hospital_id: a, branch_code: "A-NORTH", name: "Synthetic A North" }, ["hospital_id", "branch_code"]);
    const bCentral = await upsert(client, "branches", "branch_id", { hospital_id: b, branch_code: "B-CENTRAL", name: "Synthetic B Central" }, ["hospital_id", "branch_code"]);
    const company = await upsert(client, "insurance_companies", "insurance_company_id", { company_code: "SYN-INSURER", company_name: "Fictional Synthetic Insurer" }, ["company_code"]);
    const subtype = await client.query<{ id: string }>("SELECT s.insurance_subcategory_id::text AS id FROM insurance_subcategories s JOIN insurance_categories c USING(insurance_category_id) WHERE c.category_code='PRIVATE' AND s.subcategory_code='INDIVIDUAL'");
    const policy = await upsert(client, "insurance_policies", "policy_id", { insurance_company_id: company, insurance_subcategory_id: subtype.rows[0].id, policy_code: "SYN-PLAN", plan_name: "Fictional synthetic plan", policy_type: "INDIVIDUAL", coverage_limit: "100000.00", terms_text: "Synthetic development only; not a real coverage contract." }, ["policy_code"]);
    const patientA = await upsert(client, "patients", "patient_id", { hospital_id: a, patient_code: "SYN-PAT-A", first_name: "Fictional A", last_name: "Synthetic" }, ["hospital_id", "patient_code"]);
    const patientAOther = await upsert(client, "patients", "patient_id", { hospital_id: a, patient_code: "SYN-PAT-A-OTHER", first_name: "Fictional A Other", last_name: "Synthetic" }, ["hospital_id", "patient_code"]);
    const patientB = await upsert(client, "patients", "patient_id", { hospital_id: b, patient_code: "SYN-PAT-B", first_name: "Fictional B", last_name: "Synthetic" }, ["hospital_id", "patient_code"]);
    const membershipA = await upsert(client, "patient_insurance", "patient_insurance_id", { hospital_id: a, patient_id: patientA, policy_id: policy, policy_number: "SYN-POL-A", member_id: "SYN-MEM-A", sum_insured: "100000.00", valid_from: "2026-01-01", valid_to: "2030-12-31" }, ["patient_id", "policy_number"]);
    const membershipAOther = await upsert(client, "patient_insurance", "patient_insurance_id", { hospital_id: a, patient_id: patientAOther, policy_id: policy, policy_number: "SYN-POL-A-OTHER", member_id: "SYN-MEM-A-OTHER", sum_insured: "100000.00", valid_from: "2026-01-01", valid_to: "2030-12-31" }, ["patient_id", "policy_number"]);
    const membershipB = await upsert(client, "patient_insurance", "patient_insurance_id", { hospital_id: b, patient_id: patientB, policy_id: policy, policy_number: "SYN-POL-B", member_id: "SYN-MEM-B", sum_insured: "100000.00", valid_from: "2026-01-01", valid_to: "2030-12-31" }, ["patient_id", "policy_number"]);
    const encounterA = await upsert(client, "encounters", "encounter_id", { hospital_id: a, branch_id: aCentral, patient_id: patientA, encounter_no: "SYN-ENC-A", encounter_type: "IPD" }, ["encounter_no"]);
    const encounterANorth = await upsert(client, "encounters", "encounter_id", { hospital_id: a, branch_id: aNorth, patient_id: patientA, encounter_no: "SYN-ENC-A-NORTH", encounter_type: "IPD" }, ["encounter_no"]);
    const encounterAOther = await upsert(client, "encounters", "encounter_id", { hospital_id: a, branch_id: aCentral, patient_id: patientAOther, encounter_no: "SYN-ENC-A-OTHER", encounter_type: "IPD" }, ["encounter_no"]);
    const encounterB = await upsert(client, "encounters", "encounter_id", { hospital_id: b, branch_id: bCentral, patient_id: patientB, encounter_no: "SYN-ENC-B", encounter_type: "IPD" }, ["encounter_no"]);
    const roles = await client.query<{ role_code: string; id: string }>("SELECT role_code, role_id::text AS id FROM roles");
    await client.query("COMMIT");
    return {
      hospitals: { a, b },
      branches: { aCentral, aNorth, bCentral },
      roles: Object.fromEntries(roles.rows.map((role) => [role.role_code, role.id])),
      patients: { a: patientA, aOther: patientAOther, b: patientB },
      memberships: { a: membershipA, aOther: membershipAOther, b: membershipB },
      encounters: { a: encounterA, aNorth: encounterANorth, aOther: encounterAOther, b: encounterB },
      payer: { company, policy },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
