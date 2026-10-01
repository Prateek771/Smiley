import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function collect(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const files = [...collect("tests/unit"), ...collect("tests/integration")];
if (files.length === 0) {
  console.log("No server integration tests defined in this checkpoint yet.");
  process.exit(0);
}
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...files], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
