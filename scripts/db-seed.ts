import { seedSynthetic } from "../src/server/db/seed";
import { closePools } from "../src/server/db/client";

async function main(): Promise<void> {
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
