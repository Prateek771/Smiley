import { createHash } from "node:crypto";
import { extname, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import sharp from "sharp";
import { AuthError } from "../auth";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const PDF_VALIDATION_TIMEOUT_MS = 3000;
const PDF_WORKER_LIMIT = 2;
const pdfWorkerStateKey = Symbol.for("smiley.pdfValidation.workers");
const workerGlobals = globalThis as typeof globalThis & { [key: symbol]: { active: number } | undefined };
const pdfWorkerState = workerGlobals[pdfWorkerStateKey] ??= { active: 0 };
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function validPng(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(pngSignature)) return false;
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_DOCUMENT_BYTES || offset + 12 + length > bytes.length) return false;
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/u.test(type)) return false;
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) return false;
    if (!sawHeader && type !== "IHDR") return false;
    if (type === "IHDR") {
      if (sawHeader || length !== 13) return false;
      const width = data.readUInt32BE(0), height = data.readUInt32BE(4);
      if (!width || !height || width > 10000 || height > 10000 || width * height > 40_000_000) return false;
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[data[9]]?.includes(data[8]) || data[10] !== 0 || data[11] !== 0 || data[12] > 1) return false;
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!length) return false;
      sawData = true;
    } else if (type === "IEND") {
      return length === 0 && sawHeader && sawData && offset + 12 === bytes.length;
    } else if (type[0] === type[0].toUpperCase() && type !== "PLTE") return false;
    offset += length + 12;
  }
  return false;
}
function validJpeg(bytes: Buffer) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
  let offset = 2, sawFrame = false;
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) sawFrame = true;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length - 2) return false;
    if (marker === 0xda) return sawFrame && offset + 2 + length < bytes.length - 2;
    offset += length + 2;
  }
  return false;
}
export async function getPdfPageCount(bytes: Uint8Array): Promise<number | null> {
  if (!bytes.byteLength || bytes.byteLength > MAX_DOCUMENT_BYTES) return null;
  if (pdfWorkerState.active >= PDF_WORKER_LIMIT) throw new AuthError(503, "Document validation is busy. Retry shortly.");
  pdfWorkerState.active += 1;
  try {
    const payload = Uint8Array.from(bytes);
    const worker = new Worker(resolve(process.cwd(), "src/server/documents/pdf-validation-worker.mjs"), {
      workerData: { bytes: payload, metadata: true }, transferList: [payload.buffer], execArgv: [], stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    // Parser warnings must not reach logs or accumulate in parent memory.
    worker.stdout?.resume();
    worker.stderr?.resume();
    return await new Promise<number | null>((resolveResult) => {
      let settled = false;
      const timer = setTimeout(() => finish(null), PDF_VALIDATION_TIMEOUT_MS);
      function finish(pageCount: number | null) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Keep the slot until termination completes, including parser errors/timeouts.
        void worker.terminate().then(() => resolveResult(pageCount), () => resolveResult(null));
      }
      worker.once("message", (message: unknown) => finish(typeof message === "number" && Number.isSafeInteger(message) && message > 0 && message <= 1000 ? message : null));
      worker.once("error", () => finish(null));
      worker.once("exit", () => finish(null));
    });
  } catch { return null; }
  finally { pdfWorkerState.active -= 1; }
}
async function validPdf(bytes: Buffer): Promise<boolean> {
  return await getPdfPageCount(bytes) !== null;
}
async function validImage(bytes: Buffer, format: "png" | "jpeg"): Promise<boolean> {
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) return false;
    // Metadata alone does not validate scan data. Force the bounded decoder to read all pixels.
    const { info } = await image.raw().toBuffer({ resolveWithObject: true });
    return info.width === metadata.width && info.height === metadata.height;
  } catch { return false; }
}
function sanitizeName(name: string) {
  const basename = name.replace(/\\/gu, "/").split("/").at(-1) ?? "";
  let clean = basename.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").trim();
  if (!clean || clean === "." || clean === "..") throw new AuthError(400, "Provide a document filename.");
  if (clean.length > 255) {
    const extension = extname(clean).slice(0, 16);
    clean = clean.slice(0, 255 - extension.length) + extension;
  }
  return clean;
}
export async function validateUpload(input: { bytes: Uint8Array; name: string; mimeType: string }) {
  if (!input.bytes.byteLength) throw new AuthError(400, "Empty documents cannot be uploaded.");
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new AuthError(413, "Documents must be at most 5 MiB.");
  const bytes = Buffer.from(input.bytes);
  const name = sanitizeName(input.name);
  const mimeType = input.mimeType.split(";")[0].trim().toLowerCase();
  const extension = extname(name).toLowerCase();
  let valid = false;
  if (mimeType === "application/pdf") {
    valid = /^%PDF-(?:1\.[0-7]|2\.0)/u.test(bytes.toString("latin1", 0, 8)) && /%%EOF\s*$/u.test(bytes.subarray(Math.max(0, bytes.length - 1024)).toString("latin1")) && (!extension || extension === ".pdf");
    if (valid) valid = await validPdf(bytes);
  } else if (mimeType === "image/png") {
    valid = validPng(bytes) && (!extension || extension === ".png");
    if (valid) valid = await validImage(bytes, "png");
  } else if (mimeType === "image/jpeg") {
    valid = validJpeg(bytes) && (!extension || [".jpg", ".jpeg"].includes(extension));
    if (valid) valid = await validImage(bytes, "jpeg");
  } else if (mimeType === "text/plain") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const activeMarkup = /<(?:!doctype\b|!--|\?xml\b|\/?[a-z][a-z0-9:-]*(?:\s|\/?>))/iu;
      valid = !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) && !activeMarkup.test(text) && !text.startsWith("MZ") && (!extension || extension === ".txt");
    } catch { valid = false; }
  }
  if (!valid) throw new AuthError(415, "The document content does not match an allowed PDF, PNG, JPEG, or UTF-8 text file.");
  return { bytes, name, mimeType, sha256: createHash("sha256").update(bytes).digest("hex") };
}
