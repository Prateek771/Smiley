import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

const require = createRequire(import.meta.url);
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_ALLOCATED_BYTES = 32 * 1024 * 1024;
const MAX_STREAM_OBJECTS = 10000;
const MAX_FILTERS = 8;
const MAX_PAGES = 1000;
const MAX_TREE_NODES = 10000;
const MAX_TREE_DEPTH = 100;

// These reviewed 1.17.1 internals route decompressed output through ensureBuffer.
// Fail closed on a dependency change; re-review allocation paths before updating.
const reviewedSources = {
  "streams/DecodeStream.js": "666dc30139cceee5ef849a09a990d761c2de801e0aaa264178b93cf99640adcb",
  "streams/Stream.js": "64854a09f25c4ab400459fb678213db41a1988f3e1620555332c44c3d3867634",
  "streams/FlateStream.js": "e5e279bd3642c8fd52582605f61514162cdff563523ae0963664a7aa05ff4f03",
  "streams/LZWStream.js": "95a7269f43aa4f4a9658aefff678696eef12c33b0cf64f5f616270f3c1ec8d73",
  "streams/Ascii85Stream.js": "d08c5358acedbc23735a192ceb11e9bf4a1fd2897907e343fa694033d97d5de0",
  "streams/AsciiHexStream.js": "b9b5eaeadb15010c15643e87e0d35512aacae183d0329d4bcda9c10dda332435",
  "streams/RunLengthStream.js": "f9b5750a1048611740c50d15e4f3426615edf8537cdef1841661aa93fd00adc0",
  "streams/decode.js": "d9a689fe9004122c9b96c5e331defa1a22a7c27f2591f42033ccdcb562e1d689",
  "parser/ByteStream.js": "f7489621ec58792b4c6c4d1e8b38ce5fcd17d997b0f9d2c0b7d81176e55cbf12",
  "parser/PDFObjectStreamParser.js": "55a12aa6d4ccc5af18286abc9e264e0b219e90129404f83645d248badbf3fb7a",
  "parser/PDFParser.js": "390fc8e6464b2938e9e8726b3ae23649514dc157beed55f333e58a0bc6899c58",
  "parser/PDFXRefStreamParser.js": "3bfc5d5afd99549c4739ac788b7465c753625fe6f53b972ab4832d33eab1342b",
};

function installAllocationGuards(PDFArray, PDFName, PDFNumber) {
  if (require("pdf-lib/package.json").version !== "1.17.1") throw new Error("Unreviewed PDF parser version.");
  for (const [path, expected] of Object.entries(reviewedSources)) {
    const source = readFileSync(require.resolve("pdf-lib/cjs/core/" + path));
    if (createHash("sha256").update(source).digest("hex") !== expected) throw new Error("Unreviewed PDF parser internals.");
  }
  const DecodeStream = require("pdf-lib/cjs/core/streams/DecodeStream.js").default;
  const ObjectStreamParser = require("pdf-lib/cjs/core/parser/PDFObjectStreamParser.js").default;
  const ensureBuffer = DecodeStream.prototype.ensureBuffer;
  const forStream = ObjectStreamParser.forStream;
  const decoder = require("pdf-lib/cjs/core/streams/decode.js");
  const decodeRawStream = decoder.decodePDFRawStream;
  if (typeof decodeRawStream !== "function" || typeof ensureBuffer !== "function" || typeof forStream !== "function") throw new Error("Unsupported PDF parser shape.");
  // ByteStream calls this exported property dynamically for both ObjStm and XRef.
  // Bound eager decoder construction (including fixed LZW dictionaries) first.
  decoder.decodePDFRawStream = function boundedFilterChain(rawStream) {
    const filters = rawStream.dict.lookup(PDFName.of("Filter"));
    if (filters instanceof PDFArray && filters.size() > MAX_FILTERS) throw new Error("PDF filter chain limit exceeded.");
    return decodeRawStream.call(this, rawStream);
  };
  let allocatedBytes = 0;
  DecodeStream.prototype.ensureBuffer = function boundedEnsureBuffer(requested) {
    if (!Number.isSafeInteger(requested) || requested < 0 || !(this.buffer instanceof Uint8Array) || this.buffer.byteLength > MAX_STREAM_BYTES) throw new Error("Invalid decoded stream size.");
    if (requested <= this.buffer.byteLength) return this.buffer;
    let capacity = this.minBufferLength;
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_STREAM_BYTES) throw new Error("Invalid decoded stream capacity.");
    while (capacity < requested && capacity <= MAX_STREAM_BYTES) capacity *= 2;
    if (capacity > MAX_STREAM_BYTES || allocatedBytes + capacity > MAX_ALLOCATED_BYTES) throw new Error("Decoded PDF allocation limit exceeded.");
    // Count every allocation, including replaced buffers, before the library allocates.
    allocatedBytes += capacity;
    return ensureBuffer.call(this, requested);
  };
  ObjectStreamParser.forStream = function boundedObjectStream(rawStream, shouldWaitForTick) {
    const count = rawStream.dict.lookup(PDFName.of("N"), PDFNumber).asNumber();
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_STREAM_OBJECTS) throw new Error("PDF object stream count limit exceeded.");
    // The original factory constructs ByteStream and decodes; check N before entry.
    return forStream.call(this, rawStream, shouldWaitForTick);
  };
}

async function validatePdf(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_INPUT_BYTES) return false;
  const { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } = require("pdf-lib");
  installAllocationGuards(PDFArray, PDFName, PDFNumber);
  const document = await PDFDocument.load(bytes, { throwOnInvalidObject: true, ignoreEncryption: false, updateMetadata: false });
  const root = document.catalog.lookup(PDFName.of("Pages"), PDFDict);
  const visited = new Set();
  function countPages(node, parent, depth) {
    if (depth > MAX_TREE_DEPTH || visited.has(node) || visited.size >= MAX_TREE_NODES) return -1;
    visited.add(node);
    if (node.lookupMaybe(PDFName.of("Parent"), PDFDict) !== parent) return -1;
    const type = node.lookup(PDFName.of("Type"), PDFName);
    if (type === PDFName.of("Page")) return 1;
    if (type !== PDFName.of("Pages")) return -1;
    const declared = node.lookup(PDFName.of("Count"), PDFNumber).asNumber();
    const children = node.lookup(PDFName.of("Kids"), PDFArray);
    if (!Number.isInteger(declared) || declared < 0 || declared > MAX_PAGES || children.size() > MAX_TREE_NODES) return -1;
    let count = 0;
    for (let index = 0; index < children.size(); index++) {
      const childCount = countPages(children.lookup(index, PDFDict), node, depth + 1);
      if (childCount < 0 || count + childCount > MAX_PAGES) return -1;
      count += childCount;
    }
    return count === declared ? count : -1;
  }
  const count = countPages(root, undefined, 0);
  if (count < 1) return false;
  const pages = document.getPages();
  return pages.length === count && pages.every((page) => {
    const { x, y, width, height } = page.getMediaBox();
    return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0 && width <= 14400 && height <= 14400;
  });
}

let valid = false;
try { valid = await validatePdf(workerData); } catch { valid = false; }
parentPort?.postMessage(valid);
