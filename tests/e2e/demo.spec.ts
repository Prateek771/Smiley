import { expect, test } from "./fixtures";

test("queue search and ownership filter survive case navigation and reload", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByText("Synthetic demo", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("article", { name: /P2-/ })).toHaveCount(5);
  await page.getByRole("searchbox", { name: "Search cases" }).fill("query");
  await page.getByRole("combobox", { name: "Work filter" }).selectOption("queries");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/q=query.*filter=queries/);
  await expect(page.getByRole("article", { name: /P2-/ })).toHaveCount(1);
  await page.getByRole("link", { name: "Open case P2-03" }).click();
  await expect(page.getByRole("heading", { name: "Repeated payer queries" })).toBeVisible();
  await page.getByRole("link", { name: "Back to work queue" }).click();
  await expect(page).toHaveURL(/\/demo\?q=query&filter=queries&role=Desk$/);
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search cases" })).toHaveValue("query");
  await expect(page.getByRole("combobox", { name: "Work filter" })).toHaveValue("queries");
  await expect(page.getByRole("article", { name: /P2-/ })).toHaveCount(1);
});

test("authorization, patient amount, dispute and actual receipts remain separate", async ({ page }) => {
  await page.goto("/demo/cases/P2-05");
  await expect(page.getByRole("region", { name: "Estimated insurer amount" })).toContainText("₹85,000");
  await expect(page.getByRole("region", { name: "Payer authorization" })).toContainText("₹82,000");
  await expect(page.getByRole("region", { name: "Confirmed patient share" })).toContainText("₹8,000");
  await expect(page.getByRole("region", { name: "Open decision dispute" })).toContainText("₹3,000");
  await expect(page.getByRole("region", { name: "Matched payer receipts" })).toContainText("₹80,000");
  await expect(page.getByRole("region", { name: "Billing reconciliation" })).toContainText("₹3,000");
  await expect(page.getByRole("region", { name: "Finance follow-up" })).toContainText("₹2,000");
  await expect(page.getByText("Whole case remains open", { exact: true })).toBeVisible();
});

test("unknown money is needs review while verified deposit remains visible", async ({ page }) => {
  await page.goto("/demo/cases/P2-02?checkpoint=P2-02-blocked");
  for (const name of ["Estimated insurer amount", "Payer authorization", "Confirmed patient share", "Open decision dispute"]) {
    const fact = page.getByRole("region", { name, exact: true });
    await expect(fact).toContainText("Needs review");
    await expect(fact).not.toContainText("₹0");
  }
  await expect(page.getByRole("region", { name: "Billing reconciliation" })).toContainText("₹20,000");
  await expect(page.getByRole("region", { name: "Review blockers" })).toContainText("Missing discharge summary");
  await expect(page.getByRole("region", { name: "Available evidence" })).not.toContainText("P2-02-summary-v1");
  await expect(page.getByRole("region", { name: "Available evidence" })).not.toContainText("P2-02-authorization-v1");
});

test("checkpoint excludes future authorization, queries and response acknowledgements", async ({ page }) => {
  await page.goto("/demo/cases/P2-03?checkpoint=P2-03-query-1");
  await expect(page.getByRole("region", { name: "Payer authorization", exact: true })).toContainText("Needs review");
  await expect(page.getByRole("region", { name: "Current payer queries" })).toContainText("SYN-QUERY-03-1");
  await expect(page.getByRole("region", { name: "Current payer queries" })).toContainText("Awaiting acknowledged response");
  await expect(page.getByRole("region", { name: "Current payer queries" })).not.toContainText("SYN-QUERY-03-2");
  await expect(page.getByRole("region", { name: "Current payer queries" })).not.toContainText("SYN-RESPONSE-03-1");
  await expect(page.getByRole("region", { name: "Available evidence" })).not.toContainText("P2-03-authorization-v1");
  await expect(page.getByRole("region", { name: "Case timeline" })).not.toContainText("Final payer decision");
  await page.getByRole("combobox", { name: "Timeline checkpoint" }).selectOption("P2-03-query-2");
  await page.getByRole("button", { name: "View checkpoint" }).click();
  await expect(page.getByRole("region", { name: "Current payer queries" })).toContainText("SYN-QUERY-03-2");
  await expect(page.getByRole("region", { name: "Current payer queries" })).toContainText("SYN-RESPONSE-03-1");
  await expect(page.getByRole("region", { name: "Current payer queries" })).not.toContainText("SYN-RESPONSE-03-2");
});

test("role preview is explicit and changes next action without granting access", async ({ page }) => {
  await page.goto("/demo/cases/P2-01?role=Finance");
  await expect(page.getByText("Role preview only · no permissions are granted", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Demo role preview" })).toHaveValue("Finance");
  await expect(page.getByRole("region", { name: "Owner and next action" })).toContainText("Finance");
  await expect(page.getByRole("region", { name: "Owner and next action" })).toContainText("Await and reconcile");
});

for (const view of ["empty", "error", "loading"]) {
  test(`${view} state has accessible recovery to the synthetic queue`, async ({ page }) => {
    await page.goto(`/demo?view=${view}&role=Billing`);
    const name = view === "empty" ? "No cases to show" : view === "error" ? "The demo queue could not load" : "Loading demo cases";
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("link", { name: "Return to demo queue" }).click();
    await expect(page.getByRole("article", { name: /P2-/ })).toHaveCount(5);
    await expect(page.getByRole("combobox", { name: "Demo role preview" })).toHaveValue("Billing");
  });
}

test("unmatched search can be cleared and screen fits the viewport", async ({ page }) => {
  await page.goto("/demo?q=no-such-case");
  await expect(page.getByRole("heading", { name: "No matching cases" })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("article", { name: /P2-/ })).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Open case P2-03" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

