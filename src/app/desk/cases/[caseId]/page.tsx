import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AuthError } from "@/server/auth";
import { getCase } from "@/server/cases";
import styles from "@/features/desk/desk.module.css";

type Search = { q?: string; branchId?: string };
const indiaDate = (value: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export default async function PersistedCase({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<Search> }) {
  const [{ caseId }, search] = await Promise.all([params, searchParams]);
  let record;
  try { record = await getCase(new Headers(await headers()), caseId); }
  catch (error) {
    if (error instanceof AuthError && error.status === 401) redirect("/login");
    if (error instanceof AuthError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
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
      <section aria-label="Case history" className={styles.card}><h2>Case history</h2><p className={styles.muted}>Persisted events from the case’s audit trail.</p><ol className={styles.timeline}>{record.events.map((event) => <li key={event.id}><strong>{event.type === "CREATED" ? "Case registered" : event.type}</strong><p className={styles.muted}>Staff {event.actorId} · version {event.caseVersion}</p><time dateTime={event.recordedAt}>{indiaDate(event.recordedAt)} IST</time></li>)}</ol></section>
    </div>
  </>;
}
