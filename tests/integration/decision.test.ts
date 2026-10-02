import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { closePools } from "../../src/server/db/client";
import { getFinancialCase } from "../../src/server/financial";
import { workflowFixture, syntheticBill } from "../helpers/workflow";
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
before(async () => { fixture = await workflowFixture(); }); after(closePools);
const occurredAt = "2026-10-02T10:00:00+05:30";
async function submitted() {
  const item = await fixture.newCase();
  const pack = await item.act("deskA", { type: "pack", assessmentId: item.assessment.recordId, revisionIds: Object.values(item.sources), verified: true });
  await item.act("deskA", { type: "submission", packId: pack.recordId, reference: randomUUID(), evidenceRevisionId: item.sources.preauthorization, occurredAt });
  return { ...item, pack };
}
test("payer approval, estimate, decision dispute and confirmed patient balance remain separate", async () => {
  const item = await submitted();
  const decision = await item.act("deskA", { type: "decision", packId: item.pack.recordId, status: "APPROVED", authorizedPaise: 8200000, conditions: "", reference: "APPROVAL-ONE", evidenceRevisionId: item.sources["payer-decision"], occurredAt, verified: true });
  const confirm = { type: "confirm", decisionId: decision.recordId, patientPaise: 800000, disputePaise: 300000, evidenceRevisionId: item.sources.policy, reason: "Patient amount verified; payer deduction remains disputed", verified: true };
  await assert.rejects(item.act("deskA", confirm), { status: 403 });
  await assert.rejects(item.act("billingA", { ...confirm, patientPaise: 1100000, disputePaise: 0 }), { status: 400 });
  await item.act("billingA", confirm);
  await item.act("billingA", { type: "patient-receipt", amountPaise: 500000, reference: "DEPOSIT-ONE", evidenceRevisionId: item.sources["patient-payment"], occurredAt, verified: true });
  const detail = await getFinancialCase(fixture.headers.financeA, item.caseId);
  assert.equal(detail.authorizedPaise, 8200000); assert.equal(detail.disputePaise, 300000); assert.equal(detail.patientConfirmedPaise, 800000); assert.equal(detail.collectPaise, 300000); assert.equal(detail.refundPaise, 0);
  await item.act("billingA", { type: "bill", bill: syntheticBill, sourceRevisionId: item.sources["final-bill"], reductionRevisionId: item.sources["approved-hospital-reduction"], verified: true });
  const stale = await getFinancialCase(fixture.headers.billingA, item.caseId);
  assert.equal(stale.patientConfirmedPaise, null); assert.equal(stale.collectPaise, null); assert.equal(stale.authorizedPaise, null);
});
test("conditional decisions block sign-off; actual refunds and reversals cannot exceed reconciled receipts", async () => {
  const item = await submitted();
  const decisionAction = { type: "decision", packId: item.pack.recordId, status: "CONDITIONAL", authorizedPaise: 8500000, conditions: "Await final payer approval", reference: "COND", evidenceRevisionId: item.sources["payer-decision"], occurredAt, verified: true };
  const conditional = await item.act("deskA", decisionAction);
  const confirm = { type: "confirm", decisionId: conditional.recordId, patientPaise: 800000, disputePaise: 0, evidenceRevisionId: item.sources.policy, reason: "Verified policy", verified: true };
  await assert.rejects(item.act("billingA", confirm), { status: 409 });
  const final = await item.act("deskA", { ...decisionAction, status: "APPROVED", conditions: "", reference: "FINAL" });
  await item.act("billingA", { ...confirm, decisionId: final.recordId });
  const receipt = await item.act("billingA", { type: "patient-receipt", amountPaise: 2000000, reference: "DEPOSIT", evidenceRevisionId: item.sources["patient-payment"], occurredAt, verified: true });
  assert.equal((await getFinancialCase(fixture.headers.financeA, item.caseId)).refundPaise, 1200000);
  const refund = { type: "patient-refund", amountPaise: 1200000, reference: "REFUND", evidenceRevisionId: item.sources["patient-payment"], occurredAt, verified: true };
  await assert.rejects(item.act("billingA", refund), { status: 403 });
  await assert.rejects(item.act("financeA", { ...refund, amountPaise: 1200001 }), { status: 400 });
  await item.act("financeA", refund);
  assert.equal((await getFinancialCase(fixture.headers.financeA, item.caseId)).refundPaise, 0);
  await assert.rejects(item.act("billingA", { type: "patient-reversal", receiptId: receipt.recordId, reference: "REV", evidenceRevisionId: item.sources["patient-payment"], occurredAt, verified: true }), { status: 400 });
});
