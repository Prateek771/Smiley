import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

process.env.NODE_ENV = "test";
if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");
const application = process.env.TEST_DATABASE_URL;
const migration = process.env.TEST_MIGRATION_DATABASE_URL;
if (!application || !migration) throw new Error("Browser checks require explicit isolated test database connections.");
for (const value of [application, migration]) {
  const connection = new URL(value);
  if (decodeURIComponent(connection.pathname.slice(1)) !== "sehospitaldb_test" || !["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname)) {
    throw new Error("Browser checks must use the local sehospitaldb_test database.");
  }
}
process.env.DATABASE_URL = application;
process.env.MIGRATION_DATABASE_URL = migration;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3210";
process.env.PRIVATE_STORAGE_DIR = path.resolve("tmp/private-storage-test");

const reuseBuild = process.env.PLAYWRIGHT_SKIP_BUILD === "1";
if (reuseBuild && !existsSync(path.resolve(".next/BUILD_ID"))) {
  throw new Error("Skipping the browser-check build requires an existing production BUILD_ID.");
}

const { migrateDatabase } = await import("../src/server/db/migrate.ts");
const { seedSynthetic } = await import("../src/server/db/seed.ts");
const { seedAuthUsers } = await import("../src/server/auth/seed.ts");
const { closePools } = await import("../src/server/db/client.ts");
try {
  await migrateDatabase();
  await seedSynthetic();
  await seedAuthUsers();
} finally {
  await closePools();
}

async function runNode(args, startError) {
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, NODE_ENV: "production", PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3210" },
    });
    child.once("error", () => { console.error(startError); resolveExit(1); });
    child.once("exit", (code, signal) => { resolveExit(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)); });
  });
}

// Build the served artifact for local checks; CI can reuse its preceding build explicitly.
const buildExit = reuseBuild ? 0 : await runNode(["node_modules/next/dist/bin/next", "build"], "The browser-check production build could not start.");
if (buildExit !== 0) {
  process.exitCode = buildExit;
} else {
  console.log("Browser checks serve a production build with the isolated synthetic test database and fresh staff fixtures.");
  process.exitCode = await runNode(["node_modules/@playwright/test/cli.js", ...process.argv.slice(2)], "The browser check runner could not start.");
}
