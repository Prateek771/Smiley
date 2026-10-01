import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export type Credential = { email: string; password: string; branchId: string; userId: string };
export async function signIn(page: Page, key = "deskA") {
  const users = JSON.parse(await readFile(resolve("tmp/synthetic-auth-sehospitaldb_test.json"), "utf8")) as Record<string, Credential>;
  const user = users[key];
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/desk$/u);
  // App Router can update the URL while its scoped server data is still streaming.
  await expect(page.getByRole("heading", { name: "Hospital work queue" })).toBeVisible({ timeout: 15_000 });
  return user;
}
export async function createDraft(page: Page, user: Credential) {
  const encounters = (await (await page.request.get("/api/encounters")).json()).encounters as { id: string; branchId: string; patientId: string; encounterNo: string }[];
  const memberships = (await (await page.request.get("/api/memberships")).json()).memberships as { id: string; patientId: string; policyNumber: string }[];
  // Fixed seed records keep parallel journeys from adopting another test's newly registered patient.
  const encounter = encounters.find((row) => row.branchId === user.branchId && row.encounterNo.startsWith("SYN-ENC-"));
  expect(encounter).toBeTruthy();
  const membership = memberships.find((row) => row.patientId === encounter!.patientId && row.policyNumber.startsWith("SYN-"));
  expect(membership).toBeTruthy();
  const response = await page.request.post("/api/cases", { headers: { origin: new URL(page.url()).origin }, data: {
    branchId: user.branchId, patientId: encounter!.patientId, encounterId: encounter!.id,
    patientInsuranceId: membership!.id, ownerId: user.userId, nextAction: "Review synthetic source evidence", creationKey: randomUUID(),
  } });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: string };
  await page.goto(`/desk/cases/${id}`);
  return id;
}
