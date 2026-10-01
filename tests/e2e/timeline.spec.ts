import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createDraft, signIn } from "./helpers";

test("staff edit preparation and record two query cycles with persistent history", async ({ page }) => {
  // Six persisted actions plus navigation/reload form one bounded end-to-end journey.
  test.setTimeout(60_000);
  const user = await signIn(page); await createDraft(page, user);
  const edit = page.getByRole("region", { name: "Edit preparation" });
  await edit.getByLabel("Next action").fill("Verify the fictional discharge date.");
  await edit.getByRole("button", { name: "Save preparation" }).click();
  await expect(page.getByRole("region", { name: "Owner and next action" })).toContainText("Verify the fictional discharge date.");
  const status = page.getByRole("region", { name: "Preparation status" });
  await status.getByLabel("Reason for status change").fill("Sources ready for review");
  await status.getByRole("button", { name: "Mark ready for preparation" }).click();
  await expect(page.getByRole("button", { name: "Start preparation" })).toBeVisible();
  await status.getByLabel("Reason for status change").fill("Review started by staff");
  await status.getByRole("button", { name: "Start preparation" }).click();
  const query = page.getByRole("region", { name: "Record payer query" });
  for (const reference of ["Synthetic query one", "Synthetic query two"]) {
    await query.getByLabel("Payer query reference").fill(reference);
    await query.getByLabel("Query text").fill(`Please review ${reference}`);
    await query.getByRole("button", { name: "Record query" }).click();
    await expect(page.getByRole("region", { name: "Recorded queries" })).toContainText(reference);
  }
  const response = page.getByRole("region", { name: "Prepare query response" });
  await response.getByLabel("Recorded query").selectOption("Synthetic query one");
  await response.getByLabel("Prepared response").fill("Fictional response requires staff review before external submission.");
  await response.getByRole("button", { name: "Save prepared response" }).click();
  await expect(page.getByRole("region", { name: "Recorded queries" })).toContainText("Response prepared locally");
  await page.reload();
  await expect(page.getByRole("region", { name: "Case history" })).toContainText("Verify the fictional discharge date.");
  await expect(page.getByRole("region", { name: "Case history" })).toContainText("Fictional response requires staff review");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("tmp/browser", { recursive: true });
  await page.screenshot({ path: `tmp/browser/phase-9-${test.info().project.name}.png`, fullPage: true });
});
test("billing can review a case but cannot post preparation actions or payer approval", async ({ page }) => {
  const user = await signIn(page); const id = await createDraft(page, user);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, "billingA"); await page.goto(`/desk/cases/${id}`);
  await expect(page.getByRole("region", { name: "Edit preparation" })).toHaveCount(0);
  const result = await page.request.post(`/api/cases/${id}/actions`, { headers: { origin: new URL(page.url()).origin }, data: {
    expectedVersion: 1, idempotencyKey: randomUUID(), action: { type: "status", status: "PENDING", reason: "Forbidden billing action" },
  } });
  expect(result.status()).toBe(403);
});

test("a stale tab reloads all preparation fields before another save", async ({ page, context }) => {
  test.setTimeout(60_000);
  const user = await signIn(page); const id = await createDraft(page, user);
  const stale = await context.newPage(); await stale.goto(`/desk/cases/${id}`);
  const first = page.getByRole("region", { name: "Edit preparation" });
  const second = stale.getByRole("region", { name: "Edit preparation" });
  const initialOwner = await first.getByLabel("Case owner").inputValue();
  const owner = await first.getByLabel("Case owner").locator("option").evaluateAll((options, current) => options.map((option) => (option as HTMLOptionElement).value).find((value) => value && value !== current), initialOwner);
  expect(owner).toBeTruthy();
  await first.getByLabel("Case owner").selectOption(owner!);
  await first.getByLabel("Next action").fill("Latest officer instruction");
  await first.getByLabel("Due date and time (IST)").fill("2026-11-01T10:15");
  await first.getByRole("button", { name: "Save preparation" }).click();
  await expect(page.getByRole("region", { name: "Owner and next action" })).toContainText("Latest officer instruction");
  await second.getByLabel("Next action").fill("Outdated tab instruction");
  await second.getByRole("button", { name: "Save preparation" }).click();
  await expect(stale.getByRole("main").getByRole("alert")).toContainText("The case changed");
  // The conflict response arrives before the streamed refresh commits its authoritative fields.
  await expect(stale.getByRole("main").getByText(/^DRAFT · .+ · version 2$/u)).toBeVisible({ timeout: 15_000 });
  await expect(second.getByLabel("Next action")).toHaveValue("Latest officer instruction");
  await expect(second.getByLabel("Due date and time (IST)")).toHaveValue("2026-11-01T10:15");
  await expect(second.getByLabel("Case owner")).toHaveValue(owner!);
  await second.getByLabel("Next action").fill("Reviewed second officer instruction");
  await second.getByRole("button", { name: "Save preparation" }).click();
  await expect(stale.getByRole("region", { name: "Owner and next action" })).toContainText("Reviewed second officer instruction");
  await stale.reload();
  await expect(second.getByLabel("Due date and time (IST)")).toHaveValue("2026-11-01T10:15");
  await stale.close();
});

test("malformed case and owner IDs return HTTP 400", async ({ page }) => {
  const user = await signIn(page); const id = await createDraft(page, user);
  const headers = { origin: new URL(page.url()).origin };
  const action = { type: "edit", ownerId: user.userId, nextAction: "Malformed ID probe", dueAt: null };
  for (const malformed of ["abc", "1.2"]) {
    expect((await page.request.get(`/api/cases/${malformed}/actions`)).status()).toBe(400);
    expect((await page.request.post(`/api/cases/${malformed}/actions`, { headers, data: { expectedVersion: 1, idempotencyKey: randomUUID(), action } })).status()).toBe(400);
    expect((await page.request.post(`/api/cases/${id}/actions`, { headers, data: { expectedVersion: 1, idempotencyKey: randomUUID(), action: { ...action, ownerId: malformed } } })).status()).toBe(400);
  }
});
