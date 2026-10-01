import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, withActorTransaction, type Actor } from "../access";
import { branchScope, type Permission } from "../access/permissions";
import { writeAudit } from "../audit";
import { createLocalStorage, type PrivateStorage } from "./storage";
import { validateUpload } from "./validation";

const decimalId = z.string().max(19).regex(/^[1-9][0-9]*$/u)
  .refine((value) => /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= BigInt("9223372036854775807"));
const requestKey = z.string().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/u);
const uploadInput = z.object({
  bytes: z.instanceof(Uint8Array),
  name: z.string().min(1).max(1000),
  mimeType: z.string().min(1).max(150),
  documentType: z.string().trim().min(1).max(100),
  documentId: decimalId.optional(),
  idempotencyKey: requestKey,
}).strict();
const evidenceInput = z.object({
  revisionId: z.uuid(),
  fieldName: z.string().trim().min(1).max(150),
  sourceExcerpt: z.string().trim().min(1).max(10000),
  pageNumber: z.number().int().positive().max(2147483647).nullable().default(null),
  idempotencyKey: requestKey,
}).strict();

export type UploadDocumentInput = z.input<typeof uploadInput>;
export type SourceEvidenceInput = z.input<typeof evidenceInput>;
export type UploadResult = {
  caseId: string; documentId: string; revisionId: string; revisionNumber: number;
  version: number; eventId: string; idempotent: boolean;
};
export type EvidenceResult = {
  caseId: string; revisionId: string; evidenceId: string;
  version: number; eventId: string; idempotent: boolean;
};
export type DocumentDto = {
  id: string; type: string; name: string; verificationStatus: string; uploadedAt: string;
};
export type RevisionDto = {
  id: string; documentId: string; revisionNumber: number; name: string; mimeType: string;
  sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string;
};
export type EvidenceDto = {
  id: string; revisionId: string; fieldName: string; sourceExcerpt: string;
  pageNumber: number | null; recordedBy: string; createdAt: string; verificationStatus: "UNVERIFIED";
};
export type DocumentListing = {
  caseId: string; version: number; documents: DocumentDto[]; revisions: RevisionDto[]; evidence: EvidenceDto[];
};
type CaseRow = { claim_id: string; branch_id: string; claim_status: string; version: number };
type EventRow = { event_id: string; fingerprint: string; case_version: number; payload: Record<string, unknown> };

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
function parse<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AccessError(400, message);
  return result.data;
}
async function requireCase(client: PoolClient, actor: Actor, caseId: string, permission: Permission, lock = false): Promise<CaseRow> {
  if (!decimalId.safeParse(caseId).success) throw new AccessError(400, "Provide a valid case ID.");
  const selected = await client.query<CaseRow>(`SELECT claim_id::text,branch_id::text,claim_status,version
    FROM claims WHERE claim_id=$1 AND hospital_id=$2${lock ? " FOR UPDATE" : ""}`, [caseId, actor.hospitalId]);
  const current = selected.rows[0];
  if (!current || !branchScope(actor, permission).includes(current.branch_id)) {
    throw new AccessError(404, "The case is unavailable in your assigned branches.");
  }
  return current;
}
function requireOpen(current: CaseRow): void {
  if (current.claim_status === "CANCELLED") throw new AccessError(409, "Cancelled cases cannot receive new documents or source notes.");
}
async function previousEvent(client: PoolClient, actor: Actor, caseId: string, key: string, expectedFingerprint: string): Promise<EventRow | undefined> {
  const previous = await client.query<EventRow>("SELECT event_id,fingerprint,case_version,payload FROM claim_events WHERE hospital_id=$1 AND claim_id=$2 AND idempotency_key=$3", [actor.hospitalId, caseId, key]);
  if (!previous.rowCount) return undefined;
  if (previous.rows[0].fingerprint !== expectedFingerprint) throw new AccessError(409, "This request key was already used for different document information.");
  return previous.rows[0];
}
async function recordChange(client: PoolClient, actor: Actor, current: CaseRow, type: string, key: string,
  digest: string, payload: Record<string, unknown>): Promise<{ version: number; eventId: string }> {
  const version = current.version + 1;
  const eventId = randomUUID();
  await client.query("UPDATE claims SET version=$1 WHERE claim_id=$2 AND hospital_id=$3", [version, current.claim_id, actor.hospitalId]);
  await client.query(`INSERT INTO claim_events(event_id,hospital_id,branch_id,claim_id,actor_user_id,event_type,occurred_at,payload,idempotency_key,fingerprint,case_version)
    VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10)`, [eventId, actor.hospitalId, current.branch_id, current.claim_id, actor.userId, type, JSON.stringify(payload), key, digest, version]);
  return { version, eventId };
}

export async function listDocuments(headers: Headers, caseId: string): Promise<DocumentListing> {
  return withActorTransaction(headers, "document:read", undefined, async (client, actor) => {
    const current = await requireCase(client, actor, caseId, "document:read");
    const documents = await client.query<Omit<DocumentDto, "uploadedAt"> & { uploadedAt: Date | string }>(`SELECT claim_document_id::text AS id,document_type AS type,document_name AS name,
      verification_status AS "verificationStatus",uploaded_at AS "uploadedAt" FROM claim_documents
      WHERE claim_id=$1 AND hospital_id=$2 AND branch_id=$3 ORDER BY uploaded_at,claim_document_id`, [caseId, actor.hospitalId, current.branch_id]);
    const revisions = await client.query<Omit<RevisionDto, "createdAt"> & { createdAt: Date | string }>(`SELECT revision_id AS id,claim_document_id::text AS "documentId",revision_number AS "revisionNumber",
      original_name AS name,mime_type AS "mimeType",size_bytes::integer AS "sizeBytes",sha256,uploaded_by::text AS "uploadedBy",created_at AS "createdAt"
      FROM document_revisions WHERE claim_id=$1 AND hospital_id=$2 AND branch_id=$3 ORDER BY created_at,revision_number,revision_id`, [caseId, actor.hospitalId, current.branch_id]);
    const evidence = await client.query<Omit<EvidenceDto, "createdAt" | "verificationStatus"> & { createdAt: Date | string }>(`SELECT evidence_id AS id,revision_id AS "revisionId",field_name AS "fieldName",source_excerpt AS "sourceExcerpt",
      page_number AS "pageNumber",recorded_by::text AS "recordedBy",created_at AS "createdAt" FROM document_evidence
      WHERE claim_id=$1 AND hospital_id=$2 AND branch_id=$3 ORDER BY created_at,evidence_id`, [caseId, actor.hospitalId, current.branch_id]);
    return {
      caseId, version: current.version,
      documents: documents.rows.map((row) => ({ ...row, uploadedAt: timestamp(row.uploadedAt) })),
      revisions: revisions.rows.map((row) => ({ ...row, createdAt: timestamp(row.createdAt) })),
      evidence: evidence.rows.map((row) => ({ ...row, createdAt: timestamp(row.createdAt), verificationStatus: "UNVERIFIED" as const })),
    };
  });
}

export async function uploadDocument(headers: Headers, caseId: string, input: unknown, storage?: PrivateStorage): Promise<UploadResult> {
  let writtenKey: string | undefined;
  let usedStorage: PrivateStorage | undefined;
  let operationFinished = false;
  try {
    return await withActorTransaction(headers, "document:write", undefined, async (client, actor) => {
      const current = await requireCase(client, actor, caseId, "document:write", true);
      const value = parse(uploadInput, input, "Provide document bytes, filename, type, and a request key of at most 100 characters.");
      const validated = await validateUpload(value);
      const requestFingerprint = fingerprint({ caseId, documentId: value.documentId ?? null, documentType: value.documentType,
        name: validated.name, mimeType: validated.mimeType, sha256: validated.sha256, sizeBytes: validated.bytes.byteLength });
      const eventKey = `DOC-${value.idempotencyKey}`;
      const previous = await previousEvent(client, actor, caseId, eventKey, requestFingerprint);
      if (previous) return { caseId, documentId: String(previous.payload.documentId), revisionId: String(previous.payload.revisionId),
        revisionNumber: Number(previous.payload.revisionNumber), version: previous.case_version, eventId: previous.event_id, idempotent: true };
      requireOpen(current);

      let documentId = value.documentId;
      if (documentId) {
        const found = await client.query("SELECT document_type FROM claim_documents WHERE claim_document_id=$1 AND claim_id=$2 AND hospital_id=$3 AND branch_id=$4", [documentId, caseId, actor.hospitalId, current.branch_id]);
        if (!found.rowCount) throw new AccessError(404, "The document is unavailable for this case.");
        if (found.rows[0].document_type !== value.documentType) throw new AccessError(409, "A revision must retain the original document category.");
      } else {
        const created = await client.query<{ id: string }>(`INSERT INTO claim_documents(hospital_id,branch_id,claim_id,document_type,document_name,file_path,file_hash,uploaded_by,verification_status)
          VALUES($1,$2,$3,$4,$5,NULL,$6,$7,'PENDING') RETURNING claim_document_id::text AS id`, [actor.hospitalId, current.branch_id, caseId, value.documentType, validated.name, validated.sha256, actor.userId]);
        documentId = created.rows[0].id;
      }
      const sequence = await client.query<{ number: number }>("SELECT COALESCE(max(revision_number),0)+1 AS number FROM document_revisions WHERE hospital_id=$1 AND claim_document_id=$2", [actor.hospitalId, documentId]);
      const revisionNumber = sequence.rows[0].number;
      const revisionId = randomUUID();
      const storageKey = randomUUID();
      usedStorage = storage ?? createLocalStorage();
      await usedStorage.write(storageKey, validated.bytes);
      writtenKey = storageKey;
      await client.query(`INSERT INTO document_revisions(revision_id,hospital_id,branch_id,claim_id,claim_document_id,revision_number,storage_key,sha256,size_bytes,mime_type,original_name,uploaded_by,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [revisionId, actor.hospitalId, current.branch_id, caseId, documentId, revisionNumber, storageKey,
        validated.sha256, String(validated.bytes.byteLength), validated.mimeType, validated.name, actor.userId, value.idempotencyKey]);
      const payload = { documentId, revisionId, revisionNumber, documentType: value.documentType, name: validated.name,
        mimeType: validated.mimeType, sizeBytes: validated.bytes.byteLength, sha256: validated.sha256 };
      const result = await recordChange(client, actor, current, "DOCUMENT_UPLOADED", eventKey, requestFingerprint, payload);
      await writeAudit(client, actor, current.branch_id, "documents", "DOCUMENT_UPLOADED", documentId, null, { ...payload, version: result.version });
      operationFinished = true;
      return { caseId, documentId, revisionId, revisionNumber, ...result, idempotent: false };
    });
  } catch (error) {
    // A failed operation never reached COMMIT. Preserve the object if a completed
    // operation lost its COMMIT acknowledgement, since its outcome is uncertain.
    const knownCommitRejection = ["23503", "23505", "23514", "40001", "40P01"].includes((error as { code?: string })?.code ?? "");
    if (writtenKey && usedStorage && (!operationFinished || knownCommitRejection)) {
      try { await usedStorage.remove(writtenKey); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], "Document transaction failed and its new private object could not be removed."); }
    }
    throw error;
  }
}

export async function addSourceEvidence(headers: Headers, caseId: string, input: unknown): Promise<EvidenceResult> {
  return withActorTransaction(headers, "document:write", undefined, async (client, actor) => {
    const current = await requireCase(client, actor, caseId, "document:write", true);
    const value = parse(evidenceInput, input, "Provide a revision, field, source excerpt, positive page number or no page, and request key.");
    const requestFingerprint = fingerprint({ caseId, revisionId: value.revisionId, fieldName: value.fieldName, sourceExcerpt: value.sourceExcerpt, pageNumber: value.pageNumber });
    const eventKey = `EVID-${value.idempotencyKey}`;
    const previous = await previousEvent(client, actor, caseId, eventKey, requestFingerprint);
    if (previous) return { caseId, revisionId: String(previous.payload.revisionId), evidenceId: String(previous.payload.evidenceId),
      version: previous.case_version, eventId: previous.event_id, idempotent: true };
    requireOpen(current);
    const revision = await client.query<{ documentId: string }>("SELECT claim_document_id::text AS \"documentId\" FROM document_revisions WHERE revision_id=$1 AND claim_id=$2 AND hospital_id=$3 AND branch_id=$4", [value.revisionId, caseId, actor.hospitalId, current.branch_id]);
    if (!revision.rowCount) throw new AccessError(404, "The source revision is unavailable for this case.");
    const evidenceId = randomUUID();
    await client.query(`INSERT INTO document_evidence(evidence_id,hospital_id,branch_id,claim_id,revision_id,page_number,field_name,source_excerpt,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [evidenceId, actor.hospitalId, current.branch_id, caseId, value.revisionId, value.pageNumber, value.fieldName, value.sourceExcerpt, actor.userId]);
    const payload = { evidenceId, revisionId: value.revisionId, documentId: revision.rows[0].documentId, fieldName: value.fieldName,
      sourceExcerpt: value.sourceExcerpt, pageNumber: value.pageNumber, verificationStatus: "UNVERIFIED" };
    const result = await recordChange(client, actor, current, "SOURCE_EVIDENCE_ADDED", eventKey, requestFingerprint, payload);
    await writeAudit(client, actor, current.branch_id, "documents", "SOURCE_EVIDENCE_ADDED", revision.rows[0].documentId, null, { ...payload, version: result.version });
    return { caseId, revisionId: value.revisionId, evidenceId, ...result, idempotent: false };
  });
}

export async function downloadDocument(headers: Headers, revisionId: string, storage?: PrivateStorage): Promise<{ bytes: Buffer; name: string; mimeType: string }> {
  return withActorTransaction(headers, "document:read", undefined, async (client, actor) => {
    if (!z.uuid().safeParse(revisionId).success) throw new AccessError(400, "Provide a valid document revision ID.");
    const selected = await client.query<{ claimId: string; branchId: string; storageKey: string; sha256: string; sizeBytes: string; name: string; mimeType: string }>(`SELECT r.claim_id::text AS "claimId",r.branch_id::text AS "branchId",r.storage_key AS "storageKey",r.sha256,r.size_bytes::text AS "sizeBytes",r.original_name AS name,r.mime_type AS "mimeType"
      FROM document_revisions r JOIN claims c ON c.claim_id=r.claim_id AND c.hospital_id=r.hospital_id AND c.branch_id=r.branch_id
      WHERE r.revision_id=$1 AND r.hospital_id=$2`, [revisionId, actor.hospitalId]);
    const revision = selected.rows[0];
    if (!revision || !branchScope(actor, "document:read").includes(revision.branchId)) throw new AccessError(404, "The document is unavailable in your assigned branches.");
    const bytes = await (storage ?? createLocalStorage()).read(revision.storageKey);
    if (BigInt(bytes.byteLength) !== BigInt(revision.sizeBytes) || createHash("sha256").update(bytes).digest("hex") !== revision.sha256) {
      throw new AccessError(409, "The stored document failed its integrity check.");
    }
    return { bytes, name: revision.name, mimeType: revision.mimeType };
  });
}
