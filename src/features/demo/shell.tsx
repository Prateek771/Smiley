import Link from "next/link";
import type { ReactNode } from "react";
import { demoUrl, roles, type DemoContext } from "./data";

export function Icon({ kind = "grid", className = "" }: { kind?: "grid" | "review" | "query" | "receipt" | "arrow" | "search" | "clock"; className?: string }) {
  const paths = {
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    review: "M12 3 2 21h20L12 3ZM12 9v5m0 3h.01",
    query: "M21 11a8 8 0 0 1-8 8H5l-3 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8ZM7 10h10M7 14h6",
    receipt: "M6 2h12v20l-3-2-3 2-3-2-3 2V2ZM9 7h6M9 11h6M9 15h4",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    search: "M21 21l-6-6M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}

export function ContextFields({ context, omit = [], checkpoint }: { context: DemoContext; omit?: string[]; checkpoint?: string }) {
  const values = { q: context.q, filter: context.filter, role: context.role, checkpoint: checkpoint ?? "" };
  return Object.entries(values).filter(([name, value]) => !omit.includes(name) && value).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
}

export function DemoShell({ context, path = "/demo", checkpoint, children }: { context: DemoContext; path?: string; checkpoint?: string; children: ReactNode }) {
  const nav = [
    { label: "Work queue", filter: "all", icon: "grid" as const },
    { label: "Needs review", filter: "review", icon: "review" as const },
    { label: "Payer queries", filter: "queries", icon: "query" as const },
    { label: "Settlement follow-up", filter: "settlement", icon: "receipt" as const },
  ];
  return (
    <div className="demo-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <aside className="desk-sidebar">
        <Link href={demoUrl("/demo", context)} className="brand" aria-label="Smiley demo work queue">
          <span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="12" r="1.8" /><circle cx="21" cy="12" r="1.8" /><path d="M8 19c4 6 12 6 16 0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg></span>
          <span>smiley<span className="brand-caption">hospital claims desk</span></span>
        </Link>
        <div className="workspace-label">FICTIONAL WORKSPACE</div>
        <div className="hospital-card"><span className="hospital-avatar">S</span><div><strong>Synthetic Hospital</strong><span>Branch 01 · India</span></div></div>
        <Link href="/login" className="primary-link">Staff sign in<Icon kind="arrow" /></Link>
        <nav aria-label="Demo navigation">
          {nav.map((item) => <Link key={item.filter} href={demoUrl("/demo", { ...context, filter: item.filter })} className={`nav-item ${context.filter === item.filter ? "active" : ""}`} aria-current={path === "/demo" && context.filter === item.filter ? "page" : undefined}><Icon kind={item.icon} /><span>{item.label}</span></Link>)}
        </nav>
        <div className="sidebar-note"><span className="tiny-dot" /><strong>Made for the discharge desk</strong><p>One owner. A clear next action. Every amount backed by its source.</p></div>
        <div className="sidebar-bottom"><span className="preview-avatar">D</span><div><strong>Demo workspace</strong><span>Fictional records only</span></div></div>
      </aside>
      <div className="desk-main">
        <header className="desk-topbar"><div className="breadcrumb">Discharge desk <span>/</span> <strong>{path === "/demo" ? "Work queue" : "Case review"}</strong></div><span className="synthetic-badge"><span className="tiny-dot" />Synthetic demo</span></header>
        <div className="demo-notice"><p><strong>A safe space to explore the workflow.</strong> All cases, amounts and evidence are fictional. Snapshot outcomes are predefined for this demonstration.</p></div>
        <div className="preview-bar"><p>Role preview only · no permissions are granted</p><form action={path} method="get" className="preview-form"><ContextFields context={context} omit={["role"]} checkpoint={checkpoint} /><label htmlFor="demo-role">Preview as</label><select id="demo-role" name="role" defaultValue={context.role} aria-label="Demo role preview">{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select><button type="submit" className="quiet-button">Update preview</button></form></div>
        <main id="workspace" className="workspace">{children}</main>
        <footer className="workspace-footer"><span>Smiley · Synthetic workflow preview</span><span>Insurer approval and actual payment remain separate.</span></footer>
      </div>
    </div>
  );
}

export function StatePanel({ title, description, context, loading = false, clearFilters = false }: { title: string; description: string; context: DemoContext; loading?: boolean; clearFilters?: boolean }) {
  return <section className="state-panel" aria-live="polite"><span className={`state-icon ${loading ? "loading-spin" : ""}`}><Icon kind={loading ? "clock" : "grid"} /></span><h2>{title}</h2><p>{description}</p>{loading && <div className="state-skeleton" aria-hidden="true"><span /><span /><span /></div>}<Link className="primary-link" href={demoUrl("/demo", { ...context, q: "", filter: "all" })}>{clearFilters ? "Clear filters" : "Return to demo queue"}<Icon kind="arrow" /></Link></section>;
}
