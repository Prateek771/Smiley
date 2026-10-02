import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrationPool } from "../../src/server/db/client";
import { seedSynthetic } from "../../src/server/db/seed";
import { auth } from "../../src/server/auth";
import { seedAuthUsers } from "../../src/server/auth/seed";
import { createCase, getCase, getDeskData } from "../../src/server/cases";
import { uploadDocument } from "../../src/server/documents";
import { applyFinancialAction } from "../../src/server/financial";

export const syntheticBill = { serviceDate: "2026-10-02", lines: [{ description: "Synthetic treatment", grossPaise: 10000000, excludedPaise: 800000, reductionPaise: 700000 }] };
export const syntheticRule = { version: "SYN-DISCHARGE-1", validFrom: "2026-01-01", validTo: "2026-12-31", deductiblePaise: 0, copayBps: 0, benefitLimitPaise: 20000000, tariffCapsPaise: [] };
export async function workflowFixture() {
  assert.match((await migrationPool.query("SELECT current_database() AS name")).rows[0].name, /_test$/u);
  await seedSynthetic(); const users = await seedAuthUsers(); const headers = {} as Record<keyof typeof users, Headers>;
  for (const key of ["deskA", "billingA", "financeA", "deskB", "deskNorthA", "auditorA"] as const) {
    const response = await auth.api.signInEmail({ body: { email: users[key].email, password: users[key].password }, asResponse: true });
    assert.equal(response.status, 200); headers[key] = new Headers({ cookie: response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ") });
  }
  async function newCase() {
    const data = await getDeskData(headers.deskA); const encounter = data.encounters.find((entry) => entry.branchId === users.deskA.branchId)!;
    const membership = data.memberships.find((entry) => entry.patientId === encounter.patientId)!;
    await migrationPool.query("UPDATE patient_insurance SET valid_from='2026-01-01',valid_to='2026-12-31' WHERE patient_insurance_id=$1", [membership.id]);
    const caseId = (await createCase(headers.deskA, { branchId: encounter.branchId, patientId: encounter.patientId, patientInsuranceId: membership.id, encounterId: encounter.id, ownerId: users.deskA.userId, nextAction: "Review synthetic discharge", creationKey: randomUUID() })).id;
    const sources: Record<string, string> = {};
    for (const type of ["final-bill", "approved-hospital-reduction", "policy", "preauthorization", "discharge-summary", "payer-decision", "patient-payment", "bank-remittance"]) {
      sources[type] = (await uploadDocument(headers.deskA, caseId, { bytes: Buffer.from(`Fictional reviewed ${type} evidence`), name: `${type}.txt`, mimeType: "text/plain", documentType: type, idempotencyKey: randomUUID() })).revisionId;
    }
    async function act(key: keyof typeof users, action: unknown, idempotencyKey = randomUUID(), expectedVersion?: number) {
      return applyFinancialAction(headers[key], caseId, { expectedVersion: expectedVersion ?? (await getCase(headers.deskA, caseId)).version, idempotencyKey, action });
    }
    const bill = await act("billingA", { type: "bill", bill: syntheticBill, sourceRevisionId: sources["final-bill"], reductionRevisionId: sources["approved-hospital-reduction"], verified: true });
    const assessment = await act("billingA", { type: "assess", billId: bill.recordId, rule: syntheticRule, policyRevisionId: sources.policy, verified: true });
    return { caseId, sources, bill, assessment, act };
  }
  return { users, headers, newCase };
}
