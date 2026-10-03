export type TimingEvent = { type: string; occurredAt: string; reference?: string };
export type Timing = { preparationMs: number | null; submissionDelayMs: number | null; payerWaitingMs: number | null; queryResponseMs: number | null; billingReviewMs: number | null; deskResolutionMs: number | null; ongoing: boolean; issue: string | null };
export function workflowTiming(createdAt: string, events: TimingEvent[], asOf: string): Timing {
  const unknown = (issue: string): Timing => ({ preparationMs: null, submissionDelayMs: null, payerWaitingMs: null, queryResponseMs: null, billingReviewMs: null, deskResolutionMs: null, ongoing: true, issue });
  const first = events.findIndex((event) => event.type === "FINANCIAL_BILL");
  if (first < 0) return unknown("A verified final bill-ready event is missing.");
  const relevant = events.slice(first).filter((event) => ["FINANCIAL_BILL", "FINANCIAL_PACK", "FINANCIAL_SUBMISSION", "PAYER_QUERY_RECORDED", "FINANCIAL_QUERY_ACK", "FINANCIAL_DECISION", "USABLE_FINAL_DECISION", "FINANCIAL_CONFIRM", "CANCELLED"].includes(event.type));
  const stopped = relevant.findIndex((event) => event.type === "FINANCIAL_CONFIRM" || event.type === "CANCELLED");
  const measured = stopped < 0 ? relevant : relevant.slice(0, stopped + 1);
  const start = Date.parse(measured[0].occurredAt); const snapshot = Date.parse(asOf);
  let previous = Date.parse(createdAt);
  if (!Number.isFinite(previous) || !Number.isFinite(snapshot)) return unknown("Event timestamps need review.");
  for (const event of measured) {
    const occurred = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurred) || occurred < previous || occurred > snapshot) return unknown("Event timestamps need review.");
    previous = occurred;
  }
  const end = stopped < 0 ? snapshot : Date.parse(measured[measured.length - 1].occurredAt);
  const pack = measured.find((event) => event.type === "FINANCIAL_PACK");
  const submission = measured.find((event) => event.type === "FINANCIAL_SUBMISSION");
  let waiting: number | null = null; let payerWaitingMs = 0; let queryResponseMs = 0; let finalDecision: number | null = null;
  const queries = new Map<string, number>();
  for (const event of measured) {
    const occurred = Date.parse(event.occurredAt);
    if (["FINANCIAL_SUBMISSION", "FINANCIAL_QUERY_ACK"].includes(event.type)) {
      if (waiting !== null) payerWaitingMs += occurred - waiting;
      waiting = occurred;
      if (event.type === "FINANCIAL_QUERY_ACK") {
        const reference = event.reference ?? "recorded-query";
        const opened = queries.get(reference);
        if (opened !== undefined) { queryResponseMs += occurred - opened; queries.delete(reference); }
      }
    } else if (["PAYER_QUERY_RECORDED", "FINANCIAL_DECISION", "USABLE_FINAL_DECISION", "CANCELLED", "FINANCIAL_CONFIRM"].includes(event.type)) {
      if (waiting !== null) { payerWaitingMs += occurred - waiting; waiting = null; }
      if (event.type === "PAYER_QUERY_RECORDED") queries.set(event.reference ?? "recorded-query", occurred);
      if (event.type === "USABLE_FINAL_DECISION") finalDecision = occurred;
    }
  }
  if (waiting !== null) payerWaitingMs += end - waiting;
  for (const opened of queries.values()) queryResponseMs += end - opened;
  return { preparationMs: (pack ? Date.parse(pack.occurredAt) : end) - start,
    submissionDelayMs: pack ? (submission ? Date.parse(submission.occurredAt) : end) - Date.parse(pack.occurredAt) : null,
    payerWaitingMs, queryResponseMs, billingReviewMs: finalDecision === null ? null : end - finalDecision,
    deskResolutionMs: end - start, ongoing: stopped < 0, issue: null };
}
export function csv(columns: string[], rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    let text = String(value ?? "");
    if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
