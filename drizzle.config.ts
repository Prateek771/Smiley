import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";

const envFile = process.env.NODE_ENV === "test" ? ".env.test.local" : ".env.local";
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  schema: ["./src/server/db/schema.ts", "./src/server/db/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? "" },
  strict: true,
});
