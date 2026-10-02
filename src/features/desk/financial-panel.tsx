"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { FinancialCase } from "@/server/financial";
import type { DocumentListing } from "@/server/documents";
import styles from "./desk.module.css";

export function paise(value: FormDataEntryValue | string | null): number {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(text)) throw new Error("Use a nonnegative amount with at most two decimal places.");
  const [rupees, fraction = ""] = text.split(".");
  const amount = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This amount exceeds supported precision.");
  return Number(amount);
}
export const formatMoney = (value: number | null | undefined) => value === null || value === undefined ? "Needs review" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100);
function valueForm(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return new FormData(event.currentTarget); }
export function FinancialPanel({ data, documents }: { data: FinancialCase; documents: DocumentListing }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [lines, setLines] = useState(data.bill?.payload.bill.lines ?? [{ description: "", grossPaise: 0, excludedPaise: 0, reductionPaise: 0 }]);
  async function submit(action: unknown) {
    setPending(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/cases/${data.caseId}/financial`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: data.version, idempotencyKey: crypto.randomUUID(), action }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "This action could not be saved.");
      setMessage("Saved. The case history retains this reviewed version."); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The action failed. Reload and retry."); }
    finally { setPending(false); }
  }
  function guarded(action: () => unknown) { try { void submit(action()); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the provided values."); } }
  const source = (name: string, label: string, required = true) => <label className={styles.field}>{label}<select name={name} required={required}><option value="">Choose evidence revision</option>{documents.revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.name} · revision {revision.revisionNumber}</option>)}</select></label>;
  const amount = (name: string, label: string, initial = 0) => <label className={styles.field}>{label} (₹)<input name={name} type="number" min="0" step="0.01" required defaultValue={(initial / 100).toFixed(2)} /></label>;
  const result = data.assessment?.payload.result;
  return <section aria-label="Financial workspace" className={styles.actionPanels}>
    <section className={styles.card}><h2>Bill and financial assessment</h2><p className={styles.muted}>Versioned fictional rules support review. The payer’s decision and Billing confirmation are separate steps.</p>
      <dl className={styles.facts}><div><dt>Current bill</dt><dd>{data.bill ? formatMoney(data.bill.payload.bill.lines.reduce((sum, line) => sum + line.grossPaise, 0)) : "Needs review"}</dd></div><div><dt>Estimated insurer share</dt><dd>{formatMoney(result?.insurerPaise)}</dd></div><div><dt>Estimated patient share</dt><dd>{formatMoney(result?.patientPaise)}</dd></div><div><dt>Confirmed patient share</dt><dd>{formatMoney(data.patientConfirmedPaise)}</dd></div></dl>
      {result && <><p>{result.status === "READY" ? "Supported synthetic assessment, awaiting the payer decision and human sign-off." : "Needs review"}</p>{result.blocks.map((block) => <p key={block} className={styles.alert}>{block}</p>)}<ol>{result.lines.map((line, index) => <li key={index}>{line.description}: eligible {formatMoney(line.eligiblePaise)}<p className={styles.muted}>{line.reason}</p></li>)}</ol></>}
    </section>
    {error && <p role="alert" className={styles.alert}>{error} <button type="button" className={styles.secondary} onClick={() => router.refresh()}>Reload case</button></p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
    {data.canBill && <div className={styles.grid}>
      <section className={styles.card} aria-label="Record bill revision"><h2>Record bill revision</h2><form className={styles.form} onSubmit={(event) => { const form = valueForm(event); guarded(() => ({ type: "bill", verified: form.get("verified") === "on", sourceRevisionId: form.get("source"), reductionRevisionId: form.get("reduction") || null,
        bill: { serviceDate: form.get("date"), lines: lines.map((_, index) => ({ description: String(form.get(`description-${index}`)), grossPaise: paise(form.get(`gross-${index}`)), excludedPaise: paise(form.get(`excluded-${index}`)), reductionPaise: paise(form.get(`reduced-${index}`)) })) } })); }}>
        <label className={styles.field}>Bill service date<input name="date" type="date" required defaultValue={data.bill?.payload.bill.serviceDate} /></label>
        {lines.map((line, index) => <fieldset key={index}><legend>Bill line {index + 1}</legend><label className={styles.field}>Service description<input name={`description-${index}`} required maxLength={200} defaultValue={line.description} /></label><div className={styles.twoFields}>{amount(`gross-${index}`, "Gross amount", line.grossPaise)}{amount(`excluded-${index}`, "Patient-excluded amount", line.excludedPaise)}{amount(`reduced-${index}`, "Approved hospital reduction", line.reductionPaise)}</div></fieldset>)}
        <button type="button" className={styles.secondary} disabled={lines.length >= 150} onClick={() => setLines([...lines, { description: "", grossPaise: 0, excludedPaise: 0, reductionPaise: 0 }])}>Add bill line</button>
        {source("source", "Final bill evidence")}{source("reduction", "Hospital reduction approval evidence", false)}
        <label><input type="checkbox" name="verified" required /> I reviewed these amounts and their source evidence.</label><button className={styles.button} disabled={pending}>Save bill revision</button>
      </form></section>
      {data.bill && <section className={styles.card} aria-label="Assess current bill"><h2>Assess current bill</h2><form className={styles.form} onSubmit={(event) => { const form = valueForm(event); guarded(() => ({ type: "assess", billId: data.bill!.id, verified: form.get("verified") === "on", policyRevisionId: form.get("policy"), rule: { version: String(form.get("ruleVersion")), validFrom: String(form.get("from")), validTo: String(form.get("to")), deductiblePaise: paise(form.get("deductible")), copayBps: paise(form.get("copay")), benefitLimitPaise: paise(form.get("limit")), tariffCapsPaise: data.bill!.payload.bill.lines.map((_, index) => form.get(`cap-${index}`) ? paise(form.get(`cap-${index}`)) : null) } })); }}>
        <label className={styles.field}>Fictional rule version<input name="ruleVersion" required defaultValue="SYN-DISCHARGE-1" maxLength={80} /></label><div className={styles.twoFields}><label className={styles.field}>Coverage begins<input type="date" name="from" required /></label><label className={styles.field}>Coverage ends<input type="date" name="to" required /></label></div>
        {amount("deductible", "Deductible")}<label className={styles.field}>Co-pay (%)<input name="copay" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></label>{amount("limit", "Payer benefit limit")}
        {data.bill.payload.bill.lines.map((line, index) => <label key={index} className={styles.field}>Tariff cap for {line.description} (₹, blank means uncapped)<input type="number" min="0" step="0.01" name={`cap-${index}`} /></label>)}
        {source("policy", "Reviewed policy evidence")}<label><input type="checkbox" name="verified" required /> I verified the fictional policy dates and rule inputs.</label><button className={styles.button} disabled={pending}>Save assessment snapshot</button>
      </form></section>}
    </div>}
  </section>;
}
