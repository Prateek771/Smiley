
async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== "--test")) {
    console.error("Use no arguments for the configured database, or --test for the isolated test database.");
    process.exitCode = 1;
    return;
  }
  if (arguments_.includes("--test")) process.env.NODE_ENV = "test";
  const { seedSynthetic } = await import("../src/server/db/seed");
  const { closePools } = await import("../src/server/db/client");
  try {
    await seedSynthetic();
    console.log("Synthetic hospitals, branches, catalogs and patient links seeded; login credentials are managed separately.");
  } catch {
    console.error("Synthetic seeding failed. Use the configured local development/test database and reviewed migrations.");
    process.exitCode = 1;
  } finally {
    await closePools();
  }
}

void main();
