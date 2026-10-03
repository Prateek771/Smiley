"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JobDto } from "@/server/jobs";
import styles from "./desk.module.css";
export function JobsPanel({ caseId, version, packId, canRequest, ownerId, jobs }: { caseId: string; version: number; packId?: string; canRequest: boolean; ownerId: string; jobs: JobDto[] }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const retry = useRef<{ content: string; key: string } | null>(null);
  async function request(retryOf?: string) {
    if (pending) return; setPending(true); setError("");
    try {
      const value = { expectedVersion: version, packId, ...(retryOf ? { retryOf } : {}) }; const content = JSON.stringify(value);
      if (retry.current?.content !== content) retry.current = { content, key: crypto.randomUUID() };
      const response = await fetch(`/api/cases/${caseId}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...value, idempotencyKey: retry.current.key }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "The review job could not be requested."); retry.current = null; router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Request interrupted. Retry the same input."); } finally { setPending(false); }
  }
  return <section className={styles.card} aria-label="Background review jobs"><h2>Background review jobs</h2><p className={styles.muted}>Background review checks current claim-pack evidence. You can continue preparing the case while a review is queued. Payer authorization and external submission require their own evidence.</p>
    {error && <p role="alert" className={styles.alert}>{error}</p>}{canRequest && <button type="button" className={styles.button} disabled={pending || !packId} onClick={() => void request()}>Request background pack review</button>} <button className={styles.secondary} type="button" onClick={() => router.refresh()}>Refresh job status</button>
    {jobs.length ? <ul className={styles.timeline}>{jobs.map((job) => <li key={job.id}><strong>{job.status}</strong><p className={styles.muted}>Owner: staff {job.ownerId} · attempts {job.attempts} of 3 · {new Date(job.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>{job.reason && <p>{job.reason}</p>}{job.result && <p>{job.result.summary}</p>}{canRequest && job.ownerId === ownerId && ["FAILED", "STALE", "DENIED"].includes(job.status) && <button className={styles.secondary} type="button" disabled={pending || !packId} onClick={() => void request(job.id)}>Recover after reviewing current inputs</button>}</li>)}</ul> : <p>No background reviews requested.</p>}
  </section>;
}
