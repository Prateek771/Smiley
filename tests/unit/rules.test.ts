import assert from "node:assert/strict";
import { test } from "node:test";

test("versioned synthetic assessment preserves money, reasons, rounding and review blocks", async () => {
  const rules = await import("../../src/server/financial/rules").catch(() => null);
  assert.ok(rules, "Implement the deterministic versioned bill assessment.");
  const bill = { serviceDate: "2026-10-02", lines: [{ description: "Fictional treatment", grossPaise: 10000000, excludedPaise: 500000, reductionPaise: 700000 }] };
  const rule = { version: "SYN-DISCHARGE-1", validFrom: "2026-01-01", validTo: "2026-12-31", deductiblePaise: 300000, copayBps: 0, benefitLimitPaise: 20000000, tariffCapsPaise: [] };
  const result = rules.assessBill(bill, rule);
  assert.equal(result.status, "READY");
  assert.equal(result.insurerPaise, 8500000); assert.equal(result.patientPaise, 800000);
  assert.equal(result.grossPaise, result.insurerPaise! + result.patientPaise! + result.reductionPaise);
  assert.ok(result.lines[0].reason);
  const rounded = rules.assessBill({ ...bill, lines: [{ description: "Half paise", grossPaise: 1, excludedPaise: 0, reductionPaise: 0 }] }, { ...rule, deductiblePaise: 0, copayBps: 5000 });
  assert.equal(rounded.copayPaise, 1); assert.equal(rounded.insurerPaise, 0);
  const capped = rules.assessBill(bill, { ...rule, tariffCapsPaise: [8000000], benefitLimitPaise: 7000000 });
  assert.equal(capped.insurerPaise, 7000000); assert.equal(capped.patientPaise, 2300000);
  for (const missing of [null, { ...rule, version: "UNKNOWN" }, { ...rule, validTo: "2026-01-01" }]) {
    const blocked = rules.assessBill(bill, missing);
    assert.equal(blocked.status, "NEEDS_REVIEW"); assert.equal(blocked.insurerPaise, null); assert.ok(blocked.blocks.length);
  }
  assert.throws(() => rules.assessBill({ ...bill, lines: [{ ...bill.lines[0], excludedPaise: 10000001 }] }, rule));
  assert.throws(() => rules.assessBill({ ...bill, lines: [{ ...bill.lines[0], grossPaise: Number.MAX_SAFE_INTEGER }, bill.lines[0]] }, rule));
  assert.throws(() => rules.assessBill({ ...bill, lines: [{ ...bill.lines[0], grossPaise: 1.5 }] }, rule));
});
