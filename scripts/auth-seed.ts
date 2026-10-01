const testDatabase = process.argv.includes("--test");
if (process.argv.slice(2).some((argument) => argument !== "--test")) {
  throw new Error("Use auth-seed with no arguments or --test.");
}
if (testDatabase) process.env.NODE_ENV = "test";

async function main(): Promise<void> {
  const { closePools } = await import("../src/server/db/client");
  try {
    const { seedAuthUsers } = await import("../src/server/auth/seed");
    await seedAuthUsers();
    console.log("Synthetic staff identities provisioned; credentials are saved only in the ignored local fixture file.");
  } catch {
    console.error("Synthetic authentication seeding failed. Check the explicit local database configuration and reviewed migrations.");
    process.exitCode = 1;
  } finally {
    await closePools();
  }
}

void main();
