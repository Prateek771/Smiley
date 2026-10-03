import { getPdfPageCount, validateUpload } from "../documents/validation";

export type OCRPage = {
  pageNumber: number;
  text: string;
  words: { text: string; left: number; top: number; width: number; height: number }[];
  confidence: null;
};
export type OCRResult = { pages: OCRPage[]; provider: "ocr.space" | "source-text" };
export const MODEL = "qwen/qwen3.8-27b:free";
const MAX_OCR_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
type FailureCode = "TEMPORARY" | "UNSUPPORTED" | "INVALID_OUTPUT" | "CONFIGURATION";
const failureMessages: Record<FailureCode, string> = {
  TEMPORARY: "The extraction service is temporarily unavailable. Retry later.",
  UNSUPPORTED: "This document or request exceeds the supported extraction limits.",
  INVALID_OUTPUT: "The extraction service returned incomplete or invalid evidence.",
  CONFIGURATION: "The extraction service requires valid server configuration.",
};
export class ProviderFailure extends Error {
  constructor(public readonly code: FailureCode) {
    super(failureMessages[code]);
    this.name = "ProviderFailure";
  }
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ProviderFailure("INVALID_OUTPUT");
  return value as Record<string, unknown>;
}
function apiKey(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ProviderFailure("CONFIGURATION");
  return value;
}
async function requestJson(url: string, init: RequestInit, signal: AbortSignal | undefined, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000);
  if (boundedSignal.aborted) throw new ProviderFailure("TEMPORARY");
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new ProviderFailure("TEMPORARY"));
  boundedSignal.addEventListener("abort", onAbort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([fetcher(url, { ...init, signal: boundedSignal }), aborted]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 429 || response.status >= 500) throw new ProviderFailure("TEMPORARY");
      throw new ProviderFailure([401, 403].includes(response.status) ? "CONFIGURATION" : "UNSUPPORTED");
    }
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderFailure("INVALID_OUTPUT");
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new ProviderFailure("INVALID_OUTPUT");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
    catch { throw new ProviderFailure("INVALID_OUTPUT"); }
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure("TEMPORARY");
  } finally {
    boundedSignal.removeEventListener("abort", onAbort);
    void reader?.cancel().catch(() => {});
  }
}
function providerError(result: Record<string, unknown>) {
  // Classify known diagnostics locally; upstream text must never escape to UI/logs.
  const text = JSON.stringify([result.ErrorMessage, result.ErrorDetails]);
  if (/invalid\s+(?:api\s*)?key|api\s*key[^"]*invalid/iu.test(text)) throw new ProviderFailure("CONFIGURATION");
  if (/limit|quota|timeout|timed out|temporarily unavailable/iu.test(text)) throw new ProviderFailure("TEMPORARY");
  throw new ProviderFailure("INVALID_OUTPUT");
}
export async function extractDocument(bytes: Uint8Array, mimeType: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<OCRResult> {
  if (signal?.aborted) throw new ProviderFailure("TEMPORARY");
  mimeType = mimeType.split(";")[0].trim().toLowerCase();
  if (!bytes.byteLength || !["text/plain", "application/pdf", "image/png", "image/jpeg"].includes(mimeType)) throw new ProviderFailure("UNSUPPORTED");
  if (mimeType !== "text/plain" && bytes.byteLength > MAX_OCR_BYTES) throw new ProviderFailure("UNSUPPORTED");
  let expectedPages = 1;
  try {
    if (mimeType === "application/pdf") {
      const count = await getPdfPageCount(bytes);
      if (count === null || count > 3) throw new ProviderFailure("UNSUPPORTED");
      expectedPages = count;
    } else {
      await validateUpload({ bytes, mimeType, name: mimeType === "text/plain" ? "source.txt" : mimeType === "image/png" ? "source.png" : "source.jpg" });
    }
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (typeof error === "object" && error !== null && "status" in error && error.status === 503) throw new ProviderFailure("TEMPORARY");
    throw new ProviderFailure("UNSUPPORTED");
  }
  if (mimeType === "text/plain") return { provider: "source-text", pages: [{ pageNumber: 1, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), words: [], confidence: null }] };
  const form = new FormData();
  const extension = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : "jpg";
  form.set("file", new Blob([Uint8Array.from(bytes)], { type: mimeType }), `source.${extension}`);
  for (const [name, value] of Object.entries({ OCREngine: "2", language: "eng", isOverlayRequired: "true", isTable: "true", isCreateSearchablePdf: "false", scale: "false", detectOrientation: "false" })) form.set(name, value);
  const result = await requestJson("https://api.ocr.space/parse/image", { method: "POST", headers: { apikey: apiKey("OCR_SPACE_API_KEY") }, body: form }, signal, fetcher);
  if (Number(result.OCRExitCode) !== 1 || result.IsErroredOnProcessing !== false) providerError(result);
  if (!Array.isArray(result.ParsedResults) || result.ParsedResults.length !== expectedPages) throw new ProviderFailure("INVALID_OUTPUT");
  const pages = result.ParsedResults.map((value, index): OCRPage => {
    const item = record(value);
    if (Number(item.FileParseExitCode) !== 1 || typeof item.ParsedText !== "string" || !item.ParsedText.trim() || item.ErrorMessage || item.ErrorDetails) throw new ProviderFailure("INVALID_OUTPUT");
    const overlay = record(item.TextOverlay);
    if (overlay.HasOverlay !== true || !Array.isArray(overlay.Lines)) throw new ProviderFailure("INVALID_OUTPUT");
    const words: OCRPage["words"] = overlay.Lines.flatMap((value) => {
      const line = record(value);
      if (!Array.isArray(line.Words)) throw new ProviderFailure("INVALID_OUTPUT");
      return line.Words.map((value) => {
        const word = record(value);
        if (typeof word.WordText !== "string" || !word.WordText.trim() || ![word.Left, word.Top, word.Width, word.Height].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) || Number(word.Width) <= 0 || Number(word.Height) <= 0) throw new ProviderFailure("INVALID_OUTPUT");
        return { text: word.WordText, left: word.Left as number, top: word.Top as number, width: word.Width as number, height: word.Height as number };
      });
    });
    if (!words.length) throw new ProviderFailure("INVALID_OUTPUT");
    return { pageNumber: index + 1, text: item.ParsedText, words, confidence: null };
  });
  return { provider: "ocr.space", pages };
}
export async function generateStructured(messages: { role: "system" | "user"; content: string }[], schema: Record<string, unknown>, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown> {
  if (!messages.length || messages.length > 20 || messages.some((message) => !["system", "user"].includes(message.role) || typeof message.content !== "string" || !message.content.trim())) throw new ProviderFailure("UNSUPPORTED");
  const body = JSON.stringify({ model: MODEL, messages, stream: false, max_tokens: 4096,
    provider: { allow_fallbacks: false, require_parameters: true, data_collection: "deny" },
    response_format: { type: "json_schema", json_schema: { name: "claim_extraction", strict: true, schema } },
  });
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new ProviderFailure("UNSUPPORTED");
  const result = await requestJson("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey("OPENROUTER_API_KEY")}`, "Content-Type": "application/json" }, body }, signal, fetcher);
  if (result.model !== MODEL || !Array.isArray(result.choices) || result.choices.length !== 1) throw new ProviderFailure("INVALID_OUTPUT");
  const choice = record(result.choices[0]);
  const message = record(choice.message);
  if (choice.finish_reason !== "stop" || typeof message.content !== "string" || message.refusal) throw new ProviderFailure("INVALID_OUTPUT");
  try { return JSON.parse(message.content); }
  catch { throw new ProviderFailure("INVALID_OUTPUT"); }
}
