import Link from "next/link";
import { deskData } from "@/features/desk/server";
import { PatientForm, MembershipForm, EncounterForm, CreateCaseForm } from "@/features/desk/registration-forms";
import styles from "@/features/desk/desk.module.css";

type Search = { patientId?: string; notice?: string };
const notices: Record<string, string> = { patient: "Patient registered. Add insurance and encounter details below.", membership: "Insurance membership added. Register or choose an encounter next.", encounter: "Encounter registered. The linked case can now be created." };
export default async function RegisterCasePage({ searchParams }: { searchParams: Promise<Search> }) {
  const [data, search] = await Promise.all([deskData(), searchParams]);
  if (!data.canRegister) return <div className={styles.card}><h1>Registration unavailable</h1><p role="alert" className={styles.alert}>Registration is not permitted for your current branch assignments.</p><Link className={styles.button} href="/desk">Back to work queue</Link></div>;
  const patient = data.patients.find((item) => item.id === search.patientId);
  return <>
    <Link className={styles.back} href="/desk">← Back to work queue</Link>
    <div className={styles.heading}><div><span className={styles.badge}>Registration</span><h1>Register a discharge case</h1><p>Connect the patient, curated insurance policy and encounter before handing the draft to its desk owner.</p></div></div>
    {notices[search.notice ?? ""] && <p role="status" className={styles.success}>{notices[search.notice ?? ""]}</p>}
    <form className={styles.filters} method="get" action="/desk/new">
      <label className={styles.field}>Existing patient<select name="patientId" defaultValue={patient?.id ?? ""}><option value="">Choose a registered patient</option>{data.patients.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.patientCode}</option>)}</select></label>
      <button className={styles.secondary} type="submit">Use selected patient</button>
    </form>
    {patient && <p className={styles.success}>Working with <strong>{patient.name}</strong> · {patient.patientCode}</p>}
    <div className={styles.grid}>
      <section aria-label="Patient registration" className={styles.card}><h2>1. Patient registration</h2><p className={styles.muted}>Register a new patient, or select an existing patient above.</p><PatientForm /></section>
      <section aria-label="Insurance membership" className={styles.card}><h2>2. Insurance membership</h2><p className={styles.muted}>The selected policy determines its category, insurer and TPA.</p>{patient ? <MembershipForm patientId={patient.id} policies={data.policies} /> : <p className={styles.alert}>Register or select a patient to add insurance.</p>}</section>
      <section aria-label="Encounter registration" className={styles.card}><h2>3. Encounter registration</h2><p className={styles.muted}>Record this admission under an assigned hospital branch.</p>{patient ? <EncounterForm patientId={patient.id} branches={data.branches} /> : <p className={styles.alert}>Register or select a patient to add an encounter.</p>}</section>
      {data.canCreate && <section aria-label="Create discharge case" className={styles.card}><h2>4. Create discharge case</h2><p className={styles.muted}>Assign ownership and a concrete next action.</p>{patient ? <CreateCaseForm key={patient.id} patientId={patient.id} branches={data.branches} memberships={data.memberships} encounters={data.encounters} owners={data.owners} /> : <p className={styles.alert}>Register or select a patient to create a linked case.</p>}</section>}
    </div>
  </>;
}
