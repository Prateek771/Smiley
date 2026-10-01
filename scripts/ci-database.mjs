import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { Pool } from "pg";

if (process.env.CI !== "true" || !process.env.GITHUB_ENV) throw new Error("Use this bootstrap only in the disposable GitHub CI job.");
const bootstrap = new URL(process.env.CI_BOOTSTRAP_DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(bootstrap.hostname) || bootstrap.username !== "postgres" || bootstrap.pathname !== "/postgres") {
  throw new Error("CI bootstrap must target the local disposable postgres service.");
}
const pool = new Pool({ connectionString: bootstrap.toString(), max: 1 });
const appPassword = randomBytes(32).toString("hex");
const migrationPassword = randomBytes(32).toString("hex");
const authSecret = randomBytes(32).toString("hex");
for (const value of [appPassword, migrationPassword, authSecret]) console.log(`::add-mask::${value}`);
try {
  await pool.query(`CREATE ROLE smiley_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await pool.query(`CREATE ROLE smiley_migrator LOGIN PASSWORD '${migrationPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await pool.query("CREATE DATABASE sehospitaldb_test OWNER smiley_migrator");
  const url = (role, password) => {
    const result = new URL(bootstrap);
    result.username = role; result.password = password; result.pathname = "/sehospitaldb_test";
    return result.toString();
  };
  const application = url("smiley_app", appPassword);
  const migration = url("smiley_migrator", migrationPassword);
  appendFileSync(process.env.GITHUB_ENV, [
    `DATABASE_URL=${application}`, `TEST_DATABASE_URL=${application}`,
    `MIGRATION_DATABASE_URL=${migration}`, `TEST_MIGRATION_DATABASE_URL=${migration}`,
    `BETTER_AUTH_SECRET=${authSecret}`, "BETTER_AUTH_URL=http://127.0.0.1:3210",
    "PRIVATE_STORAGE_DIR=./tmp/private-storage-test", "",
  ].join("\n"));
  console.log("Created isolated CI database with non-owner app and separate migration roles.");
} finally { await pool.end(); }
