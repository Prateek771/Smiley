import { migrationPool } from "../../src/server/db/client";
import { executeJob, startRegisteredWorker } from "../../src/worker/tasks";
async function main() {
  if (process.env.NODE_ENV !== "test" || !(await migrationPool.query("SELECT current_database() AS name")).rows[0].name.endsWith("_test")) throw new Error("Crash fixture is restricted to the isolated test database.");
  const worker = startRegisteredWorker({ noHandleSignals: true, concurrency: 1, pollInterval: 100, preset: { worker: { localQueue: { size: 2 } } } }, { "pack-review": async (payload, helpers) => {
    const id = (payload as { requestId: string }).requestId;
    await executeJob(id, async () => { process.send?.({ entered: id }); return new Promise(() => {}); }, helpers.job);
  } });
  await worker.promise;
}
void main();
