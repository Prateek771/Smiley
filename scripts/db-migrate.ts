import { migrateDatabase } from "../src/server/db/migrate";
import { closePools } from "../src/server/db/client";

async function main(): Promise<void> {
  try {
    await migrateDatabase();
    console.log("Reviewed additive database migrations applied.");
  } catch {
    console.error("Database migration failed. Check the configured migration connection and reviewed migration files.");
    process.exitCode = 1;
  } finally {
    await closePools();
  }
}

void main();
