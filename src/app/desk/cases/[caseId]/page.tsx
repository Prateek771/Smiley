import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AuthError } from "@/server/auth";
import { getCase, getDeskData } from "@/server/cases";
import { getCaseTimeline } from "@/server/timeline";
import { listDocuments } from "@/server/documents";
import { DocumentPanel } from "@/features/desk/document-panel";
import { CaseActions } from "@/features/desk/case-actions";
import styles from "@/features/desk/desk.module.css";

type Search = { q?: string; branchId?: string };
const eventLabels: Record<string, string> = {
  CREATED: "Case registered", CASE_EDITED: "Preparation updated",
  PREPARATION_STATUS_CHANGED: "Preparation status changed", PAYER_QUERY_RECORDED: "Payer query recorded",
  QUERY_RESPONSE_PREPARED: "Query response prepared", DOCUMENT_UPLOADED: "Document revision uploaded",
  SOURCE_EVIDENCE_ADDED: "Source note recorded",
};
const indiaDate = (value: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
function historyText(payload: Record<string, unknown>): string {
  const action = typeof payload.action === "object" && payload.action !== null ? payload.action as Record<string, unknown> : null;
  if (action?.type === "edit") return `Next action: ${String(action.nextAction)} · Owner: staff ${String(action.ownerId)}${action.dueAt ? ` · Due: ${indiaDate(String(action.dueAt))} IST` : ""}`;
  if (action?.type === "status") return `Moved to ${String(action.status)}. Reason: ${String(action.reason)}`;
  if (action?.type === "query-open") return `Query ${String(action.reference)}: ${String(action.text)}`;
  if (action?.type === "query-response") return `Prepared response for ${String(action.reference)}: ${String(action.text)}`;
  if (typeof payload.nextAction === "string") return `Next action: ${payload.nextAction}`;
  if (typeof payload.revisionNumber === "number") return `${String(payload.name)} · revision ${payload.revisionNumber}`;
  if (typeof payload.sourceExcerpt === "string") return `Manual source note: ${String(payload.fieldName)} · ${payload.sourceExcerpt}`;
  return "";
}
export default async function PersistedCase({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<Search> }) {
  const [{ caseId }, search] = await Promise.all([params, searchParams]);
  let record; let workspace; let timeline; let documents;
  try {
    const staffHeaders = new Headers(await headers());
    [record, workspace, timeline, documents] = await Promise.all([getCase(staffHeaders, caseId), getDeskData(staffHeaders), getCaseTimeline(staffHeaders, caseId), listDocuments(staffHeaders, caseId)]);
  }
  catch (error) {
    if (error instanceof AuthError && error.status === 401) redirect("/login");
    if (error instanceof AuthError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
  const canAct = workspace.branches.some((branch) => branch.id === record.branchId && branch.canAct);
  const context = new URLSearchParams();
  if (search.q) context.set("q", search.q.slice(0, 200));
  if (search.branchId && /^[1-9][0-9]*$/u.test(search.branchId)) context.set("branchId", search.branchId);
  return <>
    <Link className={styles.back} href={`/desk${context.size ? `?${context}` : ""}`}>← Back to work queue</Link>
    <div className={styles.heading}><div><span className={styles.badge}>{record.status} · {record.stage} · version {record.version}</span><h1>{record.patientName}</h1><p>{record.claimNo} · {record.branchName}</p></div></div>
    <div className={styles.grid}>
      <section aria-label="Linked registration" className={styles.card}><h2>Linked registration</h2><dl className={styles.facts}>
        <div><dt>Patient</dt><dd>{record.patientName}</dd></div><div><dt>Patient code</dt><dd>{record.patientCode}</dd></div><div><dt>Branch</dt><dd>{record.branchName}</dd></div><div><dt>Insurance policy</dt><dd>{record.policyName}</dd></div><div><dt>Policy number</dt><dd>{record.policyNumber}</dd></div><div><dt>Encounter</dt><dd>{record.encounterNo ?? "Needs review"}</dd></div><div><dt>Admission (IST)</dt><dd>{record.admissionDate ? indiaDate(record.admissionDate) : "Needs review"}</dd></div>
      </dl></section>
      <section aria-label="Owner and next action" className={styles.card}><h2>Owner and next action</h2><dl className={styles.facts}><div><dt>Owner</dt><dd>{record.ownerName || "Needs review"}</dd></div><div><dt>Due date (IST)</dt><dd>{record.dueAt ? indiaDate(record.dueAt) : "Needs review"}</dd></div></dl><p className={styles.action}><span>Next action</span>{record.nextAction ?? "Needs review"}</p></section>
      <section aria-label="Financial review" className={styles.card}><h2>Financial review</h2><p className={styles.muted}>Registration creates a draft. Evidence and financial review are still required.</p><dl className={styles.facts}>{["Rule estimate", "Insurer authorization", "Patient responsibility", "Dispute amount", "Bank receipt"].map((label) => <div key={label}><dt>{label}</dt><dd>Needs review</dd></div>)}</dl></section>
      <section aria-label="Case history" className={styles.card}><h2>Case history</h2><p className={styles.muted}>Persisted events from the case’s audit trail.</p><ol className={styles.timeline}>{record.events.map((event) => <li key={event.id}><strong>{eventLabels[event.type] ?? "Case updated"}</strong><p className={styles.muted}>{String(timeline.events.find((row) => row.event_id === event.id)?.actor_name ?? `Staff ${event.actorId}`)} · version {event.caseVersion}</p><p>{historyText(event.payload)}</p><time dateTime={event.recordedAt}>{indiaDate(event.recordedAt)} IST</time></li>)}</ol></section>
    </div>
    {timeline.queries.length > 0 && <section aria-label="Recorded queries" className={styles.card}><h2>Recorded queries</h2><ol className={styles.timeline}>{timeline.queries.map((query) => <li key={query.query_id}><strong>{query.external_reference}</strong><p>{query.query_text}</p>{query.response_text && <p className={styles.action}>{query.response_text}</p>}<p className={styles.muted}>{query.status === "RESPONDED" ? "Response prepared locally; payer acknowledgement pending" : query.status}</p></li>)}</ol></section>}
    {canAct && <CaseActions caseId={caseId} version={record.version} status={record.status} ownerId={record.ownerId} nextAction={record.nextAction} dueAt={record.dueAt} owners={workspace.owners.filter((owner) => owner.branchId === record.branchId)} queries={timeline.queries.map((query) => ({ reference: String(query.external_reference), status: String(query.status) }))} />}
    <DocumentPanel listing={documents} canUpload={record.status !== "CANCELLED" && workspace.branches.some((branch) => branch.id === record.branchId && branch.canUpload)} />
  </>;
}
