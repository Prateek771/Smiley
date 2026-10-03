import { z } from "zod";
import { ProviderFailure, type OCRPage } from "./providers";

export const FACT_FIELDS = ["policy_number", "bill_total", "payer_authorized", "document_date", "requested_amount", "reference"] as const;
export const FACT_FIELD_GUIDANCE = "Field meanings: policy_number = the insurer policy identifier only (example SYN-POL-001); reference = a literal case, query, payment or other document identifier (example SYN-OCR-001). bill_total = the explicitly stated final bill amount; payer_authorized = an explicitly stated insurer/TPA authorized amount, never an approval status or patient amount; requested_amount = an explicitly stated amount requested. Money values must contain only the amount token and optional currency (examples 100,000.00, INR 100000, ₹ 1,00,000.00), never labels or whole sentences. document_date = an actual printed date token only (examples 2026-10-03, 03/10/2026, 3 October 2026), never a heading, identifier or entire line. Do not assume every line is a fact. Omit unknown, absent or unsupported fields; an empty facts array is valid. Never infer, convert, normalize or calculate a value; copy the original literal value.";
export type ExtractedFact = { field: string; value: string; pageNumber: number; quote: string };
const factSchema = z.object({
  field: z.enum(FACT_FIELDS), value: z.string().trim().min(1).max(1000),
  pageNumber: z.number().int().positive(), quote: z.string().min(1).max(4000),
}).strict();
const factsSchema = z.array(factSchema).max(200);
export const FACTS_SCHEMA: Record<string, unknown> = z.toJSONSchema(z.object({ facts: factsSchema }).strict());
const moneyValue = /^(?:(?:INR|Rs\.?|₹)\s*)?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?(?:\/-)?(?:\s*(?:INR|Rs\.?|₹))?$/iu;
const day = "(?:0?[1-9]|[12]\\d|3[01])";
const month = "(?:0?[1-9]|1[0-2])";
const writtenMonth = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const year = "[1-9]\\d{3}";
// Validate literal shapes only; document context and applicability require staff review.
const dateValue = new RegExp(`^(?:${year}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])|${day}([/.-])${month}\\1${year}|${day}\\s+${writtenMonth}\\s+${year}|${writtenMonth}\\s+${day},?\\s+${year})$`, "iu");
function normalize(value: string) { return value.replace(/\s+/gu, " ").trim(); }
function quotedWholeValue(page: string, quote: string, value: string) {
  for (let start = page.indexOf(quote); start !== -1; start = page.indexOf(quote, start + 1)) {
    for (let offset = quote.indexOf(value); offset !== -1; offset = quote.indexOf(value, offset + 1)) {
      const before = page.slice(0, start + offset);
      const after = page.slice(start + offset + value.length);
      // Decimal points join digits; a trailing sentence period does not.
      const leftJoins = /[\p{L}\p{N}\p{M}_/,-]$/u.test(before) || (before.endsWith(".") && /^\p{N}/u.test(value));
      const rightJoins = /^[\p{L}\p{N}\p{M}_/-]/u.test(after) || /^,\S/u.test(after) || /^\.\p{N}/u.test(after);
      if (!leftJoins && !rightJoins) return true;
    }
  }
  return false;
}
export function validateFacts(facts: unknown, pages: OCRPage[]): ExtractedFact[] {
  const parsed = factsSchema.safeParse(facts);
  if (!parsed.success) throw new ProviderFailure("INVALID_OUTPUT");
  const source = new Map(pages.map((page) => [page.pageNumber, normalize(page.text)]));
  for (const fact of parsed.data) {
    if (fact.field === "document_date" && !dateValue.test(fact.value)) throw new ProviderFailure("INVALID_OUTPUT");
    if (["bill_total", "payer_authorized", "requested_amount"].includes(fact.field) && !moneyValue.test(fact.value)) throw new ProviderFailure("INVALID_OUTPUT");
    const quote = normalize(fact.quote);
    const page = source.get(fact.pageNumber);
    if (!page || !quote || !quotedWholeValue(page, quote, normalize(fact.value))) throw new ProviderFailure("INVALID_OUTPUT");
  }
  // Keep conflicting facts independently sourced. Human review decides which
  // value applies; this extraction never becomes a payer approval decision.
  return parsed.data;
}
