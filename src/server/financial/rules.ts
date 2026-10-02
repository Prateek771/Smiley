import { z } from "zod";

export const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const billSchema = z.object({
  serviceDate: z.iso.date(),
  lines: z.array(z.object({ description: z.string().trim().min(1).max(200), grossPaise: money, excludedPaise: money, reductionPaise: money }).strict()).min(1).max(150),
}).strict();
export const ruleSchema = z.object({ version: z.string().min(1).max(80), validFrom: z.iso.date(), validTo: z.iso.date(), deductiblePaise: money,
  copayBps: z.number().int().min(0).max(10000), benefitLimitPaise: money, tariffCapsPaise: z.array(money.nullable()).max(150),
}).strict();
export type BillInput = z.infer<typeof billSchema>;
export type RuleInput = z.infer<typeof ruleSchema>;
export type Assessment = {
  status: "READY" | "NEEDS_REVIEW"; blocks: string[]; grossPaise: number; excludedPaise: number; reductionPaise: number;
  eligiblePaise: number; deductiblePaise: number | null; copayPaise: number | null; limitExcessPaise: number | null;
  insurerPaise: number | null; patientPaise: number | null; lines: { description: string; eligiblePaise: number; reason: string }[];
};
export function sumPaise(values: number[]): number {
  const sum = values.reduce((total, value) => total + BigInt(money.parse(value)), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The monetary total exceeds the supported precision.");
  return Number(sum);
}
export function assessBill(input: BillInput, ruleInput: RuleInput | null): Assessment {
  const bill = billSchema.parse(input);
  const rule = ruleInput === null ? null : ruleSchema.parse(ruleInput);
  const grossPaise = sumPaise(bill.lines.map((line) => line.grossPaise));
  const reductionPaise = sumPaise(bill.lines.map((line) => line.reductionPaise));
  const blocks: string[] = [];
  if (!rule) blocks.push("A verified policy and rule snapshot is required.");
  else {
    if (rule.version !== "SYN-DISCHARGE-1") blocks.push("This rule version is unsupported.");
    if (rule.validFrom > rule.validTo || bill.serviceDate < rule.validFrom || bill.serviceDate > rule.validTo) blocks.push("The service date and policy effective dates conflict.");
    if (rule.tariffCapsPaise.length && rule.tariffCapsPaise.length !== bill.lines.length) blocks.push("Each bill line needs its corresponding tariff cap or an explicit uncapped entry.");
  }
  const lines = bill.lines.map((line, index) => {
    if (sumPaise([line.excludedPaise, line.reductionPaise]) > line.grossPaise) throw new Error("Excluded amounts and reductions cannot overlap or exceed a bill line.");
    const base = line.grossPaise - line.excludedPaise - line.reductionPaise;
    const cap = rule?.tariffCapsPaise[index];
    const eligiblePaise = cap === null || cap === undefined ? base : Math.min(base, cap);
    return { description: line.description, eligiblePaise, reason: `Gross ${line.grossPaise}; excluded ${line.excludedPaise}; approved reduction ${line.reductionPaise}; tariff excess ${base - eligiblePaise} paise.` };
  });
  const eligiblePaise = sumPaise(lines.map((line) => line.eligiblePaise));
  const excludedPaise = grossPaise - reductionPaise - eligiblePaise;
  const base = { blocks, grossPaise, excludedPaise, reductionPaise, eligiblePaise, lines };
  if (blocks.length || !rule) return { ...base, status: "NEEDS_REVIEW", deductiblePaise: null, copayPaise: null, limitExcessPaise: null, insurerPaise: null, patientPaise: null };
  const deductiblePaise = Math.min(eligiblePaise, rule.deductiblePaise);
  const afterDeductible = eligiblePaise - deductiblePaise;
  const copayPaise = Number((BigInt(afterDeductible) * BigInt(rule.copayBps) + 5000n) / 10000n);
  const insurerPaise = Math.min(afterDeductible - copayPaise, rule.benefitLimitPaise);
  const limitExcessPaise = afterDeductible - copayPaise - insurerPaise;
  const patientPaise = grossPaise - reductionPaise - insurerPaise;
  return { ...base, status: "READY", deductiblePaise, copayPaise, limitExcessPaise, insurerPaise, patientPaise };
}
