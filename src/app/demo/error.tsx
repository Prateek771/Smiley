"use client";

import Link from "next/link";

export default function DemoError({ reset }: { reset: () => void }) {
  return <main className="standalone-state"><span className="eyebrow">SYNTHETIC DEMO</span><h1>The demo queue could not load</h1><p>Try loading the fictional data again, or return to the demo work queue.</p><button type="button" className="filter-button" onClick={reset}>Retry loading</button><Link className="primary-link" href="/demo">Return to demo queue</Link></main>;
}
