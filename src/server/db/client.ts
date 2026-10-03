import { existsSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as domainSchema from "./schema";
import * as authSchema from "./auth-schema";

let environmentLoaded = false;

export function loadEnvironment(): void {
  if (environmentLoaded) {
    return;
  }
  const file = path.join(process.cwd(), process.env.NODE_ENV === "test" ? ".env.test.local" : ".env.local");
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
  environmentLoaded = true;
}

loadEnvironment();

function connectionString(migration: boolean): string | undefined {
  if (process.env.NODE_ENV === "test") {
    return migration ? process.env.TEST_MIGRATION_DATABASE_URL : process.env.TEST_DATABASE_URL;
  }
  return migration ? process.env.MIGRATION_DATABASE_URL : process.env.DATABASE_URL;
}

// Pool construction is lazy; builds and public demo routes do not connect.
export const appPool = new Pool({ connectionString: connectionString(false), max: 10 });
// One worker LISTEN connection, one run lock and checkpoint/queue writes need separate connections.
export const migrationPool = new Pool({ connectionString: connectionString(true), max: 4 });
for (const pool of [appPool, migrationPool]) pool.on("error", () => console.error("An idle PostgreSQL connection failed; subsequent work will reconnect."));
export const db = drizzle(appPool, { schema: { ...domainSchema, ...authSchema } });

export async function closePools(): Promise<void> {
  await Promise.all([appPool.end(), migrationPool.end()]);
}
