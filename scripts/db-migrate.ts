
async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== "--test")) {
    console.error("Use no arguments for the configured database, or --test for the isolated test database.");
    process.exitCode = 1;
    return;
  }
  if (arguments_.includes("--test")) process.env.NODE_ENV = "test";
  const { migrateDatabase } = await import("../src/server/db/migrate");
  const { closePools } = await import("../src/server/db/client");
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
