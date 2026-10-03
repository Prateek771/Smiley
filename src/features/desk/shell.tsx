import Link from "next/link";
import type { ReactNode } from "react";
import type { StaffSession } from "@/server/auth";
import { SignOutButton } from "@/features/auth/sign-out-button";
import styles from "./desk.module.css";

export function DeskShell({ actor, children }: { actor: StaffSession; children: ReactNode }) {
  return <div className={styles.shell}>
    <a className="skip-link" href="#desk-content">Skip to hospital work</a>
    <aside className={styles.sidebar} aria-label="Hospital navigation">
      <Link href="/desk" className={styles.brand}>smiley<small>HOSPITAL INSURANCE DESK</small></Link>
      <nav className={styles.nav} aria-label="Workspaces">
        <Link href="/desk">Work queue</Link>
        <Link href="/desk/reports">Operations reports</Link>
        {actor.roles.includes("HOSPITAL_ADMIN") && !actor.roles.includes("SUPER_ADMIN") && <Link href="/desk/admin">Hospital administration</Link>}
        <Link href="/demo">Synthetic demo</Link>
      </nav>
      <div className={styles.identity}>
        <div><strong>{actor.name}</strong><p>Verified staff session</p></div>
        <SignOutButton />
      </div>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.topbar}><strong>Cashless discharge operations</strong><span className={styles.badge}>Staff workspace</span></header>
      <main id="desk-content" className={styles.content}>{children}</main>
    </div>
  </div>;
}
