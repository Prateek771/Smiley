"use client";
import Link from "next/link";
import styles from "@/features/desk/desk.module.css";
export default function DeskError({ reset }: { reset: () => void }) {
  return <div className={styles.card}><h1>Hospital work is temporarily unavailable</h1><p role="alert" className={styles.alert}>Your request could not be completed. Please retry.</p><button className={styles.button} onClick={reset}>Retry hospital work</button> <Link className={styles.secondary} href="/login">Return to sign in</Link></div>;
}
