"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CaseAI } from "@/server/ai";
import type { DocumentListing } from "@/server/documents";
import styles from "./desk.module.css";

export function AIPanel({ caseId, version, ownerId, data, documents, queries, canAct }: { caseId: string; version: number; ownerId: string; data: CaseAI; documents: DocumentListing; queries: { reference: string; status: string }[]; canAct: boolean }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [notice, setNotice] = useState("");
  const [kind, setKind] = useState("EXTRACTION"); const [retryOf, setRetryOf] = useState("");
  const retry = useRef<{ content: string; key: string } | null>(null);
  const latest = documents.revisions.filter((revision) => !documents.revisions.some((other) => other.documentId === revision.documentId && other.revisionNumber > revision.revisionNumber));
  async function send(mode: string, input: Record<string, unknown>) {
    if (pending) return; setPending(true); setNotice("");
    const content = JSON.stringify({ mode, input });
    if (retry.current?.content !== content) retry.current = { content, key: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/cases/${caseId}/ai`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, input: { ...input, idempotencyKey: retry.current.key } }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "The action could not be saved.");
      retry.current = null; setNotice(mode === "request" ? "AI work queued. Refresh to see progress." : "Staff review saved separately from the AI suggestion."); router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Connection interrupted. Retry the same input."); }
    finally { setPending(false); }
  }
  function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void send("request", { kind, expectedVersion: version, revisionIds: form.getAll("revisionId"), synthetic: form.get("synthetic") === "on", ...(kind === "RESPONSE_DRAFT" ? { queryReference: form.get("queryReference") } : {}), ...(retryOf ? { retryOf } : {}) });
  }
  function review(event: FormEvent<HTMLFormElement>, runId: string, itemIndex: number) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const action = String(form.get("action"));
    void send("review", { runId, itemIndex, action, ...(action === "CORRECT" ? { value: String(form.get("value")) } : {}), reason: String(form.get("reason")), verified: form.get("verified") === "on", expectedVersion: version });
  }
  return <section className={`${styles.card} ${styles.actionPanels}`} aria-label="AI evidence and staff review"><h2>AI evidence and staff review</h2>
    <p className={styles.muted}>Review extracted facts and draft wording against the original evidence. Financial and payer decisions require their separate staff actions. The current cloud connector supports test documents only; use manual source notes for other documents until hospital external processing is approved.</p>
    <p className={styles.muted}>Cloud extraction supports files up to 1 MB and PDFs up to 3 pages. UTF-8 source text is read directly. Original documents and manual source notes remain available above.</p>
    {notice && <p role="status" className={styles.action}>{notice}</p>}
    {canAct && <form className={styles.form} onSubmit={request}>
      <label className={styles.field}>AI task<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="EXTRACTION">Extract source facts</option><option value="PACK_CHECK">Check claim evidence pack</option><option value="RESPONSE_DRAFT">Prepare payer query draft</option></select></label>
      <fieldset><legend>Current source revisions {kind === "EXTRACTION" ? "(choose one)" : "(choose up to twelve)"}</legend>{latest.map((revision) => <label key={revision.id} className={styles.field}><span><input name="revisionId" type={kind === "EXTRACTION" ? "radio" : "checkbox"} value={revision.id} required={kind === "EXTRACTION"} /> {revision.name} · revision {revision.revisionNumber} · {documents.documents.find((document) => document.id === revision.documentId)?.type}</span></label>)}</fieldset>
      {kind === "RESPONSE_DRAFT" && <label className={styles.field}>Unresolved payer query<select name="queryReference" required><option value="">Choose a query</option>{queries.filter((query) => query.status !== "RESOLVED").map((query) => <option key={query.reference} value={query.reference}>{query.reference}</option>)}</select></label>}
      <label className={styles.field}><span><input name="synthetic" type="checkbox" required /> I verified these files contain fictional data and may be sent to OCR.space and OpenRouter.</span></label>
      {retryOf && <p>Recovery will use the current selected evidence. <button type="button" className={styles.secondary} onClick={() => setRetryOf("")}>Cancel recovery</button></p>}
      <button className={styles.button} disabled={pending || !latest.length}>{retryOf ? "Request recovery with current inputs" : "Request AI review"}</button>
    </form>}
    <button type="button" className={styles.secondary} onClick={() => router.refresh()}>Refresh AI status</button>
    {data.runs.length === 0 && <p>No AI review requested.</p>}
    <ul className={styles.timeline}>{data.runs.map((run) => <li key={run.id}>
      <h3>{run.kind.replaceAll("_", " ")} · {run.status}</h3><p className={styles.muted}>Source case version {run.inputVersion} · attempt {run.attempts} of 3 · staff {run.ownerId}</p>{run.reason && <p>{run.reason}</p>}
      {run.result && <>
        {run.result.missing.length > 0 && <p className={styles.alert}>Missing evidence categories: {run.result.missing.join(", ")}</p>}
        {run.result.conflicts?.map((conflict) => <div key={conflict.field} className={styles.alert}><strong>Possible inconsistent {conflict.field.replaceAll("_", " ")} — staff review required</strong><ul>{conflict.values.map((value, index) => <li key={index}>{value.value} · <a href={`/api/documents/${value.revisionId}/download`}>source page {value.pageNumber}</a> · “{value.quote}”</li>)}</ul></div>)}
        <details><summary>OCR source pages and positions</summary>{run.result.sources.map((source) => <div key={source.revisionId}><a href={`/api/documents/${source.revisionId}/download`}>Open original {source.documentType}</a>{source.pages.map((page) => <details key={page.pageNumber}><summary>Page {page.pageNumber} · confidence unavailable</summary><pre style={{ whiteSpace: "pre-wrap" }}>{page.text}</pre>{page.words.length > 0 && <details><summary>Word positions in OCR page pixels</summary><ul>{page.words.map((word, index) => <li key={index}>{word.text}: left {word.left}, top {word.top}, width {word.width}, height {word.height}</li>)}</ul></details>}</details>)}</div>)}</details>
        {[...run.result.facts.map((fact, index) => ({ index, text: `${fact.field}: ${fact.value}`, quote: fact.quote, page: fact.pageNumber, revisionId: fact.revisionId, value: fact.value })), ...(run.result.draft ? [{ index: -1, text: run.result.draft, quote: "", page: null, revisionId: null, value: run.result.draft }] : [])].map((item) => <div className={styles.card} key={item.index}>
          <p style={{ whiteSpace: "pre-wrap" }}>{item.text}</p>{item.revisionId && <p><a href={`/api/documents/${item.revisionId}/download`}>Original source · page {item.page}</a>: “{item.quote}”</p>}
          {data.reviews.filter((record) => record.runId === run.id && record.itemIndex === item.index).map((record) => <p key={record.id} className={styles.action}><strong>{record.action}</strong> · staff {record.actorId} · {record.reason}{record.value && <span style={{ whiteSpace: "pre-wrap" }}>{record.value}</span>}</p>)}
          {canAct && run.inputVersion === version && <form className={styles.form} onSubmit={(event) => review(event, run.id, item.index)}>
            <label className={styles.field}>Review action<select name="action"><option value="ACCEPT">Accept source suggestion</option><option value="CORRECT">Correct after checking source</option><option value="REJECT">Reject suggestion</option></select></label>
            <label className={styles.field}>Replacement (correction only)<textarea name="value" defaultValue={item.value} maxLength={20000} /></label>
            <label className={styles.field}>Review reason<input name="reason" required maxLength={2000} /></label>
            <label className={styles.field}><span><input name="verified" type="checkbox" required /> I checked the current original source.</span></label>
            <button className={styles.button} disabled={pending}>Save staff review</button>
          </form>}
        </div>)}
      </>}
      {canAct && run.ownerId === ownerId && ["FAILED", "STALE", "DENIED", "REVIEW_REQUIRED"].includes(run.status) && <button type="button" className={styles.secondary} onClick={() => { setRetryOf(run.id); setKind(run.kind); setNotice("Select current evidence and confirm fictional data before requesting recovery."); }}>Prepare recovery</button>}
    </li>)}</ul>
  </section>;
}
