import styles from "@/features/desk/desk.module.css";
export default function LoadingDesk() {
  return <div className={styles.card} role="status" aria-live="polite"><h1>Loading hospital work</h1><p>Retrieving your assigned work and linked registration records.</p></div>;
}
