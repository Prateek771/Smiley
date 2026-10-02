import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");
const origin = "http://127.0.0.1:3216";
if (!process.env.TEST_DATABASE_URL || !/_test$/u.test(new URL(process.env.TEST_DATABASE_URL).pathname)) throw new Error("HTTP review requires an explicit isolated test database.");
async function command(args, env = process.env) { const child = spawn(process.execPath, args, { stdio: "inherit", env }); await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Verification command exited ${code}`))); }); }
if (process.env.HTTP_SKIP_BUILD !== "1") await command(["node_modules/next/dist/bin/next", "build"]);
const environment = { ...process.env, NODE_ENV: "production", DATABASE_URL: process.env.TEST_DATABASE_URL, MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL, BETTER_AUTH_URL: origin };
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3216"], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.resume(); server.stderr.resume();
try {
  let ready = false; for (let i = 0; i < 200; i++) { if (server.exitCode !== null) throw new Error("Isolated HTTP server exited before startup."); try { ready = (await fetch(`${origin}/login`)).ok; } catch {} if (ready) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  if (!ready) throw new Error("Isolated HTTP server did not become ready.");
  await command(["--import", "tsx", "--test", "tests/http/staff.test.ts"], { ...process.env, NODE_ENV: "test", BETTER_AUTH_URL: origin, HTTP_TEST_ORIGIN: origin });
} finally { server.kill("SIGTERM"); await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once("exit", resolve); }); }
