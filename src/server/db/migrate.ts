import path from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";
import { migrationPool, loadEnvironment } from "./client";

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function grantApplicationAccess(client: PoolClient): Promise<void> {
  const url = process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) {
    throw new Error("An explicit application database connection is required for grants.");
  }
  const role = quoteIdentifier(decodeURIComponent(new URL(url).username));
  const catalogs = ["roles", "permissions", "role_permissions", "insurance_categories", "insurance_subcategories", "insurance_companies", "tpas", "insurance_company_tpas", "insurance_policies", "treatment_services", "workflow_definitions", "coverage_rules", "government_schemes"];
  const immutable = ["claim_events", "audit_logs", "document_revisions", "document_evidence"];
  const auth = ["auth_user", "auth_account", "auth_session", "auth_verification"];
  await client.query("BEGIN");
  try {
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await client.query(`REVOKE INSERT, UPDATE ON ${catalogs.map(quoteIdentifier).join(", ")} FROM ${role}`);
    await client.query(`REVOKE UPDATE ON ${immutable.map(quoteIdentifier).join(", ")} FROM ${role}`);
    await client.query(`GRANT DELETE ON ${auth.map(quoteIdentifier).join(", ")}, user_roles, user_branch_memberships TO ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function migrateDatabase(pool: Pool = migrationPool): Promise<void> {
  loadEnvironment();
  const folder = path.join(process.cwd(), "drizzle");
  const files = readMigrationFiles({ migrationsFolder: folder });
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(1719237611, 42)");
    locked = true;
    const ledger = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
    const applied = ledger.rows[0].name
      ? await client.query<{ hash: string; created_at: string }>("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")
      : null;
    if (!applied || applied.rowCount === 0) {
      const existing = await client.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
      if (existing.rows[0].count !== 0) {
        throw new Error("Refusing to initialize migrations over an existing untracked application schema.");
      }
    } else {
      for (const row of applied.rows) {
        const file = files.find((candidate) => String(candidate.folderMillis) === String(row.created_at));
        if (!file || file.hash !== row.hash) {
          throw new Error("An applied migration was removed or changed; create an additive migration instead.");
        }
      }
    }
    await migrate(drizzle(client), { migrationsFolder: folder });
    await grantApplicationAccess(client);
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock(1719237611, 42)");
    }
    client.release();
  }
}
