import Link from "next/link";
import { deskData } from "@/features/desk/server";
import styles from "@/features/desk/desk.module.css";

type Search = { q?: string; branchId?: string };
export default async function WorkQueue({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const data = await deskData(search);
  const q = (search.q ?? "").trim().slice(0, 200);
  const branchId = data.branches.some((branch) => branch.id === search.branchId) ? search.branchId : "";
  const matching = data.cases;
  const context = new URLSearchParams();
  if (q) context.set("q", q);
  if (branchId) context.set("branchId", branchId);
  return <>
    <div className={styles.heading}><div><span className={styles.badge}>{data.branches.length} assigned {data.branches.length === 1 ? "branch" : "branches"}</span><h1>Hospital work queue</h1><p>Persisted discharge cases with an owner, a next action and a traceable registration history.</p></div>{data.canRegister && <Link className={styles.button} href="/desk/new">Register a case</Link>}</div>
    <form className={styles.filters} method="get" action="/desk">
      <label className={styles.field}>Search persisted cases<input type="search" name="q" maxLength={200} defaultValue={q} placeholder="Patient name, code, case or next action" /></label>
      <label className={styles.field}>Branch filter<select name="branchId" defaultValue={branchId}><option value="">All assigned branches</option>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <button className={styles.secondary} type="submit">Apply queue filters</button>
    </form>
    <p className={styles.muted} style={{ marginBottom: 16 }}>{data.casesTruncated ? "Showing the newest 500 matching cases. Narrow the search or branch filter to find other cases." : `${matching.length} matching ${matching.length === 1 ? "case" : "cases"} · newest first`}</p>
    {matching.length ? <div className={styles.caseList}>{matching.map((item) => <article className={styles.card} key={item.id} aria-label={`Case ${item.claimNo}`}>
      <div className={styles.cardHeader}><div><h2>{item.patientName}</h2><p className={styles.muted}>{item.patientCode} · {item.claimNo}</p></div><span className={styles.badge}>{item.status} · {item.stage}</span></div>
      <dl className={styles.facts}><div><dt>Branch</dt><dd>{item.branchName}</dd></div><div><dt>Owner</dt><dd>{data.owners.find((owner) => owner.id === item.ownerId && owner.branchId === item.branchId)?.name ?? (item.ownerId ? `Staff ${item.ownerId}` : "Needs review")}</dd></div><div><dt>Financial amounts</dt><dd>Needs review</dd></div></dl>
      <p className={styles.action}><span>Next action</span>{item.nextAction ?? "Needs review"}</p>
      <Link className={styles.secondary} href={`/desk/cases/${item.id}${context.size ? `?${context}` : ""}`}>Open case {item.claimNo}</Link>
    </article>)}</div> : <div className={styles.empty}><h2>{q || branchId ? "No cases match these filters" : "No discharge cases yet"}</h2><p>{q || branchId ? "Adjust the search or branch filter to find your assigned work." : "Register a patient, membership and encounter to start a cashless draft."}</p>{q || branchId ? <Link className={styles.secondary} href="/desk">Clear queue filters</Link> : data.canRegister && <Link className={styles.button} href="/desk/new">Register a case</Link>}</div>}
  </>;
}
