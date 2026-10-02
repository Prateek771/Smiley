import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { closePools, migrationPool } from "../../src/server/db/client";
import { getCase } from "../../src/server/cases";
import { getFinancialCase } from "../../src/server/financial";
import { uploadDocument } from "../../src/server/documents";
import { applyCaseAction, getCaseTimeline } from "../../src/server/timeline";
import { workflowFixture } from "../helpers/workflow";
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
before(async () => { fixture = await workflowFixture(); }); after(closePools);
const occurredAt = "2026-10-02T10:00:00+05:30";

test("staff-reviewed packs require mandatory evidence and freeze current bill, rule and source revisions", async () => {
  const item = await fixture.newCase();
  const action = { type: "pack", assessmentId: item.assessment.recordId, revisionIds: Object.values(item.sources), verified: true };
  await assert.rejects(item.act("deskA", { ...action, revisionIds: [item.sources["final-bill"]] }), { status: 400 });
  await assert.rejects(item.act("billingA", action), { status: 403 });
  const pack = await item.act("deskA", action);
  const detail = await getFinancialCase(fixture.headers.deskA, item.caseId);
  assert.equal(detail.pack?.id, pack.recordId); assert.equal(detail.packCurrent, true);
  assert.equal(detail.pack?.payload.billId, item.bill.recordId);
  const key = randomUUID(); const acknowledgement = { type: "submission", packId: pack.recordId, reference: "SYN-ACK-ONE", evidenceRevisionId: item.sources.preauthorization, occurredAt };
  const saved = await item.act("deskA", acknowledgement, key);
  const repeated = await item.act("deskA", acknowledgement, key, saved.version - 1);
  assert.equal(saved.recordId, repeated.recordId);
  await assert.rejects(item.act("deskA", acknowledgement), { status: 409 });
  await uploadDocument(fixture.headers.deskA, item.caseId, { bytes: Buffer.from("Fictional revised discharge summary"), name: "discharge-summary-v2.txt", mimeType: "text/plain", documentType: "discharge-summary", documentId: detail.pack!.payload.sources.find((source) => source.documentType === "discharge-summary")!.documentId, idempotencyKey: randomUUID() });
  assert.equal((await getFinancialCase(fixture.headers.deskA, item.caseId)).packCurrent, false);
  await assert.rejects(item.act("deskA", { ...acknowledgement, reference: "SYN-STALE" }), { status: 409 });
});

test("a query draft needs its own reviewed external acknowledgement and revised drafts invalidate older acknowledgements", async () => {
  const item = await fixture.newCase();
  async function prepare(action: unknown) { return applyCaseAction(fixture.headers.deskA, item.caseId, { expectedVersion: (await getCase(fixture.headers.deskA, item.caseId)).version, idempotencyKey: randomUUID(), action }); }
  await prepare({ type: "status", status: "PENDING", reason: "Prepare evidence" });
  await prepare({ type: "status", status: "IN_PROGRESS", reason: "Desk review" });
  await prepare({ type: "query-open", reference: "QUERY-ONE", text: "Provide revised summary" });
  const response = await prepare({ type: "query-response", reference: "QUERY-ONE", text: "Reviewed answer with source" });
  const action = { type: "query-ack", queryReference: "QUERY-ONE", responseEventId: response.eventId, reference: "RESPONSE-ACK-ONE", evidenceRevisionId: item.sources["discharge-summary"], occurredAt, verified: true };
  await item.act("deskA", action);
  assert.equal((await getCaseTimeline(fixture.headers.deskA, item.caseId)).queries[0].status, "RESPONDED");
  await prepare({ type: "query-response", reference: "QUERY-ONE", text: "Revised reviewed answer" });
  await assert.rejects(item.act("deskA", { type: "query-resolve", queryReference: "QUERY-ONE", reference: "RESOLUTION", evidenceRevisionId: item.sources["payer-decision"], occurredAt }), { status: 409 });
  const latest = (await getCase(fixture.headers.deskA, item.caseId)).events.filter((event) => event.type === "QUERY_RESPONSE_PREPARED").at(-1)!;
  await item.act("deskA", { ...action, responseEventId: latest.id, reference: "RESPONSE-ACK-TWO" });
  await item.act("deskA", { type: "query-resolve", queryReference: "QUERY-ONE", reference: "RESOLUTION", evidenceRevisionId: item.sources["payer-decision"], occurredAt });
  assert.equal((await getCaseTimeline(fixture.headers.deskA, item.caseId)).queries[0].status, "RESOLVED");
});

test("changed registered coverage invalidates assessment and downstream pack", async () => {
  const item = await fixture.newCase();
  await item.act("deskA", { type: "pack", assessmentId: item.assessment.recordId, revisionIds: Object.values(item.sources), verified: true });
  await migrationPool.query("UPDATE patient_insurance SET valid_to='2026-09-01' WHERE patient_insurance_id=(SELECT patient_insurance_id FROM claims WHERE claim_id=$1)", [item.caseId]);
  const detail = await getFinancialCase(fixture.headers.deskA, item.caseId);
  assert.equal(detail.assessment, null); assert.equal(detail.packCurrent, false);
  await assert.rejects(item.act("deskA", { type: "pack", assessmentId: item.assessment.recordId, revisionIds: Object.values(item.sources), verified: true }), { status: 409 });
});
