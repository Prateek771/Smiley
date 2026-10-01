import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createDraft, signIn } from "./helpers";

test("staff upload private revisions, pin a source note and retain original downloads", async ({ page }) => {
  // This journey includes cold route compilation, two uploads, and three staff logins.
  test.setTimeout(60_000);
  const user = await signIn(page); const id = await createDraft(page, user);
  const upload = page.getByRole("region", { name: "Upload private document", exact: true });
  await upload.getByLabel("Document file").setInputFiles({ name: "fictional-discharge.txt", mimeType: "text/plain", buffer: Buffer.from("Fictional original discharge note") });
  const [firstUpload] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/cases/${id}/documents`) && response.request().method() === "POST"),
    upload.getByRole("button", { name: "Upload private document", exact: true }).click(),
  ]);
  expect(firstUpload.status()).toBe(201);
  await expect(page.getByRole("link", { name: "Download fictional-discharge.txt revision 1" })).toBeVisible();
  const data = await (await page.request.get(`/api/cases/${id}/documents`)).json() as { revisions: { id: string; documentId: string }[] };
  const first = data.revisions[0];
  const note = page.getByRole("region", { name: "Record source note" });
  await note.getByLabel("Source revision").selectOption(first.id);
  await note.getByLabel("Field or topic").fill("Discharge date");
  await note.getByLabel("Page number (optional)").fill("1");
  await note.getByLabel("Source excerpt").fill("Fictional date needs staff verification.");
  const [savedSource] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/cases/${id}/evidence`) && response.request().method() === "POST"),
    note.getByRole("button", { name: "Save source note" }).click(),
  ]);
  expect(savedSource.status()).toBe(200);
  await expect(page.getByRole("region", { name: "Private documents", exact: true })).toContainText("manual source note, unverified");
  await upload.getByLabel("Existing document").selectOption(first.documentId);
  await upload.getByLabel("Document file").setInputFiles({ name: "fictional-discharge.txt", mimeType: "text/plain", buffer: Buffer.from("Fictional revised discharge note") });
  const [secondUpload] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/cases/${id}/documents`) && response.request().method() === "POST"),
    upload.getByRole("button", { name: "Upload private document", exact: true }).click(),
  ]);
  expect(secondUpload.status()).toBe(201);
  await expect(page.getByRole("link", { name: "Download fictional-discharge.txt revision 2" })).toBeVisible();
  const original = await page.request.get(`/api/documents/${first.id}/download`);
  expect(original.status()).toBe(200); expect((await original.body()).toString()).toBe("Fictional original discharge note");
  expect(original.headers()["content-disposition"]).toContain("attachment;");
  expect(original.headers()["cache-control"]).toBe("no-store"); expect(original.headers()["x-content-type-options"]).toBe("nosniff");
  await page.reload();
  await expect(page.getByRole("link", { name: "Download fictional-discharge.txt revision 1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Private documents", exact: true })).toContainText("Fictional date needs staff verification.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("tmp/browser", { recursive: true });
  await page.screenshot({ path: `tmp/browser/phase-10-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);
  expect((await page.request.get(`/api/documents/${first.id}/download`)).status()).toBe(401);
  await signIn(page, "deskB");
  expect((await page.request.get(`/api/documents/${first.id}/download`)).status()).toBe(404);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await signIn(page, "billingA"); await page.goto(`/desk/cases/${id}`);
  await expect(page.getByRole("region", { name: "Upload private document", exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/documents/${first.id}/download`)).status()).toBe(200);
});
test("upload API rejects invalid content, oversized files, forged fields and missing origin", async ({ page }) => {
  const user = await signIn(page); const id = await createDraft(page, user);
  const endpoint = `/api/cases/${id}/documents`;
  const headers = { origin: new URL(page.url()).origin };
  const parts = () => ({ file: { name: "fictional.txt", mimeType: "text/plain", buffer: Buffer.from("Fictional plain note") }, documentType: "NOTE", idempotencyKey: randomUUID() });
  expect((await page.request.post(endpoint, { headers, multipart: { ...parts(), file: { name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("<script>alert(1)</script>") } } })).status()).toBe(415);
  expect((await page.request.post(endpoint, { headers, multipart: { ...parts(), file: { name: "large.txt", mimeType: "text/plain", buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 65) } } })).status()).toBe(413);
  expect((await page.request.post(endpoint, { headers, multipart: { ...parts(), hospitalId: "999" } })).status()).toBe(400);
  expect((await page.request.post(endpoint, { multipart: parts() })).status()).toBe(403);
  const listing = await (await page.request.get(`/api/cases/${id}/documents`)).json() as { revisions: unknown[] };
  expect(listing.revisions).toHaveLength(0);
  for (const malformed of ["abc", "1.2"]) {
    expect((await page.request.get(`/api/cases/${malformed}/documents`)).status()).toBe(400);
    expect((await page.request.post(`/api/cases/${malformed}/documents`, { headers, multipart: parts() })).status()).toBe(400);
    expect((await page.request.post(endpoint, { headers, multipart: { ...parts(), documentId: malformed } })).status()).toBe(400);
  }
});

test("upload retry preserves an acknowledged file and accepts changed bytes with matching metadata", async ({ page }) => {
  const user = await signIn(page); const id = await createDraft(page, user);
  const upload = page.getByRole("region", { name: "Upload private document", exact: true });
  const setFile = async (content: string) => upload.getByLabel("Document file").evaluate((element, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "same-metadata.txt", { type: "text/plain", lastModified: 1700000000000 }));
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, content);
  const endpoint = `**/api/cases/${id}/documents`;
  await setFile("Fictional original note A");
  await page.route(endpoint, async (route) => {
    const response = await route.fetch(); expect(response.status()).toBe(201);
    await route.abort("failed");
  }, { times: 1 });
  await upload.getByRole("button", { name: "Upload private document", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Connection interrupted");
  await upload.getByRole("button", { name: "Upload private document", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download same-metadata.txt revision 1" })).toBeVisible();
  let listing = await (await page.request.get(`/api/cases/${id}/documents`)).json() as { revisions: { id: string }[] };
  expect(listing.revisions).toHaveLength(1);
  await setFile("Fictional revised note B!");
  await page.route(endpoint, async (route) => {
    const response = await route.fetch(); expect(response.status()).toBe(201);
    await route.abort("failed");
  }, { times: 1 });
  await upload.getByRole("button", { name: "Upload private document", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Connection interrupted");
  await setFile("Fictional revised note C!");
  await upload.getByRole("button", { name: "Upload private document", exact: true }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("Private document saved");
  listing = await (await page.request.get(`/api/cases/${id}/documents`)).json() as { revisions: { id: string }[] };
  expect(listing.revisions).toHaveLength(3);
  const downloaded = await Promise.all(listing.revisions.map(async (revision) => (await (await page.request.get(`/api/documents/${revision.id}/download`)).body()).toString()));
  expect(downloaded).toEqual(expect.arrayContaining(["Fictional original note A", "Fictional revised note B!", "Fictional revised note C!"]));
});
