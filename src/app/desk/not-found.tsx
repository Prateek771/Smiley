import Link from "next/link";
import styles from "@/features/desk/desk.module.css";
export default function CaseUnavailable() {
  return <div className={styles.card}><h1>Case unavailable</h1><p className={styles.alert}>This case is unavailable in your hospital or assigned branches.</p><Link className={styles.button} href="/desk">Back to work queue</Link></div>;
}
