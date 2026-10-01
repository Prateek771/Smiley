"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { patientAction, membershipAction, encounterAction, caseAction, type FormState } from "@/app/desk/actions";
import type { BranchDto, PolicyDto, MembershipDto, EncounterDto, OwnerDto } from "@/server/cases";
import styles from "./desk.module.css";

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;
function ActionForm({ action, submit, children }: { action: FormAction; submit: string; children: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return <form className={styles.form} action={formAction}>
    {children}
    {state.error && <p role="alert" className={styles.alert}>{state.error}</p>}
    <button className={styles.button} type="submit" disabled={pending}>{pending ? "Saving…" : submit}</button>
  </form>;
}
export function PatientForm() {
  return <ActionForm action={patientAction} submit="Register patient">
    <label className={styles.field}>Patient code<input name="patientCode" autoComplete="off" maxLength={50} required /></label>
    <div className={styles.twoFields}>
      <label className={styles.field}>First name<input name="firstName" autoComplete="given-name" maxLength={100} required /></label>
      <label className={styles.field}>Last name<input name="lastName" autoComplete="family-name" maxLength={100} /></label>
    </div>
    <label className={styles.field}>Mobile<input name="mobile" type="tel" autoComplete="tel" maxLength={20} /></label>
  </ActionForm>;
}
export function MembershipForm({ patientId, policies }: { patientId: string; policies: PolicyDto[] }) {
  const [policyId, setPolicyId] = useState("");
  const selected = policies.find((policy) => policy.id === policyId);
  return <ActionForm action={membershipAction} submit="Add membership">
    <input type="hidden" name="patientId" value={patientId} />
    <label className={styles.field}>Policy<select name="policyId" value={policyId} onChange={(event) => setPolicyId(event.target.value)} required>
      <option value="">Choose an available cashless policy</option>
      {policies.map((policy) => <option value={policy.id} key={policy.id}>{policy.name} · {policy.policyCode}</option>)}
    </select></label>
    {selected && <section aria-label="Selected policy context" className={styles.context}>
      <dl className={styles.facts}>
        <div><dt>Category</dt><dd>{selected.categoryName ?? "Not specified"}</dd></div>
        <div><dt>Subcategory</dt><dd>{selected.subcategoryName ?? "Not specified"}</dd></div>
        <div><dt>Insurer</dt><dd>{selected.companyName}</dd></div>
        <div><dt>TPA</dt><dd>{selected.tpaName ?? "No TPA listed"}</dd></div>
      </dl>
    </section>}
    <label className={styles.field}>Policy number<input name="policyNumber" maxLength={100} required /></label>
    <div className={styles.twoFields}>
      <label className={styles.field}>Valid from<input name="validFrom" type="date" required /></label>
      <label className={styles.field}>Valid to<input name="validTo" type="date" required /></label>
    </div>
    <p className={styles.muted}>Membership is recorded as not verified. Coverage and eligibility require review.</p>
  </ActionForm>;
}
export function EncounterForm({ patientId, branches }: { patientId: string; branches: BranchDto[] }) {
  return <ActionForm action={encounterAction} submit="Register encounter">
    <input type="hidden" name="patientId" value={patientId} />
    <label className={styles.field}>Branch<select name="branchId" defaultValue="" required>
      <option value="">Choose a registration branch</option>
      {branches.filter((branch) => branch.canRegister).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
    </select></label>
    <label className={styles.field}>Encounter type<select name="encounterType" defaultValue="IPD" required>
      <option value="IPD">Inpatient (IPD)</option><option value="OPD">Outpatient (OPD)</option><option value="EMERGENCY">Emergency</option><option value="DAYCARE">Daycare</option><option value="OTHER">Other</option>
    </select></label>
    <label className={styles.field}>Admission date and time (IST)<input name="admissionDate" type="datetime-local" required /></label>
    <p className={styles.muted}>The entered time is saved in India Standard Time (UTC+05:30).</p>
  </ActionForm>;
}
export function CreateCaseForm({ patientId, branches, memberships, encounters, owners }: { patientId: string; branches: BranchDto[]; memberships: MembershipDto[]; encounters: EncounterDto[]; owners: OwnerDto[] }) {
  const [branchId, setBranchId] = useState("");
  const [state, formAction, pending] = useActionState(caseAction, { error: null });
  const keyInput = useRef<HTMLInputElement>(null);
  const creationKey = useRef("");
  const availableEncounters = encounters.filter((encounter) => encounter.patientId === patientId && encounter.branchId === branchId);
  const availableMemberships = memberships.filter((membership) => membership.patientId === patientId);
  return <form className={styles.form} action={formAction} onSubmitCapture={() => {
    // Generated on the client, then retained through retries of this submitted form.
    if (!creationKey.current) creationKey.current = crypto.randomUUID();
    if (keyInput.current) keyInput.current.value = creationKey.current;
  }}>
    <input type="hidden" name="patientId" value={patientId} />
    <input type="hidden" name="creationKey" ref={keyInput} />
    <label className={styles.field}>Case branch<select name="branchId" value={branchId} onChange={(event) => setBranchId(event.target.value)} required>
      <option value="">Choose a case branch</option>
      {branches.filter((branch) => branch.canCreate).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
    </select></label>
    <div className={styles.twoFields}>
      <label className={styles.field}>Insurance membership<select name="patientInsuranceId" defaultValue="" required>
        <option value="">Choose this patient’s membership</option>
        {availableMemberships.map((membership) => <option key={membership.id} value={membership.id}>{membership.policyName} · {membership.policyNumber}</option>)}
      </select></label>
      <label className={styles.field}>Encounter<select name="encounterId" key={`encounter-${branchId}`} defaultValue="" required>
        <option value="">Choose this patient’s encounter</option>
        {availableEncounters.map((encounter) => <option key={encounter.id} value={encounter.id}>{encounter.encounterType} · {encounter.encounterNo}</option>)}
      </select></label>
    </div>
    <label className={styles.field}>Case owner<select name="ownerId" key={`owner-${branchId}`} defaultValue="" required>
      <option value="">Choose an active owner in this branch</option>
      {owners.filter((owner) => owner.branchId === branchId).map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
    </select></label>
    <label className={styles.field}>Next action<textarea name="nextAction" maxLength={2000} required placeholder="What needs to happen next, and who needs the result?" /></label>
    <p className={styles.muted}>Creates a registered cashless draft. Insurer authorization and financial amounts remain unknown.</p>
    {state.error && <p role="alert" className={styles.alert}>{state.error}</p>}
    <button className={styles.button} type="submit" disabled={pending}> {pending ? "Creating…" : "Create case"}</button>
  </form>;
}
