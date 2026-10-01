import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

type Credential = { email: string; password: string; branchId: string };
async function credentials(key: string): Promise<Credential> {
  const values = JSON.parse(await readFile(resolve("tmp/synthetic-auth-sehospitaldb_test.json"), "utf8")) as Record<string, Credential>;
  return values[key];
}
test("protected desk redirects an anonymous visitor to staff login", async ({ page }, testInfo) => {
  await page.goto("/desk");
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole("heading", { name: "Sign in to your hospital" })).toBeVisible();
  await mkdir("docs/evidence/phase-6", { recursive: true });
  await page.screenshot({ path: `docs/evidence/phase-6/login-${testInfo.project.name}.png`, fullPage: true });
});
test("invalid staff credentials remain on login with a useful error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("missing-staff@smiley.test");
  await page.getByLabel("Password", { exact: true }).fill("Invalid-Password-Test-Only!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sign-in failed" })).toContainText("Sign-in failed");
  await expect(page).toHaveURL(/\/login$/u);
});
test("invited staff sign in and logout invalidates protected access", async ({ page }, testInfo) => {
  const user = await credentials("deskA");
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/desk$/u);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await mkdir("docs/evidence/phase-6", { recursive: true });
  await page.screenshot({ path: `docs/evidence/phase-6/desk-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.goto("/desk");
  await expect(page).toHaveURL(/\/login$/u);
});
test("public signup cannot create a staff account", async ({ request }) => {
  const response = await request.post("/api/auth/sign-up/email", {
    data: { name: "Uninvited stranger", email: `stranger-${randomUUID()}@smiley.test`, password: "Synthetic-Test-Only-Password!" },
  });
  expect(response.status()).toBe(404);
});
test("invitation page explains a missing invitation link", async ({ page }) => {
  await page.goto("/invite");
  await expect(page.getByRole("alert").filter({ hasText: "An invitation link is required" })).toContainText("An invitation link is required");
});
test("a hospital invitation creates an account through the acceptance screen", async ({ page, context }) => {
  const administrator = await credentials("adminA");
  const desk = await credentials("deskA");
  await page.goto("/login");
  await page.getByLabel("Work email").fill(administrator.email);
  await page.getByLabel("Password", { exact: true }).fill(administrator.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/desk$/u);
  const email = `browser-invite-${randomUUID()}@smiley.test`;
  const response = await context.request.post("/api/staff/invitations", { headers: { origin: "http://127.0.0.1:3210" }, data: { email, branchId: desk.branchId, role: "INSURANCE_EXECUTIVE" } });
  expect(response.ok()).toBeTruthy();
  const result = await response.json() as { url: string };
  const token = new URL(result.url).searchParams.get("token");
  await page.goto(`/invite?token=${token}`);
  await page.getByLabel("Your name").fill("Synthetic browser colleague");
  await page.getByLabel("Choose a password").fill("Synthetic-Browser-Test-Only!42");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Your staff account is ready");
});
