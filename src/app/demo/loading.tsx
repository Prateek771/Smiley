import Link from "next/link";

export default function DemoLoading() {
  return <main className="standalone-state" aria-live="polite"><span className="eyebrow">SYNTHETIC DEMO</span><h1>Preparing demo workspace</h1><p>Preparing the fictional workflow snapshot.</p><Link className="primary-link" href="/demo">Return to demo queue</Link></main>;
}

