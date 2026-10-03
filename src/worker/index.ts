import { closePools, migrationPool } from "../server/db/client";
import { startRegisteredWorker, recoverStoppedWorkers } from "./tasks";
import { verifyAICheckpoints } from "./checkpoints";
async function main() {
  try {
    const schema = await migrationPool.query("SELECT max(id) AS version FROM graphile_worker.migrations");
    if (schema.rows[0].version !== 20) throw new Error("Run the explicit pinned queue setup before starting the worker.");
    await verifyAICheckpoints();
    await recoverStoppedWorkers();
    const worker = startRegisteredWorker({ concurrency: 1, pollInterval: 1000 });
    console.log("Smiley persistent pack and AI review worker running."); await worker.promise;
  } catch { console.error("Worker stopped. Check native PostgreSQL and run worker:setup for the pinned queue schema."); process.exitCode = 1; }
  finally { await closePools(); }
}
void main();
