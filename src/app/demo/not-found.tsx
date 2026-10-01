import Link from "next/link";

export default function DemoNotFound() {
  return <main className="standalone-state"><span className="eyebrow">SYNTHETIC DEMO</span><h1>That fictional case is unavailable</h1><p>Choose one of the five acceptance packs from the demo work queue.</p><Link className="primary-link" href="/demo">Return to demo queue</Link></main>;
}
