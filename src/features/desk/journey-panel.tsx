"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DocumentListing } from "@/server/documents";
import type { Journey, JourneyAction, JourneyInput } from "@/server/journey";
import { formatMoney, paise } from "./financial-panel";
import styles from "./desk.module.css";

export type JourneyPanelProps = { caseId: string; version: number; journey: Journey; documents: DocumentListing; queries: { reference: string; status: string }[]; canAct: boolean };
const stamp = (value: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const labels: Record<JourneyAction["type"], string> = { eligibility: "Eligibility result", "preauth-request": "Preauthorization request", "preauth-response": "Actual payer response", "treatment-update": "Treatment update", "payer-query": "Payer query", "query-response-prepared": "Locally prepared query response", "query-acknowledged": "Actual response acknowledgement", "discharge-handoff": "Discharge preparation handoff" };
export function JourneyPanel(props: JourneyPanelProps) {
  const { journey, documents } = props;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [kind, setKind] = useState<"INITIAL" | "ENHANCEMENT">(journey.currentAuthorization ? "ENHANCEMENT" : "INITIAL");
  const [amendmentId, setAmendmentId] = useState("");
  const [queryRevisionId, setQueryRevisionId] = useState("");
  const [payerResult, setPayerResult] = useState<"APPROVED" | "PARTIAL" | "QUERY" | "REJECTED" | "UNCLEAR">("APPROVED");
  const retry = useRef<{ content: string; body: JourneyInput } | null>(null);
  const latestRevisionIds = new Set(documents.documents.map((document) => documents.revisions.filter((revision) => revision.documentId === document.id).sort((a, b) => b.revisionNumber - a.revisionNumber)[0]?.id));
  const sources = documents.revisions.filter((revision) => latestRevisionIds.has(revision.id));
  function values(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return new FormData(event.currentTarget); }
  function occurrence(form: FormData) { return new Date(`${String(form.get("occurredAt"))}+05:30`).toISOString(); }
  const shared = (form: FormData) => ({ text: String(form.get("text")), evidenceRevisionId: String(form.get("evidence")), occurredAt: occurrence(form), verified: form.get("verified") === "on" });
  async function execute(build: () => unknown) {
    try {
      const action = build() as JourneyAction;
      const content = JSON.stringify({ version: props.version, action });
      if (retry.current?.content !== content) retry.current = { content, body: { expectedVersion: props.version, idempotencyKey: crypto.randomUUID(), action } };
      setPending(true); setNotice(null);
      const result = await fetch(`/api/cases/${props.caseId}/journey`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(retry.current.body) });
      const body = await result.json() as { error?: string };
      if (!result.ok) { if (result.status === 409) router.refresh(); throw new Error(body.error ?? "The journey action could not be saved."); }
      retry.current = null; setNotice({ error: false, text: "Saved. The earlier journey history keeps this reviewed version." }); router.refresh();
    } catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "Connection interrupted. Retry the same action safely." }); }
    finally { setPending(false); }
  }
  const source = (purpose?: string) => <label className={styles.field}>Reviewed source revision<select name="evidence" required><option value="">Choose current evidence</option>{sources.filter((revision) => !purpose || documents.documents.find((document) => document.id === revision.documentId)?.type === purpose).map((revision) => <option key={revision.id} value={revision.id}>{revision.name} · revision {revision.revisionNumber}</option>)}</select></label>;
  const moment = () => <label className={styles.field}>Actual event date and time (IST)<input name="occurredAt" type="datetime-local" step="1" required /></label>;
  const verification = () => <label><input name="verified" type="checkbox" required /> I reviewed the actual source and these recorded details.</label>;
  const reference = () => <label className={styles.field}>External reference<input name="reference" maxLength={150} required /></label>;
  const text = (label: string) => <label className={styles.field}>{label}<textarea name="text" maxLength={2000} required /></label>;
  const amount = (name: string, label: string) => <label className={styles.field}>{label} (₹)<input type="number" name={name} min="0" step="0.01" required /></label>;
  const activeRequests = journey.requests.filter((request) => journey.activeRequestIds.includes(request.id));
  const amending = activeRequests.find((request) => request.id === amendmentId);
  const revisingQuery = journey.queries.find((query) => query.id === queryRevisionId);
  const actualRequests = activeRequests.map((request) => ({ request, response: journey.responses.filter((response) => response.action.requestId === request.id).at(-1) }));
  const mutable = props.canAct && !journey.closed && !journey.discharge;
  return <section aria-label="Earlier cashless journey" className={styles.actionPanels}>
    <section className={styles.card}><h2>Earlier cashless journey</h2><p className={styles.muted}>Track eligibility, preauthorization and treatment before final discharge. Requested totals and estimates remain separate from actual payer responses.</p>
      <dl className={styles.facts}><div><dt>Current eligibility</dt><dd>{journey.eligibility ? `${journey.eligibility.action.result} · ${journey.eligibilityUsable ? "current" : "needs review"}` : "Not recorded"}</dd></div><div><dt>Current early authorization</dt><dd>{formatMoney(journey.currentAuthorization?.authorizedPaise)}</dd></div><div><dt>Pending payer requests</dt><dd>{journey.pendingRequestIds.length}</dd></div></dl>
      {journey.eligibility && <p className={styles.muted}>Eligibility source period: {journey.eligibility.action.validFrom} to {journey.eligibility.action.validThrough}. Request-time checks also use registered policy and admission dates.</p>}
      <p className={styles.muted}>Early authorization does not replace the final payer decision, Billing confirmation or an actual receipt.</p>
      {props.queries.length > 0 && <p className={styles.muted}>{props.queries.filter((query) => query.status !== "RESOLVED").length} additional discharge queries appear in the case preparation and financial sections.</p>}
      {journey.discharge && <p className={styles.success}>Handed over for final discharge preparation at {stamp(journey.discharge.occurredAt)} IST.</p>}
    </section>
    {notice && <p className={notice.error ? styles.alert : styles.success} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    {mutable && <div className={styles.grid}>
      <details className={styles.card}><summary><strong>Record eligibility result</strong></summary><form className={styles.form} onSubmit={(event) => { const form = values(event); void execute(() => ({ type: "eligibility", reference: String(form.get("reference")), result: String(form.get("result")), validFrom: String(form.get("validFrom")), validThrough: String(form.get("validThrough")), ...shared(form) })); }}>
        {reference()}<label className={styles.field}>Actual result<select name="result"><option>ELIGIBLE</option><option>PARTIAL</option><option>NOT_ELIGIBLE</option><option>UNCLEAR</option></select></label>
        <div className={styles.twoFields}><label className={styles.field}>Payer validity begins<input name="validFrom" type="date" required /></label><label className={styles.field}>Payer validity ends<input name="validThrough" type="date" required /></label></div>{text("Eligibility response details")}{moment()}{source()}{verification()}<button className={styles.button} disabled={pending}>Save evidenced eligibility</button>
      </form></details>
      <details className={styles.card}><summary><strong>Record preauthorization request or enhancement</strong></summary><p className={styles.muted}>Record a request sent through your approved channel. An enhancement amount is the new total requested authorization. A sent amendment preserves earlier evidence and actual payer responses.</p><form className={styles.form} onSubmit={(event) => { const form = values(event); void execute(() => ({ type: "preauth-request", kind: amending?.action.kind ?? kind, parentRequestId: amending ? amending.action.parentRequestId : kind === "ENHANCEMENT" ? String(form.get("parentRequestId")) : null, supersedesRequestId: amending?.id ?? null, eligibilityEventId: journey.eligibility?.id, reference: amending?.action.reference ?? String(form.get("reference")), requestedPaise: paise(form.get("requested")), estimatePaise: paise(form.get("estimate")), ...shared(form) })); }}>
        <label className={styles.field}>New request or sent amendment<select value={amendmentId} onChange={(event) => setAmendmentId(event.target.value)}><option value="">New request</option>{activeRequests.map((request) => <option key={request.id} value={request.id}>Amend {request.action.reference}</option>)}</select></label>
        {amending ? <p className={styles.muted}>Amending {amending.action.reference} · {amending.action.kind}. Record the actual amended request and its current source.</p> : <><label className={styles.field}>Request kind<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="INITIAL">Initial request</option><option value="ENHANCEMENT">Enhancement</option></select></label>
          {kind === "ENHANCEMENT" && <label className={styles.field}>Current authorized request<select name="parentRequestId" required><option value="">Choose current parent request</option>{activeRequests.filter((request) => request.id === journey.currentAuthorization?.action.requestId).map((request) => <option key={request.id} value={request.id}>{request.action.reference}</option>)}</select></label>}{reference()}</>}
        {amount("estimate", "Reviewed treatment estimate")}{amount("requested", "New total requested authorization")}{text("Request reason and details")}{moment()}{source()}{verification()}<button className={styles.button} disabled={pending || !journey.eligibilityUsable || journey.pendingRequestIds.some((id) => id !== amending?.id)}>Record sent request</button>
      </form></details>
      <details className={styles.card}><summary><strong>Record actual payer response or revision</strong></summary><p className={styles.muted}>A revised response preserves the previous response. An unclear response records no authorized amount.</p><form className={styles.form} onSubmit={(event) => { const form = values(event); const requestId = String(form.get("requestId")); void execute(() => ({ type: "preauth-response", requestId, reference: String(form.get("reference")), result: payerResult, authorizedPaise: ["APPROVED", "PARTIAL"].includes(payerResult) ? paise(form.get("authorized")) : null, supersedesResponseId: journey.responses.filter((response) => response.action.requestId === requestId).at(-1)?.id ?? null, ...shared(form) })); }}>
        <label className={styles.field}>Related request<select name="requestId" required><option value="">Choose request</option>{actualRequests.map(({ request, response }) => <option key={request.id} value={request.id}>{request.action.reference} · {response?.action.result ?? "Waiting for response"}</option>)}</select></label>
        {reference()}<label className={styles.field}>Actual payer response<select value={payerResult} onChange={(event) => setPayerResult(event.target.value as typeof payerResult)}><option>APPROVED</option><option>PARTIAL</option><option>QUERY</option><option>REJECTED</option><option>UNCLEAR</option></select></label>
        {["APPROVED", "PARTIAL"].includes(payerResult) && amount("authorized", "Actual total authorized")}{text("Payer response and conditions")}{moment()}{source()}{verification()}<button className={styles.button} disabled={pending || !journey.requests.length}>Record actual response</button>
      </form></details>
      <details className={styles.card}><summary><strong>Record treatment update</strong></summary><form className={styles.form} onSubmit={(event) => { const form = values(event); void execute(() => ({ type: "treatment-update", estimatePaise: paise(form.get("estimate")), ...shared(form) })); }}>
        {amount("estimate", "Updated treatment estimate")}{text("Treatment update")}{moment()}{source()}{verification()}<button className={styles.button} disabled={pending || !journey.requests.length}>Save treatment update</button>
      </form></details>
      <details className={styles.card}><summary><strong>Record request-linked payer query</strong></summary><form className={styles.form} onSubmit={(event) => { const form = values(event); void execute(() => ({ type: "payer-query", requestId: revisingQuery?.requestId ?? String(form.get("requestId")), supersedesQueryId: revisingQuery?.id ?? null, reference: revisingQuery?.reference ?? String(form.get("reference")), ...shared(form) })); }}>
        <label className={styles.field}>New query or evidenced revision<select value={queryRevisionId} onChange={(event) => setQueryRevisionId(event.target.value)}><option value="">New payer query</option>{journey.queries.map((query) => <option key={query.id} value={query.id}>Revise {query.reference}</option>)}</select></label>
        {revisingQuery ? <p className={styles.muted}>Revising {revisingQuery.reference} against current source evidence. Earlier drafts and acknowledgements remain in history.</p> : <><label className={styles.field}>Related request<select name="requestId" required><option value="">Choose request</option>{activeRequests.map((request) => <option key={request.id} value={request.id}>{request.action.reference}</option>)}</select></label>{reference()}</>}{text("Actual payer query")}{moment()}{source()}{verification()}<button className={styles.button} disabled={pending || !activeRequests.length}>Record linked query</button>
      </form></details>
      {journey.queries.map((query) => <details className={styles.card} key={query.id}><summary><strong>{query.reference} · {query.status}</strong></summary><p>{query.text}</p><form className={styles.form} onSubmit={(event) => { const form = values(event); void execute(() => ({ type: "query-response-prepared", queryEventId: query.id, text: String(form.get("text")), sourceRevisionIds: form.getAll("source"), occurredAt: occurrence(form), verified: form.get("verified") === "on" })); }}>
        {text("Locally prepared response")}{moment()}<fieldset><legend>Reviewed supporting source revisions</legend>{sources.map((revision) => <label key={revision.id}><input type="checkbox" name="source" value={revision.id} /> {revision.name} · revision {revision.revisionNumber}<br /></label>)}</fieldset>{verification()}<button className={styles.secondary} disabled={pending}>Save prepared response</button>
      </form><form className={styles.form} onSubmit={(event) => { const form = values(event); void execute(() => ({ type: "query-acknowledged", responseEventId: query.preparedResponseId, reference: String(form.get("reference")), evidenceRevisionId: String(form.get("evidence")), occurredAt: occurrence(form), verified: form.get("verified") === "on" })); }}>
        <p className={styles.muted}>After submitting through your approved channel, record actual payer receipt of the latest reviewed response.</p>{reference()}{moment()}{source()}{verification()}<button className={styles.button} disabled={pending || !query.preparedResponseId || query.status === "ACKNOWLEDGED"}>Record actual acknowledgement</button>
      </form></details>)}
      <details className={styles.card}><summary><strong>Handoff to final discharge preparation</strong></summary><form className={styles.form} onSubmit={(event) => { const form = values(event); void execute(() => ({ type: "discharge-handoff", ...shared(form) })); }}>
        {text("Discharge handoff note")}{moment()}{source("discharge-summary")}{verification()}<button className={styles.button} disabled={pending || !journey.currentAuthorization || !journey.treatments.length || journey.pendingRequestIds.length > 0 || journey.queries.some((query) => query.status !== "ACKNOWLEDGED")}>Record discharge handoff</button>
      </form></details>
    </div>}
    {journey.events.length > 0 && <section className={styles.card} aria-label="Earlier journey history"><h2>Earlier journey history</h2><ol className={styles.timeline}>{journey.events.map((event) => <li key={event.id}><strong>{labels[event.action.type]}</strong><p>{"reference" in event.action ? `${event.action.reference} · ` : ""}{"text" in event.action ? event.action.text : "Receipt of the linked reviewed response recorded."}</p>
      {event.action.type === "preauth-request" && <p>Estimate: {formatMoney(event.action.estimatePaise)} · requested total: {formatMoney(event.action.requestedPaise)} · {event.action.kind}</p>}
      {event.action.type === "preauth-request" && event.action.supersedesRequestId && <p className={styles.muted}>Sent amendment of an earlier request; its history is retained.</p>}
      {event.action.type === "payer-query" && event.action.supersedesQueryId && <p className={styles.muted}>Evidenced revision of an earlier payer query; its response history is retained.</p>}
      {event.action.type === "preauth-response" && <p>{event.action.result} · actual authorized amount: {formatMoney(event.action.authorizedPaise)}</p>}
      {event.action.type === "treatment-update" && <p>Updated estimate: {formatMoney(event.action.estimatePaise)}</p>}
      <p className={styles.muted}>Actual event: {stamp(event.occurredAt)} IST · recorded: {stamp(event.recordedAt)} IST · staff {event.actorId} · version {event.caseVersion}</p>
      {!event.evidenceCurrent && <p className={styles.alert}>Historical source superseded; review current evidence before further action.</p>}
      <p>{(event.action.type === "query-response-prepared" ? event.action.sourceRevisionIds : [event.action.evidenceRevisionId]).map((id, index) => <span key={id}>{index > 0 ? " · " : ""}<a href={`/api/documents/${id}/download`}>Open source {index + 1}</a></span>)}</p>
    </li>)}</ol></section>}
  </section>;
}
