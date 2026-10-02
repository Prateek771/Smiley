"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CaseActionInput } from "@/server/timeline";
import styles from "./desk.module.css";

type Props = { caseId: string; version: number; status: string; ownerId: string | null; nextAction: string | null; dueAt: string | null;
  owners: { id: string; name: string }[]; queries: { reference: string; status: string }[] };
export function CaseActions(props: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const retry = useRef<{ content: string; body: CaseActionInput } | null>(null);
  async function execute(action: CaseActionInput["action"]) {
    const content = JSON.stringify({ version: props.version, action });
    if (retry.current?.content !== content) retry.current = { content, body: { expectedVersion: props.version, idempotencyKey: crypto.randomUUID(), action } };
    setPending(true); setNotice(null);
    try {
      const response = await fetch(`/api/cases/${props.caseId}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(retry.current.body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setNotice({ error: true, text: result.error ?? "The action could not be saved." });
        if (response.status === 409) router.refresh();
        return;
      }
      retry.current = null; setNotice({ error: false, text: "Preparation saved. History updated." }); router.refresh();
    } catch { setNotice({ error: true, text: "Connection interrupted. Retry the same action safely." }); }
    finally { setPending(false); }
  }
  const form = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); return new FormData(event.currentTarget); };
  const active = ["DRAFT", "PENDING", "IN_PROGRESS", "QUERY"].includes(props.status);
  if (!active) return <p className={styles.alert}>This case is closed for preparation actions.</p>;
  return <div className={`${styles.grid} ${styles.full} ${styles.actionPanels}`}>
    {notice && <p className={`${notice.error ? styles.alert : styles.success} ${styles.full}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    <section aria-label="Edit preparation" className={styles.card}><h2>Edit preparation</h2><form key={props.version} className={styles.form} onSubmit={(event) => {
      const values = form(event); const due = String(values.get("dueAt") || "");
      void execute({ type: "edit", ownerId: String(values.get("ownerId")), nextAction: String(values.get("nextAction")), dueAt: due ? new Date(`${due}+05:30`).toISOString() : null });
    }}><label className={styles.field}>Case owner<select name="ownerId" defaultValue={props.owners.some((owner) => owner.id === props.ownerId) ? props.ownerId ?? "" : ""} required><option value="" disabled>Choose an active owner</option>{props.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
      <label className={styles.field}>Next action<textarea name="nextAction" defaultValue={props.nextAction ?? ""} maxLength={2000} required /></label>
      <label className={styles.field}>Due date and time (IST)<input name="dueAt" type="datetime-local" defaultValue={props.dueAt ? new Date(new Date(props.dueAt).getTime() + 330 * 60000).toISOString().slice(0, 16) : ""} /></label>
      <button className={styles.button} disabled={pending}>Save preparation</button></form></section>
    <section aria-label="Preparation status" className={styles.card}><h2>Preparation status</h2><p className={styles.muted}>Use the financial and settlement sections below to record evidenced payer decisions and receipts.</p><form className={styles.form} onSubmit={(event) => {
      const values = form(event); const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
      void execute({ type: "status", status: submitter.value as "PENDING" | "IN_PROGRESS" | "CANCELLED", reason: String(values.get("reason")) });
    }}><label className={styles.field}>Reason for status change<textarea name="reason" required maxLength={2000} /></label>
      {props.status === "DRAFT" && <button className={styles.button} value="PENDING" disabled={pending}>Mark ready for preparation</button>}
      {props.status === "PENDING" && <button className={styles.button} value="IN_PROGRESS" disabled={pending}>Start preparation</button>}
      <button className={styles.secondary} value="CANCELLED" disabled={pending}>Cancel preparation</button></form></section>
    {["IN_PROGRESS", "QUERY"].includes(props.status) && <>
      <section aria-label="Record payer query" className={styles.card}><h2>Record payer query</h2><form className={styles.form} onSubmit={(event) => {
        const values = form(event); void execute({ type: "query-open", reference: String(values.get("reference")), text: String(values.get("text")) });
      }}><label className={styles.field}>Payer query reference<input name="reference" maxLength={150} required /></label><label className={styles.field}>Query text<textarea name="text" maxLength={2000} required /></label><button className={styles.button} disabled={pending}>Record query</button></form></section>
      <section aria-label="Prepare query response" className={styles.card}><h2>Prepare query response</h2><p className={styles.muted}>Save a local draft for staff review before external submission.</p><form className={styles.form} onSubmit={(event) => {
        const values = form(event); void execute({ type: "query-response", reference: String(values.get("reference")), text: String(values.get("text")) });
      }}><label className={styles.field}>Recorded query<select name="reference" required>{props.queries.filter((query) => ["OPEN", "RESPONDED"].includes(query.status)).map((query) => <option key={query.reference} value={query.reference}>{query.reference}</option>)}</select></label><label className={styles.field}>Prepared response<textarea name="text" maxLength={2000} required /></label><button className={styles.button} disabled={pending || !props.queries.length}>Save prepared response</button></form></section>
    </>}
  </div>;
}
