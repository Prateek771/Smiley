import assert from "node:assert/strict";
import { before, test } from "node:test";
import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";

let providers: typeof import("../../src/server/ai/providers.ts");
let evidence: typeof import("../../src/server/ai/evidence.ts");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", "base64");
before(async () => {
  const providerModule = await import("../../src/server/ai/providers.ts").catch(() => null);
  assert.ok(providerModule, "Cloud adapters must exist.");
  providers = providerModule;
  evidence = await import("../../src/server/ai/evidence.ts");
  process.env.OCR_SPACE_API_KEY = "synthetic-test-key";
  process.env.OPENROUTER_API_KEY = "synthetic-test-key";
});
function response(value: unknown) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }
function page(text = "Policy SYN-123 total INR 1250.00") {
  return { FileParseExitCode: "1", ParsedText: text, ErrorMessage: null, ErrorDetails: null,
    TextOverlay: { HasOverlay: true, Lines: [{ MinTop: 4, MaxHeight: 8, Words: [{ WordText: "SYN-123", Left: 2, Top: 4, Width: 30, Height: 8 }] }] } };
}
function ocr(pages = [page()]) { return { OCRExitCode: "1", IsErroredOnProcessing: false, ErrorMessage: null, ErrorDetails: null, ParsedResults: pages }; }
const noNetwork: typeof fetch = async () => { assert.fail("Rejected input must not leave the server."); };
async function pdf(count: number, compressed = true) {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index++) document.addPage([300, 300]);
  return document.save({ useObjectStreams: compressed });
}
test("plain UTF-8 source text stays factual and never invokes OCR", async () => {
  assert.deepEqual(await providers.extractDocument(Buffer.from("Policy SYN-123"), "text/plain", undefined, noNetwork), {
    provider: "source-text", pages: [{ pageNumber: 1, text: "Policy SYN-123", words: [], confidence: null }],
  });
  await assert.rejects(providers.extractDocument(Buffer.from([0xff]), "text/plain", undefined, noNetwork), { code: "UNSUPPORTED" });
  await assert.rejects(providers.extractDocument(Buffer.from("<script>synthetic</script>"), "text/plain", undefined, noNetwork), { code: "UNSUPPORTED" });
});
test("OCR upload fixes Engine2, requests overlay and preserves source coordinates", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.ocr.space/parse/image");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("apikey"), "synthetic-test-key");
    const form = init?.body as FormData;
    assert.equal(form.get("OCREngine"), "2");
    assert.equal(form.get("isOverlayRequired"), "true");
    assert.equal(form.get("isTable"), "true");
    assert.equal(form.get("isCreateSearchablePdf"), "false");
    assert.ok(form.get("file") instanceof Blob);
    return response(ocr());
  };
  assert.deepEqual(await providers.extractDocument(png, "image/png", undefined, fetcher), {
    provider: "ocr.space", pages: [{ pageNumber: 1, text: "Policy SYN-123 total INR 1250.00", confidence: null,
      words: [{ text: "SYN-123", left: 2, top: 4, width: 30, height: 8 }] }],
  });
});
test("free-tier file/page limits use actual compressed PDF tree before network", async () => {
  await assert.rejects(providers.extractDocument(new Uint8Array(1_000_001), "image/png", undefined, noNetwork), { code: "UNSUPPORTED" });
  await assert.rejects(providers.extractDocument(await pdf(4), "application/pdf", undefined, noNetwork), { code: "UNSUPPORTED" });
  const dishonest = await PDFDocument.create();
  for (let index = 0; index < 4; index++) dishonest.addPage([300, 300]);
  dishonest.catalog.Pages().set(PDFName.of("Count"), PDFNumber.of(1));
  await assert.rejects(providers.extractDocument(await dishonest.save(), "application/pdf", undefined, noNetwork), { code: "UNSUPPORTED" });
  await assert.rejects(providers.extractDocument(Buffer.from("%PDF-1.7\nfake\n%%EOF"), "application/pdf", undefined, noNetwork), { code: "UNSUPPORTED" });
  const result = await providers.extractDocument(await pdf(2), "application/pdf", undefined, async () => response(ocr([page(), page("Page two")])));
  assert.deepEqual(result.pages.map((item) => item.pageNumber), [1, 2]);
});
test("OCR cannot label partial, missing pages or failed page output complete", async () => {
  for (const value of [
    { ...ocr(), OCRExitCode: 2 }, { ...ocr(), IsErroredOnProcessing: true },
    ocr([{ ...page(), FileParseExitCode: -20 }]), ocr([{ ...page(), TextOverlay: { HasOverlay: false, Lines: [] } }]),
    ocr([{ ...page(), TextOverlay: { HasOverlay: true, Lines: [{ Words: [{ WordText: "x", Left: -1, Top: 0, Width: 1, Height: 1 }] }] } }]),
  ]) await assert.rejects(providers.extractDocument(png, "image/png", undefined, async () => response(value)), { code: "INVALID_OUTPUT" });
  await assert.rejects(providers.extractDocument(await pdf(2), "application/pdf", undefined, async () => response(ocr())), { code: "INVALID_OUTPUT" });
});
test("provider errors and oversized streaming responses remain bounded and sanitized", async () => {
  for (const status of [429, 503]) await assert.rejects(providers.extractDocument(png, "image/png", undefined, async () => new Response("synthetic-private-upstream", { status })), { code: "TEMPORARY" });
  await assert.rejects(providers.extractDocument(png, "image/png", undefined, async () => response({ OCRExitCode: 4, IsErroredOnProcessing: true, ErrorMessage: ["Invalid API key synthetic-private-upstream"] })), (error: unknown) => {
    assert.ok(error instanceof providers.ProviderFailure);
    assert.equal(error.code, "CONFIGURATION");
    assert.equal(error.message.includes("synthetic-private-upstream"), false);
    return true;
  });
  await assert.rejects(providers.extractDocument(png, "image/png", undefined, async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close(); } }))), { code: "INVALID_OUTPUT" });
  await assert.rejects(providers.extractDocument(png, "image/png", undefined, async () => response({ OCRExitCode: 4, IsErroredOnProcessing: true, ErrorMessage: ["Monthly conversion quota exceeded"] })), { code: "TEMPORARY" });
});
test("cancelling a stalled response aborts extraction without waiting for provider completion", async () => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  try {
    await assert.rejects(providers.extractDocument(png, "image/png", controller.signal, async () => {
      timer = setTimeout(() => controller.abort(), 25);
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    }), { code: "TEMPORARY" });
    assert.equal(cancelled, true);
  } finally { clearTimeout(timer); }
});
test("missing keys and cancelled requests never invoke cloud services", async () => {
  const key = process.env.OCR_SPACE_API_KEY;
  delete process.env.OCR_SPACE_API_KEY;
  try { await assert.rejects(providers.extractDocument(png, "image/png", undefined, noNetwork), { code: "CONFIGURATION" }); }
  finally { process.env.OCR_SPACE_API_KEY = key; }
  await assert.rejects(providers.extractDocument(png, "image/png", AbortSignal.abort(), noNetwork), { code: "TEMPORARY" });
});
test("OpenRouter request keeps exact free model and strict provider/schema controls", async () => {
  const result = await providers.generateStructured([{ role: "user", content: "Synthetic facts only" }], { type: "object" }, undefined, async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "qwen/qwen3.8-27b:free");
    assert.equal(request.models, undefined);
    assert.equal(request.route, undefined);
    assert.deepEqual(request.provider, { allow_fallbacks: false, require_parameters: true, data_collection: "deny" });
    assert.equal(request.response_format.type, "json_schema");
    assert.equal(request.response_format.json_schema.strict, true);
    return response({ model: "qwen/qwen3.8-27b:free", choices: [{ finish_reason: "stop", message: { content: '{"facts":[]}' } }] });
  });
  assert.deepEqual(result, { facts: [] });
});
test("OpenRouter rejects substituted models, truncation, missing completion and invalid JSON", async () => {
  for (const value of [
    { model: "other-model", choices: [{ finish_reason: "stop", message: { content: "{}" } }] },
    { model: "qwen/qwen3.8-27b:free", choices: [{ finish_reason: "length", message: { content: "{}" } }] },
    { model: "qwen/qwen3.8-27b:free", choices: [] },
    { model: "qwen/qwen3.8-27b:free", choices: [{ finish_reason: "stop", message: { content: "```json\n{}\n```" } }] },
  ]) await assert.rejects(providers.generateStructured([{ role: "user", content: "Synthetic" }], {}, undefined, async () => response(value)), { code: "INVALID_OUTPUT" });
});
test("evidence preserves conflicting sourced facts without deciding payer approval", () => {
  const pages = [{ pageNumber: 1, text: "Policy SYN-123\nBill total INR 1250.00", words: [], confidence: null },
    { pageNumber: 2, text: "Bill total INR 1400.00", words: [], confidence: null }] as const;
  const facts = [{ field: "bill_total", value: "1250.00", pageNumber: 1, quote: "Bill total INR 1250.00" },
    { field: "bill_total", value: "1400.00", pageNumber: 2, quote: "Bill total INR 1400.00" }];
  assert.deepEqual(evidence.validateFacts(facts, [...pages].map((item) => ({ ...item, words: [] }))), facts);
});
test("evidence rejects fabricated values, quotes, pages, fields and extra properties", () => {
  const pages = [{ pageNumber: 1, text: "Policy SYN-123 total INR 1250.00", words: [], confidence: null }];
  const fact = { field: "policy_number", value: "SYN-123", pageNumber: 1, quote: "Policy SYN-123" };
  for (const candidate of [
    { ...fact, value: "INVENTED" }, { ...fact, quote: "Policy SYN-999", value: "SYN-999" },
    { ...fact, pageNumber: 2 }, { ...fact, pageNumber: 0 }, { ...fact, field: "approval_decision" },
    { ...fact, extra: "untrusted" }, { ...fact, quote: "" }, { ...fact, value: "" },
  ]) assert.throws(() => evidence.validateFacts([candidate], pages), { code: "INVALID_OUTPUT" });
  assert.throws(() => evidence.validateFacts({ facts: [fact] }, pages), { code: "INVALID_OUTPUT" });
  assert.deepEqual(evidence.validateFacts([{ ...fact, quote: "Policy\nSYN-123" }], pages), [{ ...fact, quote: "Policy\nSYN-123" }]);
});

test("evidence rejects shortened amounts, identifiers and dates even with cropped quotes", () => {
  const text = "Bill INR 100,000.50. Policy SYN-POL_001/2026,ABC. Date 2026-10-03. Reference आशा123.";
  const pages = [{ pageNumber: 1, text, words: [], confidence: null }];
  for (const [field, value, quote] of [
    ["bill_total", "100", "Bill INR 100,000.50."],
    ["bill_total", "000.50", "Bill INR 100,000.50."],
    ["bill_total", "100,000", "Bill INR 100,000.50."],
    ["bill_total", "100", "Bill INR 100"],
    ["policy_number", "POL_001", "Policy SYN-POL_001/2026,ABC."],
    ["policy_number", "SYN-POL_001/2026", "Policy SYN-POL_001/2026,ABC."],
    ["document_date", "2026-10", "Date 2026-10-03."],
    ["reference", "123", "Reference आशा123."],
  ]) assert.throws(() => evidence.validateFacts([{ field, value, pageNumber: 1, quote }], pages), { code: "INVALID_OUTPUT" });
  const facts = [
    { field: "bill_total", value: "100,000.50", pageNumber: 1, quote: "Bill INR 100,000.50." },
    { field: "policy_number", value: "SYN-POL_001/2026,ABC", pageNumber: 1, quote: "Policy SYN-POL_001/2026,ABC." },
    { field: "document_date", value: "2026-10-03", pageNumber: 1, quote: "Date 2026-10-03." },
  ];
  assert.deepEqual(evidence.validateFacts(facts, pages), facts);
});

test("evidence accepts complete values followed by prose commas", () => {
  const pages = [{ pageNumber: 1, text: "Policy SYN-123, coverage requires review. Bill INR 1250.00, reviewed by staff.", words: [], confidence: null }];
  const facts = [
    { field: "policy_number", value: "SYN-123", pageNumber: 1, quote: "Policy SYN-123, coverage requires review." },
    { field: "bill_total", value: "1250.00", pageNumber: 1, quote: "Bill INR 1250.00, reviewed by staff." },
  ];
  assert.deepEqual(evidence.validateFacts(facts, pages), facts);
});

test("evidence rejects the live whole-line document_date misclassification and labelled money values", () => {
  const lines = ["SYNTHETIC OCR TEST - no real patient data", "Case ID: SYN-OCR-001", "Final bill: INR 100,000.00", "Fictional insurer authorization: INR 85,000.00", "Fictional patient amount: INR 8,000.00", "Fictional approved reduction: INR 7,000.00"];
  const pages = [{ pageNumber: 1, text: lines.join("\n"), words: [], confidence: null }];
  for (const value of lines) assert.throws(() => evidence.validateFacts([{ field: "document_date", value, pageNumber: 1, quote: value }], pages), { code: "INVALID_OUTPUT" });
  for (const [field, value] of [["bill_total", lines[2]], ["payer_authorized", lines[3]], ["requested_amount", "Please pay INR 8,000.00"]]) {
    assert.throws(() => evidence.validateFacts([{ field, value, pageNumber: 1, quote: value }], [{ ...pages[0], text: value }]), { code: "INVALID_OUTPUT" });
  }
});

test("evidence keeps supported literal dates and Indian or ungrouped currency amounts unchanged", () => {
  for (const value of ["2026-10-03", "03/10/2026", "3-10-2026", "03.10.2026", "3 October 2026", "03 Oct. 2026", "October 3, 2026"]) {
    const fact = { field: "document_date", value, pageNumber: 1, quote: `Document date: ${value}` };
    assert.deepEqual(evidence.validateFacts([fact], [{ pageNumber: 1, text: fact.quote, words: [], confidence: null }]), [fact]);
  }
  for (const field of ["bill_total", "payer_authorized", "requested_amount"]) {
    for (const value of ["100000", "100,000.00", "1,00,000.00", "INR 100,000.00", "INR100000", "₹ 1,00,000.00", "Rs. 100000.00", "100000.00 INR", "100000/-"]) {
      const fact = { field, value, pageNumber: 1, quote: `Amount: ${value}` };
      assert.deepEqual(evidence.validateFacts([fact], [{ pageNumber: 1, text: fact.quote, words: [], confidence: null }]), [fact]);
    }
  }
  assert.deepEqual(evidence.validateFacts([], []), []);
});

test("evidence rejects malformed date and amount shapes instead of interpreting them", () => {
  for (const [field, value] of [["document_date", "2026-13-40"], ["document_date", "03/10/26"], ["bill_total", "1e5"], ["payer_authorized", "APPROVED"], ["requested_amount", "1 lakh"], ["bill_total", "10,00.000"]]) {
    assert.throws(() => evidence.validateFacts([{ field, value, pageNumber: 1, quote: value }], [{ pageNumber: 1, text: value, words: [], confidence: null }]), { code: "INVALID_OUTPUT" });
  }
});
