import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { migrationPool } from "../server/db/client";

export const checkpoints = new PostgresSaver(migrationPool, undefined, { schema: "smiley_langgraph" });
export async function setupAICheckpoints() {
  await checkpoints.setup();
  await migrationPool.query("REVOKE ALL ON SCHEMA smiley_langgraph FROM PUBLIC,smiley_app; REVOKE ALL ON ALL TABLES IN SCHEMA smiley_langgraph FROM PUBLIC,smiley_app; REVOKE ALL ON ALL SEQUENCES IN SCHEMA smiley_langgraph FROM PUBLIC,smiley_app; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA smiley_langgraph FROM PUBLIC,smiley_app");
}
export async function verifyAICheckpoints() {
  const state = await migrationPool.query("SELECT max(v) AS version FROM smiley_langgraph.checkpoint_migrations");
  if (state.rows[0].version !== 4) throw new Error("Run worker:setup for the pinned private AI checkpoint schema.");
}
