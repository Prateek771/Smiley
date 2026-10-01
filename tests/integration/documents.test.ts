import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { before, after, test } from "node:test";
import { migrationPool, closePools } from "../../src/server/db/client";
import { seedSynthetic } from "../../src/server/db/seed";
import { auth } from "../../src/server/auth";
import { seedAuthUsers } from "../../src/server/auth/seed";
import { createCase, getDeskData } from "../../src/server/cases";
import { addSourceEvidence, downloadDocument, listDocuments, uploadDocument } from "../../src/server/documents";
import { createLocalStorage, type PrivateStorage } from "../../src/server/documents/storage";

let users: Awaited<ReturnType<typeof seedAuthUsers>>;
const sessions = new Map<string, Headers>();
let storage: PrivateStorage;
let storageRoot: string;
let caseId: string;
before(async () => {
  assert.match((await migrationPool.query("SELECT current_database() AS name")).rows[0].name, /_test$/u);
  await seedSynthetic(); users = await seedAuthUsers();
  for (const key of ["deskA", "deskNorthA", "deskB", "billingA", "adminA"] as const) {
    const login = await auth.api.signInEmail({ body: { email: users[key].email, password: users[key].password }, asResponse: true });
    assert.equal(login.status, 200);
    sessions.set(key, new Headers({ cookie: login.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ") }));
  }
  storageRoot = await mkdtemp(resolve("tmp", "document-integration-"));
  storage = createLocalStorage(storageRoot);
  const data = await getDeskData(sessions.get("deskA")!);
  const encounter = data.encounters.find((row) => row.branchId === users.deskA.branchId)!;
  const membership = data.memberships.find((row) => row.patientId === encounter.patientId)!;
  caseId = (await createCase(sessions.get("deskA")!, { branchId: encounter.branchId, patientId: encounter.patientId,
    encounterId: encounter.id, patientInsuranceId: membership.id, ownerId: users.deskA.userId,
    nextAction: "Inspect synthetic document evidence", creationKey: randomUUID() })).id;
});
after(closePools);
const staff = (key = "deskA") => sessions.get(key)!;
const file = (text = "Fictional discharge note\nSynthetic patient only", overrides: Record<string, unknown> = {}) => ({
  name: "discharge-note.txt", mimeType: "text/plain", bytes: Buffer.from(text), documentType: "DISCHARGE_SUMMARY",
  idempotencyKey: randomUUID(), ...overrides,
});

test("a private upload records metadata, history and audit without exposing its storage key", async () => {
  const input = file();
  const result = await uploadDocument(staff(), caseId, input, storage);
  assert.equal(result.revisionNumber, 1); assert.equal(result.idempotent, false);
  const listing = await listDocuments(staff(), caseId);
  const revision = listing.revisions.find((row) => row.id === result.revisionId)!;
  assert.equal(revision.name, input.name); assert.equal(revision.mimeType, "text/plain");
  assert.equal("storageKey" in revision, false); assert.equal("filePath" in revision, false);
  const download = await downloadDocument(staff(), result.revisionId, storage);
  assert.deepEqual(download.bytes, input.bytes);
  assert.equal(download.name, input.name);
  const recorded = await migrationPool.query("SELECT count(*)::int AS count FROM claim_events WHERE claim_id=$1 AND event_type='DOCUMENT_UPLOADED' AND payload->>'revisionId'=$2", [caseId, result.revisionId]);
  assert.equal(recorded.rows[0].count, 1);
  const audit = await migrationPool.query("SELECT count(*)::int AS count FROM audit_logs WHERE module_name='documents' AND new_data->>'revisionId'=$1 AND action_name='DOCUMENT_UPLOADED'", [result.revisionId]);
  assert.equal(audit.rows[0].count, 1);
});
test("a revision preserves original bytes and source notes remain pinned to the selected revision", async () => {
  const one = await uploadDocument(staff(), caseId, file("First fictional version"), storage);
  const note = await addSourceEvidence(staff(), caseId, { revisionId: one.revisionId, fieldName: "Discharge date", sourceExcerpt: "Date requires staff review", pageNumber: null, idempotencyKey: randomUUID() });
  const two = await uploadDocument(staff(), caseId, file("Second fictional version", { documentId: one.documentId }), storage);
  assert.equal(two.documentId, one.documentId); assert.equal(two.revisionNumber, 2);
  assert.equal((await downloadDocument(staff(), one.revisionId, storage)).bytes.toString(), "First fictional version");
  assert.equal((await downloadDocument(staff(), two.revisionId, storage)).bytes.toString(), "Second fictional version");
  const listing = await listDocuments(staff(), caseId);
  assert.equal(listing.evidence.find((row) => row.id === note.evidenceId)?.revisionId, one.revisionId);
});
test("concurrent retries with one key produce one file, revision, event and case version increment", async () => {
  const input = file();
  const before = (await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [caseId])).rows[0].version;
  const results = await Promise.all([uploadDocument(staff(), caseId, input, storage), uploadDocument(staff(), caseId, input, storage)]);
  assert.equal(results[0].revisionId, results[1].revisionId);
  assert.equal(results.filter((row) => row.idempotent).length, 1);
  assert.equal((await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [caseId])).rows[0].version, before + 1);
  assert.equal((await migrationPool.query("SELECT count(*)::int AS count FROM document_revisions WHERE claim_id=$1 AND idempotency_key=$2", [caseId, input.idempotencyKey])).rows[0].count, 1);
});
test("reusing an upload key with different bytes or metadata is rejected", async () => {
  const input = file(); await uploadDocument(staff(), caseId, input, storage);
  await assert.rejects(uploadDocument(staff(), caseId, { ...input, bytes: Buffer.from("Changed content") }, storage), { status: 409 });
  await assert.rejects(uploadDocument(staff(), caseId, { ...input, documentType: "FINAL_BILL" }, storage), { status: 409 });
});
test("other hospitals, unassigned branches, anonymous requests and billing uploads are denied", async () => {
  const doc = await uploadDocument(staff(), caseId, file(), storage);
  for (const actor of [staff("deskB"), staff("deskNorthA")]) {
    await assert.rejects(downloadDocument(actor, doc.revisionId, storage), { status: 404 });
    await assert.rejects(uploadDocument(actor, caseId, file(), storage), { status: 404 });
  }
  await assert.rejects(uploadDocument(staff("billingA"), caseId, file(), storage), { status: 403 });
  await assert.rejects(downloadDocument(new Headers(), doc.revisionId, storage), { status: 401 });
  assert.ok((await downloadDocument(staff("billingA"), doc.revisionId, storage)).bytes.length > 0);
});
test("a revoked session loses document access immediately", async () => {
  const doc = await uploadDocument(staff(), caseId, file(), storage);
  const login = await auth.api.signInEmail({ body: { email: users.deskA.email, password: users.deskA.password }, asResponse: true });
  const cookie = new Headers({ cookie: login.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ") });
  await auth.api.signOut({ headers: cookie });
  await assert.rejects(downloadDocument(cookie, doc.revisionId, storage), { status: 401 });
});

test("malformed case and logical document IDs return validation errors", async () => {
  for (const malformed of ["abc", "1.2", "0", "-1", "9223372036854775808"]) {
    await assert.rejects(listDocuments(staff(), malformed), { status: 400 });
    await assert.rejects(uploadDocument(staff(), malformed, file(), storage), { status: 400 });
    await assert.rejects(uploadDocument(staff(), caseId, file("Invalid logical ID", { documentId: malformed }), storage), { status: 400 });
  }
});
test("storage failure does not commit a document, revision, version or audit", async () => {
  const input = file();
  const current = (await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [caseId])).rows[0].version;
  const broken: PrivateStorage = { ...storage, write: async () => { throw new Error("Synthetic storage outage"); } };
  await assert.rejects(uploadDocument(staff(), caseId, input, broken), /storage outage/u);
  assert.equal((await migrationPool.query("SELECT count(*)::int AS count FROM document_revisions WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0].count, 0);
  assert.equal((await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [caseId])).rows[0].version, current);
});
test("a database rejection after file write rolls back metadata and removes the new private object", async () => {
  const initial = (await readdir(storageRoot)).length;
  await migrationPool.query(`CREATE FUNCTION synthetic_document_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.original_name='synthetic-db-reject.txt' THEN RAISE EXCEPTION 'Synthetic transaction rejection'; END IF; RETURN NEW; END $$`);
  await migrationPool.query("CREATE TRIGGER synthetic_document_failure BEFORE INSERT ON document_revisions FOR EACH ROW EXECUTE FUNCTION synthetic_document_failure()");
  const input = file("Synthetic rejected bytes", { name: "synthetic-db-reject.txt" });
  try { await assert.rejects(uploadDocument(staff(), caseId, input, storage), /Synthetic transaction rejection/u); }
  finally {
    await migrationPool.query("DROP TRIGGER synthetic_document_failure ON document_revisions");
    await migrationPool.query("DROP FUNCTION synthetic_document_failure()");
  }
  assert.equal((await readdir(storageRoot)).length, initial);
  assert.equal((await migrationPool.query("SELECT count(*)::int AS count FROM document_revisions WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0].count, 0);
});
test("manual source notes validate page numbers, reject foreign revisions and safely retry", async () => {
  const doc = await uploadDocument(staff(), caseId, file(), storage);
  const input = { revisionId: doc.revisionId, fieldName: "Review note", sourceExcerpt: "Synthetic excerpt, unverified", pageNumber: 1, idempotencyKey: randomUUID() };
  const a = await addSourceEvidence(staff(), caseId, input);
  const b = await addSourceEvidence(staff(), caseId, input);
  assert.equal(a.evidenceId, b.evidenceId);
  await assert.rejects(addSourceEvidence(staff(), caseId, { ...input, sourceExcerpt: "Changed excerpt" }), { status: 409 });
  await assert.rejects(addSourceEvidence(staff(), caseId, { ...input, idempotencyKey: randomUUID(), pageNumber: 0 }), { status: 400 });
  await assert.rejects(addSourceEvidence(staff("deskB"), caseId, input), { status: 404 });
  await assert.rejects(addSourceEvidence(staff(), caseId, { ...input, idempotencyKey: randomUUID(), revisionId: randomUUID() }), { status: 404 });
});
test("stored-byte tampering fails an integrity check before download", async () => {
  const input = file(); const result = await uploadDocument(staff(), caseId, input, storage);
  const damaged: PrivateStorage = { ...storage, read: async () => Buffer.from("Different synthetic bytes") };
  await assert.rejects(downloadDocument(staff(), result.revisionId, damaged), { status: 409 });
});

test("committed document/evidence retries survive cancellation while new writes are rejected", async () => {
  const data = await getDeskData(staff());
  const encounter = data.encounters.find((row) => row.branchId === users.deskA.branchId)!;
  const membership = data.memberships.find((row) => row.patientId === encounter.patientId)!;
  const isolatedCaseId = (await createCase(staff(), { branchId: encounter.branchId, patientId: encounter.patientId,
    encounterId: encounter.id, patientInsuranceId: membership.id, ownerId: users.deskA.userId,
    nextAction: "Synthetic document cancellation retry case", creationKey: randomUUID() })).id;
  const uploadInput = file("Synthetic cancellation retry document");
  const uploaded = await uploadDocument(staff(), isolatedCaseId, uploadInput, storage);
  const evidenceInput = { revisionId: uploaded.revisionId, fieldName: "Retry evidence", sourceExcerpt: "Synthetic manual note", pageNumber: null, idempotencyKey: randomUUID() };
  const evidence = await addSourceEvidence(staff(), isolatedCaseId, evidenceInput);
  const { applyCaseAction } = await import("../../src/server/timeline");
  const version = (await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [isolatedCaseId])).rows[0].version;
  await applyCaseAction(staff(), isolatedCaseId, { expectedVersion: version, idempotencyKey: randomUUID(), action: { type: "status", status: "CANCELLED", reason: "Synthetic retry-after-cancellation regression" } });
  const afterCancellation = (await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [isolatedCaseId])).rows[0].version;
  const retryUpload = await uploadDocument(staff(), isolatedCaseId, uploadInput, storage);
  const retryEvidence = await addSourceEvidence(staff(), isolatedCaseId, evidenceInput);
  assert.equal(retryUpload.revisionId, uploaded.revisionId);
  assert.equal(retryUpload.idempotent, true);
  assert.equal(retryEvidence.evidenceId, evidence.evidenceId);
  assert.equal(retryEvidence.idempotent, true);
  assert.equal((await migrationPool.query("SELECT version FROM claims WHERE claim_id=$1", [isolatedCaseId])).rows[0].version, afterCancellation);
  await assert.rejects(uploadDocument(staff(), isolatedCaseId, file(), storage), { status: 409 });
  await assert.rejects(addSourceEvidence(staff(), isolatedCaseId, { ...evidenceInput, idempotencyKey: randomUUID() }), { status: 409 });
});
