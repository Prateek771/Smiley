import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("production sign-in throttles the fourth attempt from one synthetic client", async ({ request, page }) => {
  const credentials = {
    email: `unknown-rate-client-${randomUUID()}@smiley.test`,
    password: "Synthetic-Unknown-Client-Password!42",
  };
  const options = { headers: { origin: "http://127.0.0.1:3210" }, data: credentials };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.post("/api/auth/sign-in/email", options);
    expect(response.status()).toBe(401);
  }
  // The browser context's request shares this test client's forwarded address.
  const limited = await page.request.post("/api/auth/sign-in/email", options);
  expect(limited.status()).toBe(429);
  const retryAfter = limited.headers()["x-retry-after"];
  expect(retryAfter).toMatch(/^\d+$/u);
  expect(Number(retryAfter)).toBeGreaterThan(0);
  expect(Number(retryAfter)).toBeLessThanOrEqual(10);
});
