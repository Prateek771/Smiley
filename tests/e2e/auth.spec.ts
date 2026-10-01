import { expect, test } from "./fixtures";
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
  await mkdir("tmp/browser/auth", { recursive: true });
  await page.screenshot({ path: `tmp/browser/auth/login-${testInfo.project.name}.png`, fullPage: true });
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
  await mkdir("tmp/browser/auth", { recursive: true });
  // The queue may contain 500 cards; capture the staff viewport, not a huge full-page image.
  await page.screenshot({ path: `tmp/browser/auth/desk-${testInfo.project.name}.png`, fullPage: false });
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

test.describe("login before hydration", () => {
  test.use({ javaScriptEnabled: false });

  test("login controls stay disabled without JavaScript and never submit credential GET fields", async ({ page }) => {
    const nativeCredentialGets: string[][] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/login" && (url.searchParams.has("email") || url.searchParams.has("password"))) {
        // Capture field names only; never print values or a raw credential-bearing URL.
        nativeCredentialGets.push([...url.searchParams.keys()]);
      }
    });
    await page.goto("/login");
    const email = page.getByLabel("Work email");
    const password = page.getByLabel("Password", { exact: true });
    const submit = page.getByRole("button", { name: "Sign in", exact: true });
    // Exercise the unsafe SSR fallback if it is exposed; these are deliberately invalid sentinel values.
    if (await email.isEnabled() && await password.isEnabled()) {
      await email.fill("fictional-no-js@smiley.test");
      await password.fill("Fictional-Only-Not-A-Real-Credential!");
    }
    await submit.click({ force: true });
    expect(nativeCredentialGets, "An unhydrated form must not send credential fields in a native GET").toEqual([]);
    await expect(email).toBeDisabled();
    await expect(password).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(page.locator("form").filter({ has: email })).toHaveAttribute("method", "post");
    expect([...new URL(page.url()).searchParams.keys()]).toEqual([]);
  });
});
