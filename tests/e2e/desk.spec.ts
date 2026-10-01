import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

type Credential = { email: string; password: string; branchId: string; userId: string };
async function credential(key: string): Promise<Credential> {
  return (JSON.parse(await readFile(resolve("tmp/synthetic-auth-sehospitaldb_test.json"), "utf8")) as Record<string, Credential>)[key];
}
async function signIn(page: import("@playwright/test").Page, key = "deskA") {
  const user = await credential(key);
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/desk$/u);
  return user;
}

test("protected registration creates linked records and a durable queue case", async ({ page }) => {
  const user = await signIn(page);
  const code = `UI-${randomUUID()}`;
  await page.getByRole("link", { name: "Register a case" }).click();
  await expect(page.getByRole("heading", { name: "Register a discharge case" })).toBeVisible();
  const patient = page.getByRole("region", { name: "Patient registration" });
  await patient.getByLabel("Patient code").fill(code);
  await patient.getByLabel("First name").fill("Fictional");
  await patient.getByLabel("Last name").fill("BrowserPatient");
  await patient.getByRole("button", { name: "Register patient" }).click();
  await expect(page.getByRole("status")).toContainText("Patient registered");
  const membership = page.getByRole("region", { name: "Insurance membership" });
  await membership.getByRole("combobox", { name: "Policy", exact: true }).selectOption({ index: 1 });
  await expect(membership.getByRole("region", { name: "Selected policy context" })).toContainText("Insurer");
  await expect(membership.getByRole("region", { name: "Selected policy context" })).toContainText("Category");
  await membership.getByLabel("Policy number").fill(`POL-${code}`);
  await membership.getByLabel("Valid from").fill("2026-01-01");
  await membership.getByLabel("Valid to").fill("2026-12-31");
  await membership.getByRole("button", { name: "Add membership" }).click();
  await expect(page.getByRole("status")).toContainText("Insurance membership added");
  const encounter = page.getByRole("region", { name: "Encounter registration" });
  await encounter.getByLabel("Branch").selectOption(user.branchId);
  await encounter.getByLabel("Encounter type").selectOption("IPD");
  await encounter.getByLabel("Admission date and time (IST)").fill("2026-10-01T10:00");
  await encounter.getByRole("button", { name: "Register encounter" }).click();
  await expect(page.getByRole("status")).toContainText("Encounter registered");
  const caseForm = page.getByRole("region", { name: "Create discharge case" });
  await caseForm.getByLabel("Case branch").selectOption(user.branchId);
  await caseForm.getByLabel("Insurance membership").selectOption({ index: 1 });
  await caseForm.getByLabel("Encounter").selectOption({ index: 1 });
  await caseForm.getByLabel("Case owner").selectOption(user.userId);
  await caseForm.getByLabel("Next action").fill("Review the fictional final bill.");
  await caseForm.getByRole("button", { name: "Create case" }).click();
  await expect(page).toHaveURL(/\/desk\/cases\/[0-9]+$/u);
  await expect(page.getByRole("region", { name: "Linked registration" })).toContainText(code);
  await expect(page.getByRole("region", { name: "Owner and next action" })).toContainText("Review the fictional final bill.");
  await expect(page.getByRole("region", { name: "Financial review" })).toContainText("Needs review");
  const caseUrl = page.url();
  await page.reload();
  await expect(page.getByRole("region", { name: "Linked registration" })).toContainText(code);
  await page.getByRole("link", { name: "Back to work queue" }).click();
  await page.getByRole("searchbox", { name: "Search persisted cases" }).fill(code);
  await page.getByRole("button", { name: "Apply queue filters" }).click();
  await expect(page.getByRole("article", { name: /Case / })).toHaveCount(1);
  await page.getByRole("link", { name: /Open case / }).click();
  await expect(page).toHaveURL((url) => url.pathname === new URL(caseUrl).pathname);
  await page.getByRole("link", { name: "Back to work queue" }).click();
  await expect(page.getByRole("searchbox", { name: "Search persisted cases" })).toHaveValue(code);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("a read-only staff member sees persisted work without creation or role preview controls", async ({ page }) => {
  await signIn(page, "billingA");
  await expect(page.getByRole("heading", { name: "Hospital work queue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register a case" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Demo role preview" })).toHaveCount(0);
  await page.goto("/desk/new");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Registration is not permitted");
});
test("branch options offer only the signed-in staff member's assigned branch", async ({ page }) => {
  const user = await signIn(page);
  await page.goto("/desk/new");
  await page.getByRole("combobox", { name: "Existing patient", exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Use selected patient" }).click();
  const selector = page.getByRole("region", { name: "Encounter registration" }).getByRole("combobox", { name: "Branch", exact: true });
  await expect(selector.locator("option[value]:not([value=''])")).toHaveCount(1);
  await expect(selector.locator(`option[value='${user.branchId}']`)).toHaveCount(1);
});

test("malformed case API IDs return400 without exposing server errors", async ({ page }) => {
  await signIn(page);
  for (const invalid of ["abc", "1.2", "9223372036854775808"]) {
    const detail = await page.request.get("/api/cases/" + invalid);
    expect(detail.status()).toBe(400);
    const body = { branchId: "1", patientId: "1", patientInsuranceId: "1", encounterId: "1", ownerId: "1", nextAction: "Invalid ID regression", creationKey: randomUUID() };
    for (const field of ["branchId", "patientId", "patientInsuranceId", "encounterId", "ownerId"]) {
      const response = await page.request.post("/api/cases", { data: { ...body, [field]: invalid }, headers: { origin: new URL(page.url()).origin } });
      expect(response.status()).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("SyntaxError");
    }
  }
});
