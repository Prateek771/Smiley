import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const expectedConnections = [
  ["DATABASE_URL", "smiley_app", "sehospitaldb"],
  ["TEST_DATABASE_URL", "smiley_app", "sehospitaldb_test"],
  ["MIGRATION_DATABASE_URL", "smiley_migrator", "sehospitaldb"],
  ["TEST_MIGRATION_DATABASE_URL", "smiley_migrator", "sehospitaldb_test"],
];

function localUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("An explicit PostgreSQL connection is required."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !localHosts.has(url.hostname) || !url.username || !url.password || url.search || url.hash) {
    throw new Error("Native runtime connections require a loopback PostgreSQL host and credentials.");
  }
  return url;
}

export function validateConnections(environment) {
  const connections = expectedConnections.map(([key, role, database]) => {
    const url = localUrl(environment[key]);
    if (decodeURIComponent(url.username) !== role || decodeURIComponent(url.pathname.slice(1)) !== database) {
      throw new Error(`${key} must use its dedicated restricted role and database.`);
    }
    return { key, url, role, database };
  });
  if (connections.some(({ url }) => url.hostname !== connections[0].url.hostname || (url.port || "5432") !== (connections[0].url.port || "5432"))) {
    throw new Error("All native runtime connections must reference the same local server.");
  }
  return connections;
}

export function validateAdminUrl(value) {
  const url = localUrl(value);
  if (url.pathname !== "/postgres") throw new Error("Setup must target the local postgres administration database.");
  return url;
}

function configuration() {
  if (!existsSync(".env.local") || !existsSync(".env.test.local")) {
    throw new Error("Run npm run db:setup with LOCAL_POSTGRES_ADMIN_URL to create local configuration.");
  }
  const environment = parseEnv(readFileSync(".env.local", "utf8"));
  const tests = parseEnv(readFileSync(".env.test.local", "utf8"));
  const connections = validateConnections(environment);
  validateConnections({ ...environment, TEST_DATABASE_URL: tests.TEST_DATABASE_URL, TEST_MIGRATION_DATABASE_URL: tests.TEST_MIGRATION_DATABASE_URL });
  if (tests.DATABASE_URL !== environment.TEST_DATABASE_URL || tests.MIGRATION_DATABASE_URL !== environment.TEST_MIGRATION_DATABASE_URL ||
      tests.TEST_DATABASE_URL !== environment.TEST_DATABASE_URL || tests.TEST_MIGRATION_DATABASE_URL !== environment.TEST_MIGRATION_DATABASE_URL) {
    throw new Error("The test environment must reference only the isolated test database.");
  }
  return { environment, connections };
}

export async function checkConnections(connections) {
  for (const { key, url, role, database } of connections) {
    const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 3000 });
    try {
      const { rows: [actual] } = await pool.query(`SELECT current_database() AS database, current_user AS role,
        current_setting('server_version_num')::integer AS version,
        r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
        pg_get_userbyid(d.datdba) AS owner
        FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`);
      if (actual.database !== database || actual.role !== role || actual.version < 170000 ||
          [actual.rolsuper, actual.rolcreatedb, actual.rolcreaterole, actual.rolreplication, actual.rolbypassrls].some(Boolean) ||
          actual.owner !== "smiley_migrator") {
        throw new Error("Unexpected database version, ownership or role privileges.");
      }
      console.log(`${key}: connected to ${url.hostname}:${url.port || "5432"}/${database} as ${role} (PostgreSQL ${Math.floor(actual.version / 10000)}).`);
    } finally { await pool.end(); }
  }
}

async function setup() {
  if (existsSync(".env.local") || existsSync(".env.test.local")) {
    await checkConnections(configuration().connections);
    console.log("Existing configuration and data retained; no identities or databases changed.");
    return;
  }
  const adminUrl = validateAdminUrl(process.env.LOCAL_POSTGRES_ADMIN_URL);
  const pool = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 3000 });
  try {
    const { rows: [server] } = await pool.query("SELECT current_setting('server_version_num')::integer AS version, rolsuper FROM pg_roles WHERE rolname=current_user");
    if (server.version < 170000 || !server.rolsuper) throw new Error("Setup requires a local PostgreSQL 17+ administrator connection.");
    const collision = await pool.query("SELECT rolname AS name FROM pg_roles WHERE rolname IN ('smiley_app','smiley_migrator') UNION ALL SELECT datname FROM pg_database WHERE datname IN ('sehospitaldb','sehospitaldb_test')");
    if (collision.rowCount) throw new Error("Smiley roles or database names already exist. Preserve them and configure their existing connections; setup will not overwrite them.");
    const appPassword = randomBytes(32).toString("hex");
    const migrationPassword = randomBytes(32).toString("hex");
    const url = (role, password, database) => {
      const result = new URL(adminUrl); result.username = role; result.password = password; result.pathname = `/${database}`;
      return result.toString();
    };
    const environment = {
      DATABASE_URL: url("smiley_app", appPassword, "sehospitaldb"),
      TEST_DATABASE_URL: url("smiley_app", appPassword, "sehospitaldb_test"),
      MIGRATION_DATABASE_URL: url("smiley_migrator", migrationPassword, "sehospitaldb"),
      TEST_MIGRATION_DATABASE_URL: url("smiley_migrator", migrationPassword, "sehospitaldb_test"),
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BETTER_AUTH_URL: "http://localhost:3000",
      PRIVATE_STORAGE_DIR: path.resolve("tmp/private-storage").replaceAll("\\", "/"),
    };
    mkdirSync("tmp/private-storage", { recursive: true });
    const serialize = (values) => Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n";
    // Persist recovery credentials before creating infrastructure; exclusive writes never replace configuration.
    writeFileSync(".env.local", serialize(environment), { flag: "wx", mode: 0o600 });
    writeFileSync(".env.test.local", serialize({ ...environment, DATABASE_URL: environment.TEST_DATABASE_URL,
      MIGRATION_DATABASE_URL: environment.TEST_MIGRATION_DATABASE_URL, PRIVATE_STORAGE_DIR: `${environment.PRIVATE_STORAGE_DIR}-test` }), { flag: "wx", mode: 0o600 });
    await pool.query("BEGIN");
    try {
      await pool.query(`CREATE ROLE smiley_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${appPassword}'`);
      await pool.query(`CREATE ROLE smiley_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${migrationPassword}'`);
      await pool.query("COMMIT");
    } catch (error) { await pool.query("ROLLBACK"); throw error; }
    await pool.query("CREATE DATABASE sehospitaldb OWNER smiley_migrator TEMPLATE template0 ENCODING 'UTF8'");
    await pool.query("CREATE DATABASE sehospitaldb_test OWNER smiley_migrator TEMPLATE template0 ENCODING 'UTF8'");
    await checkConnections(validateConnections(environment));
    console.log("Native databases provisioned. Apply reviewed migrations and synthetic seeds for a new installation.");
  } finally { await pool.end(); }
}

async function main() {
  const [action = "status", ...extra] = process.argv.slice(2);
  if (extra.length || !["setup", "start", "status"].includes(action)) throw new Error("Use setup, start or status. This runtime never stops the shared PostgreSQL service.");
  if (action === "setup") return setup();
  const { environment, connections } = configuration();
  if (action === "start" && process.platform === "win32") {
    const serviceName = environment.LOCAL_POSTGRES_SERVICE || "postgresql-x64-18";
    if (!/^[a-zA-Z0-9_-]+$/.test(serviceName)) throw new Error("Unexpected local PostgreSQL service name.");
    const command = `$ErrorActionPreference='Stop'; $service=Get-Service -Name '${serviceName}'; if ($service.Status -ne 'Running') { Start-Service -Name '${serviceName}'; $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(20)) }`;
    const started = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, encoding: "utf8", timeout: 25000 });
    if (started.error || started.status !== 0) throw new Error("Start the configured native PostgreSQL Windows service (administrator access may be required), then retry db:status.");
  }
  await checkConnections(connections);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Native PostgreSQL runtime check/setup failed. Check local service, explicit credentials, restricted roles and unused database names. Existing data/configuration were not replaced; recover partial setup manually if necessary.");
    process.exitCode = 1;
  });
}
