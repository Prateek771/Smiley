import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { fingerprint, policyContext, usableRecords, type FinancialRecord } from "../../src/server/financial/records";

test("canonical policy dates preserve older Date-based assessments but a coverage change invalidates both", async () => {
  const current = { patient_insurance_id: "1", policy_id: "2", valid_from: "2026-01-01", valid_to: "2026-12-31", legacy_valid_from: new Date(2026, 0, 1), legacy_valid_to: new Date(2026, 11, 31) };
  const client = { query: async (_sql: string, values: string[]) => ({ rows: [{ revision_id: values[1] }] }) } as unknown as PoolClient;
  const base = { caseVersion: 1, actorId: "1", occurredAt: "2026-10-03T00:00:00Z", recordedAt: "2026-10-03T00:00:00Z" };
  for (const contextFingerprint of [policyContext(current), fingerprint(["1", "2", current.legacy_valid_from, current.legacy_valid_to])]) {
    const records: FinancialRecord[] = [{ ...base, id: "bill", kind: "bill", payload: { sourceRevisionId: "bill-source", reductionRevisionId: null } }, { ...base, id: "assessment", kind: "assess", payload: { billId: "bill", policyRevisionId: "policy-source", contextFingerprint } }];
    assert.equal((await usableRecords(client, "1", current, records)).length, 2);
    const changed = { ...current, valid_to: "2026-09-30", legacy_valid_to: new Date(2026, 8, 30) };
    assert.deepEqual((await usableRecords(client, "1", changed, records)).map((record) => record.kind), ["bill"]);
  }
});
