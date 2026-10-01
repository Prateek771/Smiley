import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir, open, lstat, unlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";

let validation: typeof import("../../src/server/documents/validation.ts");
let storage: typeof import("../../src/server/documents/storage.ts");
let root: string;
const faultHandles = new Set<Awaited<ReturnType<typeof open>>>();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", "base64");
let pdf: Buffer;
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==", "base64");
before(async () => {
  const validationModule = await import("../../src/server/documents/validation.ts").catch(() => null);
  assert.ok(validationModule, "Private document content validation must be implemented.");
  validation = validationModule;
  const document = await PDFDocument.create();
  document.addPage([300, 300]).drawText("Synthetic fixture only");
  pdf = Buffer.from(await document.save({ useObjectStreams: false }));
  storage = await import("../../src/server/documents/storage.ts");
  root = await mkdtemp(join(tmpdir(), "smiley-private-files-"));
});
after(async () => { for (const handle of faultHandles) await handle.close(); if (root) { const target=resolve(root); assert.equal(dirname(target),resolve(tmpdir())); assert.ok(basename(target).startsWith("smiley-private-files-")); await rm(target, { recursive: true, force: true }); } });
test("allowed files require their actual content signatures and preserve a content hash", async () => {
  for (const fixture of [{ bytes: pdf, name: "evidence.pdf", mimeType: "application/pdf" }, { bytes: png, name: "scan.png", mimeType: "image/png" }, { bytes: jpeg, name: "scan.jpg", mimeType: "image/jpeg" }, { bytes: Buffer.from("Synthetic discharge note"), name: "note.txt", mimeType: "text/plain" }]) {
    const result = await validation.validateUpload(fixture);
    assert.deepEqual(result.bytes, fixture.bytes);
    assert.equal(result.mimeType, fixture.mimeType);
    assert.match(result.sha256, /^[a-f0-9]{64}$/u);
  }
});
test("MIME labels cannot disguise truncated or mismatched files", async () => {
  for (const fixture of [
    { bytes: Buffer.from("not a PDF"), name: "bill.pdf", mimeType: "application/pdf" },
    { bytes: pdf.subarray(0, pdf.length - 7), name: "bill.pdf", mimeType: "application/pdf" },
    { bytes: png.subarray(0, png.length - 12), name: "scan.png", mimeType: "image/png" },
    { bytes: Buffer.concat([png, Buffer.from("extra")]), name: "scan.png", mimeType: "image/png" },
    { bytes: jpeg.subarray(0, jpeg.length - 2), name: "scan.jpg", mimeType: "image/jpeg" },
    { bytes: png, name: "bill.pdf", mimeType: "application/pdf" },
  ]) await assert.rejects(validation.validateUpload(fixture), { status: 415 });
  const corrupted = Buffer.from(png); corrupted[29] ^= 1;
  await assert.rejects(validation.validateUpload({ bytes: corrupted, name: "scan.png", mimeType: "image/png" }), { status: 415 });
});
test("empty, oversized, executable, binary, HTML, SVG and invalid UTF-8 uploads are rejected", async () => {
  await assert.rejects(validation.validateUpload({ bytes: Buffer.alloc(0), name: "note.txt", mimeType: "text/plain" }), { status: 400 });
  await assert.rejects(validation.validateUpload({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1), name: "note.txt", mimeType: "text/plain" }), { status: 413 });
  for (const bytes of [Buffer.from("<html><script>alert(1)</script></html>"), Buffer.from("<svg xmlns='x'/>"), Buffer.from("text\u0000binary"), Buffer.from([0xff, 0xfe]), Buffer.from("MZsynthetic executable")]) {
    await assert.rejects(validation.validateUpload({ bytes, name: "note.txt", mimeType: "text/plain" }), { status: 415 });
  }
  await assert.rejects(validation.validateUpload({ bytes: Buffer.from("synthetic"), name: "program.exe", mimeType: "application/octet-stream" }), { status: 415 });
});
test("display filenames are bounded basenames without control characters", async () => {
  const result = await validation.validateUpload({ bytes: pdf, name: "..\\private/claim\r\n.pdf", mimeType: "application/pdf" });
  assert.equal(result.name, "claim.pdf");
  assert.ok((await validation.validateUpload({ bytes: pdf, name: "x".repeat(300) + ".pdf", mimeType: "application/pdf" })).name.length <= 255);
  await assert.rejects(validation.validateUpload({ bytes: pdf, name: "../", mimeType: "application/pdf" }), { status: 400 });
});
test("private storage writes exclusively and returns the original bytes", async () => {
  const adapter = storage.createLocalStorage(join(root, "objects"));
  const key = randomUUID();
  await adapter.write(key, png);
  assert.deepEqual(await adapter.read(key), png);
  await assert.rejects(adapter.write(key, pdf), { code: "EEXIST" });
  assert.deepEqual(await adapter.read(key), png, "An exclusive-key conflict must never remove or overwrite the original.");
  await adapter.remove(key); await adapter.remove(key);
  await assert.rejects(adapter.read(key), { code: "ENOENT" });
});
test("private keys reject traversal and storage roots cannot be public or build directories", async () => {
  const adapter = storage.createLocalStorage(join(root, "objects"));
  for (const key of ["../outside", "C:\\private", randomUUID() + "/../x", "not-a-uuid"]) {
    await assert.rejects(adapter.write(key, pdf), { status: 400 });
    await assert.rejects(adapter.read(key), { status: 400 });
    await assert.rejects(adapter.remove(key), { status: 400 });
  }
  assert.throws(() => storage.createLocalStorage(join(process.cwd(), "public", "documents")), { status: 400 });
  assert.throws(() => storage.createLocalStorage(join(process.cwd(), ".next", "documents")), { status: 400 });
});
test("storage failures do not overwrite existing files and oversized reads are bounded", async () => {
  const rootFile = join(root, "root-is-a-file");
  await writeFile(rootFile, "preserved");
  const invalid = storage.createLocalStorage(rootFile);
  await assert.rejects(invalid.write(randomUUID(), pdf));
  assert.equal(await readFile(rootFile, "utf8"), "preserved");
  const directory = join(root, "oversized");
  await mkdir(directory);
  const key = randomUUID(); await writeFile(join(directory, key), Buffer.alloc(5 * 1024 * 1024 + 1));
  await assert.rejects(storage.createLocalStorage(directory).read(key), { status: 413 });
});
test("stored symbolic links cannot expose a file outside private storage", async (context) => {
  const directory = join(root, "symlink");
  await mkdir(directory);
  const target = join(root, "outside.txt"); await writeFile(target, "private outside record");
  const key = randomUUID();
  try { await symlink(target, join(directory, key), "file"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") { context.skip("Windows account lacks local symbolic-link creation permission."); return; }
    throw error;
  }
  await assert.rejects(storage.createLocalStorage(directory).read(key), { status: 400 });
  await assert.rejects(storage.createLocalStorage(directory).remove(key), { status: 400 });
  assert.equal(await readFile(target, "utf8"), "private outside record");
});

test("non-ASCII bytes cannot impersonate an ASCII PDF signature", async () => {
  const disguised = Buffer.from(pdf);
  disguised[0] = 0xa5;
  await assert.rejects(validation.validateUpload({ bytes: disguised, name: "spoofed.pdf", mimeType: "application/pdf" }), { status: 415 });
});
test("a stat failure after exclusive creation closes the handle and removes its verified object", async () => {
  const directory = join(root, "initial-stat-failure");
  const key = randomUUID();
  let opened: Awaited<ReturnType<typeof open>> | undefined;
  const adapter = storage.createLocalStorage(directory, { openExclusive: async (target) => {
    opened = await open(target, "wx", 0o600);
    const handle = opened;
    faultHandles.add(handle);
    let statFailed = false;
    return {
      stat: async () => { if (!statFailed) { statFailed = true; throw new Error("Synthetic initial stat failure"); } return handle.stat({ bigint: true }); },
      writeFile: (bytes) => handle.writeFile(bytes), sync: () => handle.sync(), close: () => handle.close(),
    };
  } });
  await assert.rejects(adapter.write(key, pdf), /Synthetic initial stat failure/u);
  assert.equal(opened?.fd, -1, "Failed writes must close the real filesystem handle.");
  await assert.rejects(lstat(join(directory, key)), { code: "ENOENT" });
});

test("a final close failure is retried and removes the verified object", async () => {
  const directory = join(root, "final-close-failure");
  const key = randomUUID();
  let opened: Awaited<ReturnType<typeof open>> | undefined;
  const adapter = storage.createLocalStorage(directory, { openExclusive: async (target) => {
    opened = await open(target, "wx", 0o600);
    const handle = opened;
    faultHandles.add(handle);
    let closeFailed = false;
    return {
      stat: () => handle.stat({ bigint: true }), writeFile: (bytes) => handle.writeFile(bytes), sync: () => handle.sync(),
      close: async () => { if (!closeFailed) { closeFailed = true; throw new Error("Synthetic final close failure"); } await handle.close(); },
    };
  } });
  await assert.rejects(adapter.write(key, pdf), /Synthetic final close failure/u);
  assert.equal(opened?.fd, -1);
  await assert.rejects(lstat(join(directory, key)), { code: "ENOENT" });
});

test("a partial write failure removes only its incomplete private object", async () => {
  const directory = join(root, "partial-write-failure");
  const key = randomUUID();
  let opened: Awaited<ReturnType<typeof open>> | undefined;
  const adapter = storage.createLocalStorage(directory, { openExclusive: async (target) => {
    opened = await open(target, "wx", 0o600);
    const handle = opened;
    faultHandles.add(handle);
    return {
      stat: () => handle.stat({ bigint: true }),
      writeFile: async (bytes) => { await handle.writeFile(bytes.subarray(0, 8)); throw new Error("Synthetic partial write failure"); },
      sync: () => handle.sync(), close: () => handle.close(),
    };
  } });
  await assert.rejects(adapter.write(key, pdf), /Synthetic partial write failure/u);
  assert.equal(opened?.fd, -1);
  await assert.rejects(lstat(join(directory, key)), { code: "ENOENT" });
});

test("an unverifiable created object is preserved and its cleanup failure is surfaced", async () => {
  const directory = join(root, "unverified-identity");
  const key = randomUUID();
  let opened: Awaited<ReturnType<typeof open>> | undefined;
  const adapter = storage.createLocalStorage(directory, { openExclusive: async (target) => {
    opened = await open(target, "wx", 0o600);
    const handle = opened;
    faultHandles.add(handle);
    return {
      stat: async () => { throw new Error("Synthetic persistent stat failure"); },
      writeFile: (bytes) => handle.writeFile(bytes), sync: () => handle.sync(), close: () => handle.close(),
    };
  } });
  await assert.rejects(adapter.write(key, pdf), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /cleanup/u);
    assert.ok(error.errors.some((cause: unknown) => cause instanceof Error && /identity.*verified/u.test(cause.message)));
    return true;
  });
  assert.equal(opened?.fd, -1);
  assert.ok((await lstat(join(directory, key))).isFile(), "Unknown ownership must preserve the object.");
});

test("failed write cleanup cannot unlink an unrelated object replacing the created path", async () => {
  const directory = join(root, "replaced-object");
  await mkdir(directory);
  const replacement = join(directory, "existing-replacement.txt");
  const unrelated = Buffer.from("Unrelated synthetic object must survive");
  await writeFile(replacement, unrelated);
  const key = randomUUID();
  const adapter = storage.createLocalStorage(directory, { openExclusive: async (target) => {
    const handle = await open(target, "wx", 0o600);
    faultHandles.add(handle);
    return {
      stat: () => handle.stat({ bigint: true }),
      writeFile: async (bytes) => {
        await handle.writeFile(bytes.subarray(0, 8));
        await handle.close();
        await unlink(target);
        await rename(replacement, target);
        throw new Error("Synthetic replaced-path write failure");
      },
      sync: () => handle.sync(), close: () => handle.close(),
    };
  } });
  await assert.rejects(adapter.write(key, pdf), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /cleanup/u);
    return true;
  });
  assert.deepEqual(await readFile(join(directory, key)), unrelated);
});

test("marker-only PDF content cannot impersonate a parsed document", async () => {
  await assert.rejects(validation.validateUpload({ bytes: Buffer.from("%PDF-1.7\nnot a PDF object\n%%EOF\n"), name: "fake.pdf", mimeType: "application/pdf" }), { status: 415 });
  const empty = await PDFDocument.create();
  const noPages = Buffer.from(await empty.save({ addDefaultPage: false }));
  await assert.rejects(validation.validateUpload({ bytes: noPages, name: "empty.pdf", mimeType: "application/pdf" }), { status: 415 });
  const cyclic = await PDFDocument.create();
  cyclic.addPage([300, 300]);
  cyclic.getPages();
  cyclic.catalog.Pages().Kids().push(cyclic.catalog.get(PDFName.of("Pages"))!);
  cyclic.catalog.Pages().set(PDFName.of("Count"), PDFNumber.of(2));
  const badTree = Buffer.from(await cyclic.save({ addDefaultPage: false, useObjectStreams: false }));
  await assert.rejects(validation.validateUpload({ bytes: badTree, name: "cycle.pdf", mimeType: "application/pdf" }), { status: 415 });
});

test("CRC-valid PNG chunks require decodable compressed image data", async () => {
  const invalidCompression = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQAAAAAAAAAAAAAAABKvOYPAAAAAElFTkSuQmCC", "base64");
  await assert.rejects(validation.validateUpload({ bytes: invalidCompression, name: "fake.png", mimeType: "image/png" }), { status: 415 });
});

test("JPEG marker shells require a decodable frame and scan", async () => {
  const invalidFrame = Buffer.from([255,216,255,192,0,2,255,218,0,2,65,255,217]);
  await assert.rejects(validation.validateUpload({ bytes: invalidFrame, name: "fake.jpg", mimeType: "image/jpeg" }), { status: 415 });
  const oversizedFrame = Buffer.from(jpeg);
  const frame = oversizedFrame.indexOf(Buffer.from([255, 192]));
  assert.ok(frame > 0);
  oversizedFrame.writeUInt16BE(10000, frame + 5);
  oversizedFrame.writeUInt16BE(10000, frame + 7);
  await assert.rejects(validation.validateUpload({ bytes: oversizedFrame, name: "large-frame.jpg", mimeType: "image/jpeg" }), { status: 415 });
});

test("HTML fragments are rejected while ordinary comparison prose remains text", async () => {
  const prose = "Fictional value < amount; 3 < 5 and amount > value.";
  assert.equal((await validation.validateUpload({ bytes: Buffer.from(prose), name: "note.txt", mimeType: "text/plain" })).mimeType, "text/plain");
  for (const markup of ["<h1>Fictional invoice</h1>", "<details open><summary>Fictional note</summary></details>"]) {
    await assert.rejects(validation.validateUpload({ bytes: Buffer.from(markup), name: "fake.txt", mimeType: "text/plain" }), { status: 415 });
  }
});

async function compressedObjectPdf(contents: Buffer, objectCount: number, firstOffset: number) {
  const document = await PDFDocument.create();
  document.addPage([300, 300]);
  document.context.register(document.context.flateStream(contents, { Type: "ObjStm", N: objectCount, First: firstOffset }));
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

test("actual compressed object streams remain valid evidence PDFs", async () => {
  const document = await PDFDocument.create();
  document.addPage([300, 300]).drawText("Synthetic compressed PDF");
  const compressed = Buffer.from(await document.save({ useObjectStreams: true }));
  assert.ok(compressed.includes(Buffer.from("/ObjStm")), "Fixture must exercise compressed object parsing.");
  assert.deepEqual((await validation.validateUpload({ bytes: compressed, name: "compressed.pdf", mimeType: "application/pdf" })).bytes, compressed);
});

test("small compressed PDFs cannot allocate more than 16 MiB for one decoded stream", async () => {
  const header = Buffer.from("1000 0 ");
  const contents = Buffer.concat([header, Buffer.from("(" + "A".repeat(16 * 1024 * 1024 + 64) + ")")]);
  const bomb = await compressedObjectPdf(contents, 1, header.byteLength);
  assert.ok(bomb.byteLength < 100_000, "Fixture must be a small compressed upload, not an oversized request.");
  await assert.rejects(validation.validateUpload({ bytes: bomb, name: "expanded.pdf", mimeType: "application/pdf" }), { status: 415 });
  assert.equal((await validation.validateUpload({ bytes: pdf, name: "healthy.pdf", mimeType: "application/pdf" })).mimeType, "application/pdf");
});

test("object-stream counts are bounded before parsing or allocating offsets", async () => {
  const count = 10001;
  const header = Buffer.from(Array.from({ length: count }, (_, index) => String(1000 + index) + " " + String(index * 5) + " ").join(""));
  const bomb = await compressedObjectPdf(Buffer.concat([header, Buffer.from("null ".repeat(count))]), count, header.byteLength);
  assert.ok(bomb.byteLength < validation.MAX_DOCUMENT_BYTES);
  await assert.rejects(validation.validateUpload({ bytes: bomb, name: "many-objects.pdf", mimeType: "application/pdf" }), { status: 415 });
  assert.equal((await validation.validateUpload({ bytes: pdf, name: "healthy.pdf", mimeType: "application/pdf" })).mimeType, "application/pdf");
});

test("PDF validation allows only two active workers and a healthy retry after overload", async () => {
  const fixture = { bytes: pdf, name: "concurrent.pdf", mimeType: "application/pdf" };
  const outcomes = await Promise.allSettled([validation.validateUpload(fixture), validation.validateUpload(fixture), validation.validateUpload(fixture)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 2);
  const failures = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.status, 503);
  assert.match(failures[0].reason.message, /Retry shortly/u);
  assert.equal((await validation.validateUpload(fixture)).mimeType, "application/pdf");
});

test("multiple decoded streams share the 32 MiB cumulative allocation limit", async () => {
  const document = await PDFDocument.create();
  document.addPage([300, 300]);
  for (const objectNumber of [1000, 2000]) {
    const header = Buffer.from(String(objectNumber) + " 0 ");
    const contents = Buffer.concat([header, Buffer.from("null " + " ".repeat(8 * 1024 * 1024))]);
    document.context.register(document.context.flateStream(contents, { Type: "ObjStm", N: 1, First: header.byteLength }));
  }
  const bomb = Buffer.from(await document.save({ useObjectStreams: false }));
  assert.ok(bomb.byteLength < 100_000);
  await assert.rejects(validation.validateUpload({ bytes: bomb, name: "many-streams.pdf", mimeType: "application/pdf" }), { status: 415 });
  assert.equal((await validation.validateUpload({ bytes: pdf, name: "healthy.pdf", mimeType: "application/pdf" })).mimeType, "application/pdf");
});

test("PDF filter chains are capped before constructing composed decoders", async () => {
  const document = await PDFDocument.create();
  document.addPage([300, 300]);
  let encoded = Buffer.from("1000 0 null ");
  for (let index = 0; index < 9; index++) encoded = Buffer.from(encoded.toString("hex") + ">");
  document.context.register(document.context.stream(encoded, { Type: "ObjStm", N: 1, First: 7, Filter: Array(9).fill("ASCIIHexDecode") }));
  const chained = Buffer.from(await document.save({ useObjectStreams: false }));
  assert.ok(chained.byteLength < validation.MAX_DOCUMENT_BYTES);
  await assert.rejects(validation.validateUpload({ bytes: chained, name: "many-filters.pdf", mimeType: "application/pdf" }), { status: 415 });
  assert.equal((await validation.validateUpload({ bytes: pdf, name: "healthy.pdf", mimeType: "application/pdf" })).mimeType, "application/pdf");
});

test("worker startup errors release the slot and preserve healthy validation", async () => {
  const cwd = process.cwd();
  const noWorker = join(root, "missing-worker");
  await mkdir(noWorker);
  try {
    process.chdir(noWorker);
    await assert.rejects(validation.validateUpload({ bytes: pdf, name: "unavailable.pdf", mimeType: "application/pdf" }), { status: 415 });
  } finally { process.chdir(cwd); }
  assert.equal((await validation.validateUpload({ bytes: pdf, name: "healthy.pdf", mimeType: "application/pdf" })).mimeType, "application/pdf");
});

test("worker deadlines terminate a pathological XRef loop and permit healthy retry", { timeout: 10000 }, async () => {
  const document = await PDFDocument.create();
  document.addPage([300, 300]);
  document.context.register(document.context.stream(Buffer.from([0]), { Type: "XRef", Size: 1, Index: [0, 1], W: [0, 1_000_000_000_000, 0] }));
  const slow = Buffer.from(await document.save({ useObjectStreams: false }));
  await assert.rejects(validation.validateUpload({ bytes: slow, name: "pathological-xref.pdf", mimeType: "application/pdf" }), { status: 415 });
  assert.equal((await validation.validateUpload({ bytes: pdf, name: "healthy.pdf", mimeType: "application/pdf" })).mimeType, "application/pdf");
});
