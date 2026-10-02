"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { FinancialCase } from "@/server/financial";
import type { DocumentListing } from "@/server/documents";
import { formatMoney, paise } from "./financial-panel";
import styles from "./desk.module.css";
type CaseOption = { id: string; claimNo: string };
export function SettlementPanel({ data, documents, cases }: { data: FinancialCase; documents: DocumentListing; cases: CaseOption[] }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState(false);
  const [allocations, setAllocations] = useState([{ caseId: data.caseId, decisionId: data.decision?.id ?? "" }]);
  const retry = useRef<{ content: string; key: string } | null>(null);
  async function selectCase(index: number, caseId: string) {
    setAllocations((rows) => rows.map((row, i) => i === index ? { caseId, decisionId: "" } : row));
    try { const response = await fetch(`/api/cases/${caseId}/financial`); const detail = await response.json() as FinancialCase & { error?: string }; if (!response.ok) throw new Error(detail.error ?? "Case unavailable");
      setAllocations((rows) => rows.map((row, i) => i === index && row.caseId === caseId ? { caseId, decisionId: detail.authorizedPaise === null ? "" : detail.decision?.id ?? "" } : row));
    } catch { setError(true); setNotice("Could not load the current payer decision. Reload the case selection."); }
  }
  async function send(event: FormEvent<HTMLFormElement>, type: "receipt" | "reversal") {
    event.preventDefault(); if (pending) return; const form = new FormData(event.currentTarget); setPending(true); setNotice("");
    try {
      const value = { evidenceCaseId: data.caseId, evidenceRevisionId: form.get("evidence"), reference: form.get("reference"), occurredAt: new Date(String(form.get("occurredAt"))).toISOString(), verified: form.get("verified") === "on",
        ...(type === "receipt" ? { amountPaise: paise(form.get("amount")), allocations: allocations.filter((_, i) => paise(form.get(`allocation-${i}`)) > 0).map((row) => ({ ...row, amountPaise: paise(form.get(`allocation-${allocations.indexOf(row)}`)) })) } : { receiptId: form.get("receipt") }) };
      const content = JSON.stringify({ type, value }); if (retry.current?.content !== content) retry.current = { content, key: crypto.randomUUID() };
      const response = await fetch("/api/remittances", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, data: { ...value, idempotencyKey: retry.current.key } }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Remittance could not be recorded."); retry.current = null; setError(false); setNotice("Saved actual remittance evidence. Earlier records remain in history."); router.refresh();
    } catch (failure) { setError(true); setNotice(failure instanceof Error ? failure.message : "Connection interrupted. Retry the same input."); } finally { setPending(false); }
  }
  const fields = <><label className={styles.field}>External reference<input name="reference" maxLength={150} required /></label><label className={styles.field}>Actual event time (your local time)<input name="occurredAt" type="datetime-local" required /></label><label className={styles.field}>Bank / remittance evidence<select name="evidence" required><option value="">Choose evidence</option>{documents.revisions.filter((row) => documents.documents.find((doc) => doc.id === row.documentId)?.type === "bank-remittance").map((row) => <option key={row.id} value={row.id}>{row.name} · revision {row.revisionNumber}</option>)}</select></label><label><input type="checkbox" name="verified" required /> I verified the actual bank or remittance evidence.</label></>;
  return <section aria-label="Settlement workspace" className={styles.actionPanels}>
    <section className={styles.card}><h2>Settlement and remittance</h2><dl className={styles.facts}><div><dt>Actual net payer receipts</dt><dd>{formatMoney(data.netReceivedPaise)}</dd></div><div><dt>Authorized amount still receivable</dt><dd>{formatMoney(data.receivablePaise)}</dd></div><div><dt>Overpayment requiring Finance review</dt><dd>{formatMoney(data.overpaidPaise)}</dd></div></dl><p className={styles.muted}>Decision disputes remain separate after the full authorized amount is received. Unallocated receipts require Finance follow-up.</p>
      <ul className={styles.timeline}>{data.remittances.map((row) => <li key={row.id}>{row.reference} · {formatMoney(row.amountPaise)} · {row.reversed ? "Reversed" : `Unallocated ${formatMoney(row.unallocatedPaise)}`}<p className={styles.muted}>Actual event: {new Date(row.occurredAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p></li>)}</ul>
    </section>
    {notice && <p className={error ? styles.alert : styles.success} role={error ? "alert" : "status"}>{notice}</p>}
    {data.canFinance && <div className={styles.grid}><section className={styles.card} aria-label="Record remittance"><h2>Record remittance receipt</h2><form className={styles.form} onSubmit={(event) => void send(event, "receipt")}>
      <label className={styles.field}>Actual receipt (₹)<input type="number" min="0.01" step="0.01" name="amount" required /></label>
      {allocations.map((row, index) => <fieldset key={index}><legend>Claim allocation {index + 1}</legend><label className={styles.field}>Claim<select value={row.caseId} onChange={(event) => void selectCase(index, event.target.value)} disabled={pending}>{cases.map((item) => <option key={item.id} value={item.id}>{item.claimNo}</option>)}</select></label><p>{row.decisionId ? "Current final payer decision selected" : "Final payer decision unavailable; keep unallocated until review"}</p><label className={styles.field}>Allocate (₹, zero leaves unmatched)<input type="number" min="0" step="0.01" defaultValue="0" name={`allocation-${index}`} required /></label><button className={styles.secondary} type="button" disabled={pending} onClick={() => setAllocations(allocations.filter((_, i) => i !== index))}>Remove allocation</button></fieldset>)}
      <button type="button" className={styles.secondary} disabled={pending || allocations.length >= 100} onClick={() => setAllocations([...allocations, { caseId: data.caseId, decisionId: data.decision?.id ?? "" }])}>Add claim allocation</button>{fields}<button className={styles.button} disabled={pending}>Record actual remittance</button>
    </form></section><section className={styles.card} aria-label="Reverse remittance"><h2>Reverse remittance receipt</h2><form className={styles.form} onSubmit={(event) => void send(event, "reversal")}><label className={styles.field}>Original remittance<select name="receipt" required><option value="">Choose original receipt</option>{data.remittances.filter((row) => !row.reversed).map((row) => <option key={row.id} value={row.id}>{row.reference} · {formatMoney(row.amountPaise)}</option>)}</select></label>{fields}<button className={styles.secondary} disabled={pending}>Record evidenced reversal</button></form></section></div>}
  </section>;
}
