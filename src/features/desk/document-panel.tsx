"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DocumentListing } from "@/server/documents";
import styles from "./desk.module.css";

export function DocumentPanel({ listing, canUpload }: { listing: DocumentListing; canUpload: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [documentPurpose, setDocumentPurpose] = useState("DISCHARGE_SUMMARY");
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const uploadRetry = useRef<{ content: string; key: string } | null>(null);
  const sourceRetry = useRef<{ content: string; key: string } | null>(null);
  async function send(url: string, body: BodyInit, json: boolean): Promise<boolean> {
    setPending(true); setNotice(null);
    try {
      const response = await fetch(url, { method: "POST", ...(json ? { headers: { "content-type": "application/json" } } : {}), body });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setNotice({ error: true, text: data.error ?? "The document change could not be saved." }); return false; }
      setNotice({ error: false, text: json ? "Source note saved against this revision; staff review is still required." : "Private document saved. Original revisions retained." });
      router.refresh(); return true;
    } catch { setNotice({ error: true, text: "Connection interrupted. Retry with the same file or source note." }); return false; }
    finally { setPending(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    setPending(true); setNotice(null);
    try {
      if (!(file instanceof File) || !file.size) {
        setNotice({ error: true, text: "Choose a non-empty document file." }); return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setNotice({ error: true, text: "Documents must be at most 5 MiB." }); return;
      }
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const content = JSON.stringify({ sha256, name: file.name, mimeType: file.type, size: file.size,
        documentType: String(form.get("documentType")), documentId: String(form.get("documentId")) });
      if (uploadRetry.current?.content !== content) uploadRetry.current = { content, key: crypto.randomUUID() };
      form.set("idempotencyKey", uploadRetry.current.key);
      if (await send(`/api/cases/${listing.caseId}/documents`, form, false)) uploadRetry.current = null;
    } catch { setNotice({ error: true, text: "The file could not be read. Choose it again and retry." }); }
    finally { setPending(false); }
  }
  async function source(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const body = { revisionId: String(form.get("revisionId")), fieldName: String(form.get("fieldName")), sourceExcerpt: String(form.get("sourceExcerpt")), pageNumber: form.get("pageNumber") ? Number(form.get("pageNumber")) : null };
    const content = JSON.stringify(body);
    if (sourceRetry.current?.content !== content) sourceRetry.current = { content, key: crypto.randomUUID() };
    if (await send(`/api/cases/${listing.caseId}/evidence`, JSON.stringify({ ...body, idempotencyKey: sourceRetry.current.key }), true)) sourceRetry.current = null;
  }
  return <section aria-label="Private documents" className={`${styles.card} ${styles.full} ${styles.actionPanels}`}><h2>Private documents and revisions</h2><p className={styles.muted}>Synthetic files only. PDF, PNG, JPEG or UTF-8 text; maximum 5 MiB. Downloads require current staff access.</p>
    {notice && <p className={notice.error ? styles.alert : styles.success} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    {listing.revisions.length ? <ul className={styles.timeline}>{listing.revisions.map((revision) => <li key={revision.id}>
      <a className={styles.back} href={`/api/documents/${revision.id}/download`}>Download {revision.name} revision {revision.revisionNumber}</a>
      <p className={styles.muted}>{revision.mimeType} · {revision.sizeBytes} bytes · staff {revision.uploadedBy} · {new Date(revision.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
      {listing.evidence.filter((note) => note.revisionId === revision.id).map((note) => <p className={styles.action} key={note.id}><span>{note.fieldName} · {note.pageNumber ? `page ${note.pageNumber}` : "page not specified"} · manual source note, unverified</span>{note.sourceExcerpt}</p>)}
    </li>)}</ul> : <p className={styles.action}>No documents uploaded yet.</p>}
    {canUpload && <div className={styles.grid}>
      <section aria-label="Upload private document"><h3>Upload a document or revision</h3><form className={styles.form} onSubmit={(event) => void upload(event)}>
        <label className={styles.field}>Document purpose<input name="documentType" maxLength={100} value={documentPurpose} onChange={(event) => setDocumentPurpose(event.target.value)} required /></label>
        <label className={styles.field}>Existing document<select name="documentId" defaultValue="" onChange={(event) => { const original = listing.documents.find((document) => document.id === event.target.value); if (original) setDocumentPurpose(original.type); }}><option value="">Create a new document</option>{listing.documents.map((document) => <option key={document.id} value={document.id}>{document.name} · {document.type}</option>)}</select></label>
        <label className={styles.field}>Document file<input name="file" type="file" accept="application/pdf,image/png,image/jpeg,text/plain" required /></label>
        <button className={styles.button} disabled={pending}>Upload private document</button>
      </form></section>
      <section aria-label="Record source note"><h3>Record a source note</h3><p className={styles.muted}>A manual excerpt stays attached to its exact revision. Verification and extraction follow in later phases.</p><form className={styles.form} onSubmit={(event) => void source(event)}>
        <label className={styles.field}>Source revision<select name="revisionId" required>{listing.revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.name} · revision {revision.revisionNumber}</option>)}</select></label>
        <label className={styles.field}>Field or topic<input name="fieldName" maxLength={150} required /></label><label className={styles.field}>Page number (optional)<input name="pageNumber" type="number" min={1} max={2147483647} /></label>
        <label className={styles.field}>Source excerpt<textarea name="sourceExcerpt" maxLength={10000} required /></label><button className={styles.button} disabled={pending || !listing.revisions.length}>Save source note</button>
      </form></section>
    </div>}
  </section>;
}
