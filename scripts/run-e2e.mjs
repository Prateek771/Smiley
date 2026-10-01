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

console.log("Browser checks use the isolated synthetic test database and fresh staff fixtures.");
const child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "development", PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3210" },
});
child.on("error", () => {
  console.error("The browser check runner could not start.");
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
