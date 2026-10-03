import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowTiming, csv } from "../../src/server/reporting/format";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 3, 0, minute)).toISOString();
test("discharge clocks preserve the first bill start and keep waiting separate from full resolution", () => {
  const events = [
    { type: "FINANCIAL_BILL", occurredAt: at(0) },
    { type: "FINANCIAL_PACK", occurredAt: at(8) },
    { type: "FINANCIAL_SUBMISSION", occurredAt: at(10) },
    { type: "PAYER_QUERY_RECORDED", occurredAt: at(30) },
    { type: "FINANCIAL_QUERY_ACK", occurredAt: at(40) },
    { type: "PAYER_QUERY_RECORDED", occurredAt: at(50) },
    { type: "FINANCIAL_QUERY_ACK", occurredAt: at(55) },
    { type: "USABLE_FINAL_DECISION", occurredAt: at(65) },
    { type: "FINANCIAL_CONFIRM", occurredAt: at(70) },
  ];
  assert.deepEqual(workflowTiming(at(0), events, at(90)), { preparationMs: 480000, submissionDelayMs: 120000, payerWaitingMs: 2400000, queryResponseMs: 900000, billingReviewMs: 300000, deskResolutionMs: 4200000, ongoing: false, issue: null });
});
test("out of sequence external events make duration unknown instead of negative or invented", () => {
  assert.equal(workflowTiming(at(0), [{ type: "FINANCIAL_BILL", occurredAt: at(20) }, { type: "FINANCIAL_SUBMISSION", occurredAt: at(10) }], at(30)).issue, "Event timestamps need review.");
});
test("ongoing preparation is measured only to the report snapshot", () => {
  assert.equal(workflowTiming(at(0), [{ type: "FINANCIAL_BILL", occurredAt: at(0) }], at(12)).preparationMs, 720000);
  assert.equal(workflowTiming(at(0), [{ type: "FINANCIAL_BILL", occurredAt: at(0) }], at(12)).ongoing, true);
});
test("registration alone does not invent a bill-ready or desk-resolution clock", () => {
  assert.equal(workflowTiming(at(0), [], at(12)).deskResolutionMs, null);
});
test("CSV neutralizes spreadsheet formulas and quotes delimiters and newlines", () => {
  assert.equal(csv(["Case", "Next action"], [["=HYPERLINK(\"bad\")", "a,b\nnext"], [" \t+formula", null]]), '"Case","Next action"\r\n"\'=HYPERLINK(""bad"")","a,b\nnext"\r\n"\' \t+formula",""\r\n');
});
