import { defineConfig, devices } from "@playwright/test";

const port = 3210;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 2,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL ?? "",
      BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
      PRIVATE_STORAGE_DIR: "./tmp/private-storage-test",
    },
    timeout: 120_000,
  },
});
