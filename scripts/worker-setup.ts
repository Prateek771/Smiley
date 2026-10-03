async function main() {
  if (process.argv.includes("--test")) process.env.NODE_ENV = "test";
  const { migrationPool, closePools } = await import("../src/server/db/client");
  const { runMigrations } = await import("graphile-worker");
  const { setupAICheckpoints } = await import("../src/worker/checkpoints");
  try {
    await runMigrations({ pgPool: migrationPool });
    await migrationPool.query("REVOKE ALL ON SCHEMA graphile_worker FROM PUBLIC,smiley_app; REVOKE ALL ON ALL TABLES IN SCHEMA graphile_worker FROM PUBLIC,smiley_app; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA graphile_worker FROM PUBLIC,smiley_app");
    await setupAICheckpoints();
    console.log("Pinned private queue and AI checkpoints installed; application access uses scoped enqueue functions.");
  } catch { console.error("Queue setup failed. Check the migration connection and reviewed queue version."); process.exitCode = 1; }
  finally { await closePools(); }
}
void main();
