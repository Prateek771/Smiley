import Link from "next/link";
import { DemoShell, ContextFields, Icon, StatePanel } from "./shell";
import { demoUrl, matchesWork, money, packs, readableAction, snapshot, type DemoContext, type DemoSnapshot } from "./data";

export function FinancialFacts({ view, compact = false }: { view: DemoSnapshot; compact?: boolean }) {
  const expected = view.checkpoint.expected;
  const facts = [
    { label: "Estimated insurer amount", short: "Insurer estimate", value: expected.estimatedInsurerPaise, detail: "Provisional rule estimate" },
    { label: "Payer authorization", short: "Payer authorized", value: view.authorization, detail: "Actual fictional payer decision" },
    { label: "Confirmed patient share", short: "Patient confirmed", value: expected.confirmedPatientPaise, detail: "Requires current Billing sign-off" },
    { label: "Open decision dispute", short: "Decision dispute", value: expected.unresolvedDecisionPaise, detail: "Separate from patient liability" },
    { label: "Matched payer receipts", short: "Payer received", value: expected.netPayerReceivedPaise, detail: "Matched receipt evidence only" },
  ];
  return <div className={`financial-facts ${compact ? "compact" : ""}`}>{facts.map((fact) => <section key={fact.label} aria-label={fact.label} className={`money-fact ${fact.value === null ? "unknown" : ""}`}><span className="fact-label">{compact ? fact.short : fact.label}</span><strong>{money(fact.value)}</strong>{!compact && <span className="fact-note">{fact.detail}</span>}</section>)}</div>;
}

function status(view: DemoSnapshot) {
  if (view.checkpoint.reviewReasons.length) return { label: "Needs review", tone: "amber" };
  if (view.checkpoint.activeQueryReferences.length) return { label: "Payer query", tone: "violet" };
  if (view.checkpoint.expectedState.settlement === "partial-receipt") return { label: "Partial settlement", tone: "blue" };
  if (view.checkpoint.expectedState.decisionDispute === "open") return { label: "Decision dispute", tone: "amber" };
  return { label: "Patient amount confirmed", tone: "green" };
}

function CaseCard({ view, context }: { view: DemoSnapshot; context: DemoContext }) {
  const state = status(view);
  const action = view.checkpoint.nextActions.find((item) => item.ownerRole === context.role)!;
  return <article className="case-card" aria-label={`${view.pack.id} ${view.pack.title}`}>
    <div className="case-card-heading"><div><span className="case-id">{view.pack.id} <span>·</span> Fictional case</span><h2>{view.pack.title}</h2></div><span className={`status-badge ${state.tone}`}><span className="tiny-dot" />{state.label}</span></div>
    <div className="case-metadata"><span>Final bill <strong>{money(view.checkpoint.financialInputs.grossBillPaise)}</strong></span><span>Bill {view.checkpoint.authoritativeBillVersion === null ? "version needs review" : `v${view.checkpoint.authoritativeBillVersion}`}</span><span><Icon kind="clock" />{view.elapsedMinutes === null ? "Timer needs review" : `${view.elapsedMinutes} min ${view.resolutionConfirmed ? "to Billing sign-off" : "open at snapshot"}`}</span></div>
    <FinancialFacts view={view} compact />
    <div className="case-card-footer"><div className="next-action"><span className={`role-avatar ${context.role.toLowerCase()}`}>{context.role[0]}</span><div><span className="owner-label">{action.ownerRole} · next action in this preview</span><p>{readableAction(action.action)}</p></div></div><Link className="case-open-link" aria-label={`Open case ${view.pack.id}`} href={demoUrl(`/demo/cases/${view.pack.id}`, context, { checkpoint: view.checkpoint.id })}>Open case<Icon kind="arrow" /></Link></div>
  </article>;
}

export function DemoQueue({ context, view }: { context: DemoContext; view: string }) {
  const all = packs.map((pack) => snapshot(pack));
  const filtered = all.filter((item) => matchesWork(item, context.filter) && `${item.pack.id} ${item.pack.title} ${item.checkpoint.nextActions.map((action) => action.action).join(" ")}`.toLowerCase().includes(context.q.toLowerCase()));
  const special = {
    empty: { title: "No cases to show", description: "This demonstrates an empty desk. The five fictional packs are ready when you return to the queue." },
    error: { title: "The demo queue could not load", description: "This is a simulated loading failure. Return to the queue to continue exploring the fictional cases." },
    loading: { title: "Loading demo cases", description: "This is the loading-state preview. You can clear it immediately and return to the fictional work queue." },
  }[view];
  return <DemoShell context={context}>
    <div className="page-heading"><div><span className="eyebrow">CASHLESS DISCHARGE</span><h1>Work queue<span className="heading-dot">.</span></h1><p>See what needs attention. Keep every case moving with a clear next step.</p></div><span className="snapshot-note">Five acceptance packs<br /><strong>October 2026 · fictional snapshots</strong></span></div>
    <div className="queue-summary"><div><span className="summary-icon green"><Icon /></span><span><strong>{all.length}</strong>Fictional cases</span></div><div><span className="summary-icon amber"><Icon kind="review" /></span><span><strong>{all.filter((item) => matchesWork(item, "review")).length}</strong>Needs review</span></div><div><span className="summary-icon violet"><Icon kind="query" /></span><span><strong>{all.filter((item) => matchesWork(item, "queries")).length}</strong>Payer query</span></div><div><span className="summary-icon blue"><Icon kind="receipt" /></span><span><strong>{all.filter((item) => matchesWork(item, "disputes")).length}</strong>Open decision disputes</span></div></div>
    <form className="queue-filters" action="/demo" method="get"><ContextFields context={context} omit={["q", "filter"]} /><div className="search-field"><Icon kind="search" /><label className="sr-only" htmlFor="case-search">Search cases</label><input id="case-search" type="search" name="q" defaultValue={context.q} placeholder="Search by case ID, issue or next action" /></div><div className="filter-field"><label className="sr-only" htmlFor="work-filter">Work filter</label><select id="work-filter" name="filter" defaultValue={context.filter}><option value="all">All work</option><option value="review">Needs review</option><option value="queries">Payer queries</option><option value="disputes">Decision disputes</option><option value="settlement">Settlement follow-up</option></select></div><button className="filter-button" type="submit">Apply filters</button></form>
    {special ? <StatePanel {...special} context={context} loading={view === "loading"} /> : filtered.length ? <><div className="list-heading"><h2>{context.filter === "all" ? "All discharge cases" : "Filtered discharge cases"}</h2><span>{filtered.length} of {all.length} cases</span></div><div className="case-list">{filtered.map((item) => <CaseCard key={item.pack.id} view={item} context={context} />)}</div></> : <StatePanel title="No matching cases" description="Try a case ID, another issue, or clear the filters to see all five fictional packs." context={context} clearFilters />}
    <div className="demo-state-links"><span>Explore demo states:</span>{["empty", "error", "loading"].map((state) => <Link key={state} href={demoUrl("/demo", context, { view: state })}>{state}</Link>)}</div>
  </DemoShell>;
}
