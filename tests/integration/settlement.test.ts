import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { closePools } from "../../src/server/db/client";
import { getFinancialCase } from "../../src/server/financial";
import { recordRemittance, reverseRemittance } from "../../src/server/financial/settlement";
import { workflowFixture, syntheticBill } from "../helpers/workflow";
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
before(async () => { fixture = await workflowFixture(); }); after(closePools);
test("one remittance splits across claims, preserves residual money, deduplicates and reverses exactly once", async () => {
  const first = await fixture.approvedCase(); const second = await fixture.approvedCase();
  const input = { evidenceCaseId: first.caseId, evidenceRevisionId: first.sources["bank-remittance"], amountPaise: 16200000, reference: randomUUID(), occurredAt: new Date().toISOString(), idempotencyKey: randomUUID(), verified: true,
    allocations: [{ caseId: first.caseId, decisionId: first.decision.recordId, amountPaise: 8000000 }, { caseId: second.caseId, decisionId: second.decision.recordId, amountPaise: 8000000 }] };
  await assert.rejects(recordRemittance(fixture.headers.deskA, input), { status: 403 });
  const saved = await recordRemittance(fixture.headers.financeA, input);
  assert.equal((await recordRemittance(fixture.headers.financeA, input)).id, saved.id);
  await assert.rejects(recordRemittance(fixture.headers.financeA, { ...input, idempotencyKey: randomUUID() }), { status: 409 });
  const state = await getFinancialCase(fixture.headers.financeA, first.caseId);
  assert.equal(state.netReceivedPaise, 8000000); assert.equal(state.receivablePaise, 200000); assert.equal(state.disputePaise, 300000); assert.equal(state.remittances[0].unallocatedPaise, 200000);
  const reversal = { receiptId: saved.id, evidenceCaseId: first.caseId, evidenceRevisionId: first.sources["bank-remittance"], reference: randomUUID(), occurredAt: new Date().toISOString(), idempotencyKey: randomUUID(), verified: true };
  await reverseRemittance(fixture.headers.financeA, reversal);
  await reverseRemittance(fixture.headers.financeA, reversal);
  await assert.rejects(reverseRemittance(fixture.headers.financeA, { ...reversal, idempotencyKey: randomUUID() }), { status: 409 });
  assert.equal((await getFinancialCase(fixture.headers.financeA, second.caseId)).netReceivedPaise, 0);
});
test("overallocated, stale approval and cross-hospital remittances fail; actual overpayment stays visible", async () => {
  const item = await fixture.approvedCase();
  const input = { evidenceCaseId: item.caseId, evidenceRevisionId: item.sources["bank-remittance"], amountPaise: 9000000, reference: randomUUID(), occurredAt: new Date().toISOString(), idempotencyKey: randomUUID(), verified: true, allocations: [{ caseId: item.caseId, decisionId: item.decision.recordId, amountPaise: 9000000 }] };
  await assert.rejects(recordRemittance(fixture.headers.financeA, { ...input, amountPaise: 8999999 }), { status: 400 });
  await assert.rejects(recordRemittance(fixture.headers.deskB, input), { status: 403 });
  await recordRemittance(fixture.headers.financeA, input);
  assert.equal((await getFinancialCase(fixture.headers.financeA, item.caseId)).overpaidPaise, 800000);
  await item.act("billingA", { type: "bill", bill: syntheticBill, sourceRevisionId: item.sources["final-bill"], reductionRevisionId: item.sources["approved-hospital-reduction"], verified: true });
  await assert.rejects(recordRemittance(fixture.headers.financeA, { ...input, idempotencyKey: randomUUID(), reference: randomUUID() }), { status: 409 });
  assert.equal((await getFinancialCase(fixture.headers.financeA, item.caseId)).receivablePaise, null);
});
