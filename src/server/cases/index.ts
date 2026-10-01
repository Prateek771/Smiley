import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { AccessError, withActorTransaction } from "../access";
import { branchScope } from "../access/permissions";
import type { StaffSession } from "../auth";
import { writeAudit } from "../audit";

const decimalId = z.string().refine((value) => value.length <= 19 && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= BigInt("9223372036854775807"));
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const patientInput = z.object({ patientCode: nonEmpty(50), firstName: nonEmpty(100), lastName: z.string().trim().max(100).optional(), mobile: z.string().trim().max(20).optional() });
const membershipInput = z.object({ patientId: decimalId, policyId: decimalId, policyNumber: nonEmpty(100), validFrom: z.iso.date(), validTo: z.iso.date() }).refine((value) => value.validTo >= value.validFrom, { message: "The membership end date must follow its start date." });
export const encounterTypes = ["OPD", "IPD", "EMERGENCY", "DAYCARE", "OTHER"] as const;
const encounterInput = z.object({ branchId: decimalId, patientId: decimalId, encounterType: z.enum(encounterTypes), admissionDate: z.iso.datetime({ offset: true }) });
const caseInput = z.object({ branchId: decimalId, patientId: decimalId, patientInsuranceId: decimalId, encounterId: decimalId, ownerId: decimalId, nextAction: nonEmpty(2000), creationKey: z.string().min(20).max(150) });
export type RegisterPatientInput = z.input<typeof patientInput>;
export type MembershipInput = z.input<typeof membershipInput>;
export type EncounterInput = z.input<typeof encounterInput>;
export type CreateCaseInput = z.input<typeof caseInput>;
export type BranchDto = { id: string; name: string; branchCode: string; canRegister: boolean; canCreate: boolean; canAct: boolean; canUpload: boolean };
export type PatientDto = { id: string; patientCode: string; firstName: string; lastName: string | null; name: string };
export type PolicyDto = { id: string; policyCode: string; name: string; categoryName: string | null; subcategoryName: string | null; companyName: string; tpaName: string | null };
export type MembershipDto = { id: string; patientId: string; policyId: string; policyNumber: string; policyName: string; validFrom: string | null; validTo: string | null };
export type EncounterDto = { id: string; patientId: string; branchId: string; encounterNo: string; encounterType: string; admissionDate: string | null };
export type OwnerDto = { id: string; name: string; branchId: string };
export type CaseDto = { id: string; claimNo: string; patientId: string; patientInsuranceId: string; encounterId: string | null; branchId: string; ownerId: string | null; status: string; stage: string; version: number; nextAction: string | null; dueAt: string | null; patientName: string; patientCode: string; branchName: string; createdAt: string };
export type CaseEventDto = { id: string; type: string; actorId: string; occurredAt: string; recordedAt: string; caseVersion: number; payload: Record<string, unknown> };
export type CaseDetailDto = CaseDto & { policyNumber: string; policyName: string; encounterNo: string | null; admissionDate: string | null; ownerName: string | null; events: CaseEventDto[] };
export type DeskData = { actor: StaffSession; branches: BranchDto[]; patients: PatientDto[]; policies: PolicyDto[]; memberships: MembershipDto[]; encounters: EncounterDto[]; cases: CaseDto[]; casesTruncated: boolean; owners: OwnerDto[]; canRegister: boolean; canCreate: boolean; canAct: boolean; canUpload: boolean };

function parse<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AccessError(400, message);
  return result.data;
}
function timestamp(value: Date | string | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString() : value;
}
function normalizeCase(row: CaseDto): CaseDto {
  return { ...row, dueAt: timestamp(row.dueAt), createdAt: timestamp(row.createdAt)! };
}
const caseColumns = `c.claim_id::text AS id,c.claim_no AS "claimNo",c.patient_id::text AS "patientId",
  c.patient_insurance_id::text AS "patientInsuranceId",c.encounter_id::text AS "encounterId",
  c.branch_id::text AS "branchId",c.assigned_to::text AS "ownerId",c.claim_status AS status,
  c.claim_stage AS stage,c.version,c.next_action AS "nextAction",c.due_at AS "dueAt",
  concat_ws(' ',p.first_name,p.last_name) AS "patientName",p.patient_code AS "patientCode",
  b.name AS "branchName",c.created_at AS "createdAt"`;
const caseJoins = `JOIN patients p ON p.patient_id=c.patient_id AND p.hospital_id=c.hospital_id
  JOIN branches b ON b.branch_id=c.branch_id AND b.hospital_id=c.hospital_id`;
const ownerEligibility = `NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id AND ur.hospital_id=u.hospital_id AND r.role_code='SUPER_ADMIN' AND r.status='ACTIVE')
  AND (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id AND ur.hospital_id=u.hospital_id AND r.role_code='HOSPITAL_ADMIN' AND r.status='ACTIVE')
  OR EXISTS (SELECT 1 FROM user_branch_memberships m JOIN roles r ON r.role_id=m.role_id WHERE m.user_id=u.user_id AND m.hospital_id=u.hospital_id AND m.branch_id=b.branch_id AND m.status='ACTIVE' AND r.status='ACTIVE' AND r.role_code IN ('INSURANCE_EXECUTIVE','TPA_EXECUTIVE','CLAIM_VERIFIER','HOSPITAL_ADMIN')))`;

const policyJoins = `JOIN insurance_companies i ON i.insurance_company_id=p.insurance_company_id LEFT JOIN tpas t ON t.tpa_id=p.tpa_id LEFT JOIN insurance_subcategories sub ON sub.insurance_subcategory_id=p.insurance_subcategory_id LEFT JOIN insurance_categories cat ON cat.insurance_category_id=sub.insurance_category_id`;
const availablePolicy = `p.status='ACTIVE' AND p.cashless_allowed=true AND i.status='ACTIVE' AND (t.tpa_id IS NULL OR t.status='ACTIVE') AND (sub.insurance_subcategory_id IS NULL OR sub.status='ACTIVE') AND (cat.insurance_category_id IS NULL OR cat.status='ACTIVE')`;
export type DeskFilters = { q?: string; branchId?: string };

export async function getDeskData(headers: Headers, filters: DeskFilters = {}): Promise<DeskData> {
  const q = (filters.q ?? "").trim().slice(0, 200);
  const branchId = filters.branchId ? parse(decimalId, filters.branchId, "Choose a valid branch filter.") : undefined;
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => {
    const readBranches = branchScope(actor, "case:read");
    if (branchId && !readBranches.includes(branchId)) throw new AccessError(403, "Choose a branch assigned to your staff session.");
    const queueBranches = branchId ? [branchId] : readBranches;
    const register = branchScope(actor, "patient:write");
    const create = branchScope(actor, "case:write");
    const act = branchScope(actor, "case:act");
    const upload = branchScope(actor, "document:write");
    const branchRows = await client.query<{ id: string; name: string; branchCode: string }>(`SELECT branch_id::text AS id,name,branch_code AS "branchCode" FROM branches WHERE hospital_id=$1 AND branch_id=ANY($2::bigint[]) AND status='ACTIVE' ORDER BY branch_id`, [actor.hospitalId, readBranches]);
    const patientRows = await client.query<PatientDto>(`SELECT patient_id::text AS id,patient_code AS "patientCode",first_name AS "firstName",last_name AS "lastName",concat_ws(' ',first_name,last_name) AS name FROM patients WHERE hospital_id=$1 AND status='ACTIVE' ORDER BY patient_id DESC LIMIT 500`, [actor.hospitalId]);
    const policyRows = await client.query<PolicyDto>(`SELECT p.policy_id::text AS id,p.policy_code AS "policyCode",p.plan_name AS name,cat.category_name AS "categoryName",sub.subcategory_name AS "subcategoryName",i.company_name AS "companyName",t.tpa_name AS "tpaName" FROM insurance_policies p ${policyJoins} WHERE ${availablePolicy} ORDER BY p.policy_id`);
    const membershipRows = await client.query<MembershipDto>(`SELECT pi.patient_insurance_id::text AS id,pi.patient_id::text AS "patientId",pi.policy_id::text AS "policyId",pi.policy_number AS "policyNumber",p.plan_name AS "policyName",pi.valid_from AS "validFrom",pi.valid_to AS "validTo" FROM patient_insurance pi JOIN insurance_policies p ON p.policy_id=pi.policy_id ${policyJoins} WHERE pi.hospital_id=$1 AND pi.status='ACTIVE' AND ${availablePolicy} ORDER BY pi.patient_insurance_id DESC LIMIT 500`, [actor.hospitalId]);
    const encounterRows = await client.query<EncounterDto>(`SELECT encounter_id::text AS id,patient_id::text AS "patientId",branch_id::text AS "branchId",encounter_no AS "encounterNo",encounter_type AS "encounterType",admission_date AS "admissionDate" FROM encounters WHERE hospital_id=$1 AND branch_id=ANY($2::bigint[]) AND status<>'CANCELLED' ORDER BY encounter_id DESC LIMIT 500`, [actor.hospitalId, readBranches]);
    const caseRows = await client.query<CaseDto>(`SELECT ${caseColumns} FROM claims c ${caseJoins} WHERE c.hospital_id=$1 AND c.branch_id=ANY($2::bigint[]) AND ($3='' OR strpos(lower(concat_ws(' ',c.claim_no,p.first_name,p.last_name,p.patient_code,c.next_action)),lower($3))>0) ORDER BY c.created_at DESC,c.claim_id DESC LIMIT 501`, [actor.hospitalId, queueBranches, q]);
    const ownerRows = await client.query<OwnerDto>(`SELECT DISTINCT u.user_id::text AS id,concat_ws(' ',s.first_name,s.last_name) AS name,b.branch_id::text AS "branchId" FROM users u JOIN staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id JOIN branches b ON b.hospital_id=u.hospital_id AND b.branch_id=ANY($2::bigint[]) WHERE u.hospital_id=$1 AND u.status='ACTIVE' AND s.status='ACTIVE' AND b.status='ACTIVE' AND ${ownerEligibility} ORDER BY name,id,"branchId"`, [actor.hospitalId, readBranches]);
    return { actor, branches: branchRows.rows.map((branch) => ({ ...branch, canRegister: register.includes(branch.id), canCreate: create.includes(branch.id), canAct: act.includes(branch.id), canUpload: upload.includes(branch.id) })), patients: patientRows.rows, policies: policyRows.rows, memberships: membershipRows.rows, encounters: encounterRows.rows.map((encounter) => ({ ...encounter, admissionDate: timestamp(encounter.admissionDate) })), cases: caseRows.rows.slice(0, 500).map(normalizeCase), casesTruncated: caseRows.rows.length > 500, owners: ownerRows.rows, canRegister: register.length > 0, canCreate: create.length > 0, canAct: act.length > 0, canUpload: upload.length > 0 };
  });
}
export async function getCase(headers: Headers, id: string): Promise<CaseDetailDto> {
  parse(decimalId, id, "Choose a valid case ID.");
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => {
    const result = await client.query<CaseDetailDto>(`SELECT ${caseColumns},pi.policy_number AS "policyNumber",ip.plan_name AS "policyName",e.encounter_no AS "encounterNo",e.admission_date AS "admissionDate",concat_ws(' ',s.first_name,s.last_name) AS "ownerName" FROM claims c ${caseJoins} JOIN patient_insurance pi ON pi.patient_insurance_id=c.patient_insurance_id AND pi.hospital_id=c.hospital_id AND pi.patient_id=c.patient_id JOIN insurance_policies ip ON ip.policy_id=pi.policy_id LEFT JOIN encounters e ON e.encounter_id=c.encounter_id AND e.hospital_id=c.hospital_id AND e.branch_id=c.branch_id LEFT JOIN users u ON u.user_id=c.assigned_to AND u.hospital_id=c.hospital_id LEFT JOIN staff s ON s.staff_id=u.staff_id AND s.hospital_id=u.hospital_id WHERE c.claim_id=$1 AND c.hospital_id=$2 AND c.branch_id=ANY($3::bigint[])`, [id, actor.hospitalId, branchScope(actor, "case:read")]);
    if (result.rowCount !== 1) throw new AccessError(404, "The case is unavailable in your hospital or assigned branches.");
    const events = await client.query<CaseEventDto>(`SELECT event_id AS id,event_type AS type,actor_user_id::text AS "actorId",occurred_at AS "occurredAt",recorded_at AS "recordedAt",case_version AS "caseVersion",payload FROM claim_events WHERE hospital_id=$1 AND branch_id=$2 AND claim_id=$3 ORDER BY recorded_at,event_id`, [actor.hospitalId, result.rows[0].branchId, id]);
    return { ...result.rows[0], ...normalizeCase(result.rows[0]), admissionDate: timestamp(result.rows[0].admissionDate), events: events.rows.map((event) => ({ ...event, occurredAt: timestamp(event.occurredAt)!, recordedAt: timestamp(event.recordedAt)! })) };
  });
}
async function requirePatient(client: PoolClient, actor: StaffSession, id: string) {
  const result = await client.query("SELECT patient_id FROM patients WHERE patient_id=$1 AND hospital_id=$2 AND status='ACTIVE'", [id, actor.hospitalId]);
  if (result.rowCount !== 1) throw new AccessError(404, "The patient is unavailable in your hospital.");
}
export async function registerPatient(headers: Headers, input: unknown): Promise<{ id: string }> {
  const value = parse(patientInput, input, "Provide a patient code, first name and valid optional contact details.");
  return withActorTransaction(headers, "patient:write", undefined, async (client, actor) => {
    const result = await client.query(`INSERT INTO patients(hospital_id,patient_code,first_name,last_name,mobile,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING patient_id::text AS id`, [actor.hospitalId, value.patientCode, value.firstName, value.lastName || null, value.mobile || null]);
    const id = result.rows[0].id as string;
    await writeAudit(client, actor, null, "patients", "REGISTERED", id, null, { patientCode: value.patientCode });
    return { id };
  });
}
export async function addMembership(headers: Headers, input: unknown): Promise<{ id: string }> {
  const value = parse(membershipInput, input, "Provide a patient, policy, policy number and an ordered valid date range.");
  return withActorTransaction(headers, "patient:write", undefined, async (client, actor) => {
    await requirePatient(client, actor, value.patientId);
    const policy = await client.query(`SELECT p.policy_id FROM insurance_policies p ${policyJoins} WHERE p.policy_id=$1 AND ${availablePolicy}`, [value.policyId]);
    if (policy.rowCount !== 1) throw new AccessError(400, "Choose an active cashless policy from the available catalog.");
    const result = await client.query(`INSERT INTO patient_insurance(hospital_id,patient_id,policy_id,policy_number,valid_from,valid_to,status,verification_status) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE','NOT_VERIFIED') RETURNING patient_insurance_id::text AS id`, [actor.hospitalId, value.patientId, value.policyId, value.policyNumber, value.validFrom, value.validTo]);
    const id = result.rows[0].id as string;
    await writeAudit(client, actor, null, "patient_insurance", "REGISTERED", id, null, { patientId: value.patientId, policyId: value.policyId });
    return { id };
  });
}
export async function registerEncounter(headers: Headers, input: unknown): Promise<{ id: string }> {
  const value = parse(encounterInput, input, "Provide a patient, assigned branch, encounter type and timezone-aware admission date.");
  return withActorTransaction(headers, "patient:write", value.branchId, async (client, actor) => {
    await requirePatient(client, actor, value.patientId);
    const result = await client.query(`INSERT INTO encounters(hospital_id,branch_id,patient_id,encounter_no,encounter_type,admission_date,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7) RETURNING encounter_id::text AS id`, [actor.hospitalId, value.branchId, value.patientId, `ENC-${randomUUID()}`, value.encounterType, value.admissionDate, actor.userId]);
    const id = result.rows[0].id as string;
    await writeAudit(client, actor, value.branchId, "encounters", "REGISTERED", id, null, { patientId: value.patientId, encounterType: value.encounterType });
    return { id };
  });
}
export async function createCase(headers: Headers, input: unknown): Promise<{ id: string }> {
  const value = parse(caseInput, input, "Provide matching patient, membership, encounter and branch records, an owner, next action and a 20–150 character creation key.");
  // Fixed field order and normalized values make retries independent of caller object-key order.
  const fingerprint = createHash("sha256").update(JSON.stringify({ branchId: value.branchId, patientId: value.patientId, patientInsuranceId: value.patientInsuranceId, encounterId: value.encounterId, ownerId: value.ownerId, nextAction: value.nextAction })).digest("hex");
  return withActorTransaction(headers, "case:write", value.branchId, async (client, actor) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`case-create:${actor.hospitalId}:${value.branchId}:${value.creationKey}`]);
    const existing = await client.query("SELECT claim_id::text AS id,creation_fingerprint FROM claims WHERE hospital_id=$1 AND branch_id=$2 AND creation_key=$3", [actor.hospitalId, value.branchId, value.creationKey]);
    if (existing.rowCount) {
      if (existing.rows[0].creation_fingerprint !== fingerprint) throw new AccessError(409, "This creation key was already used for different case details.");
      return { id: existing.rows[0].id as string };
    }
    await requirePatient(client, actor, value.patientId);
    const membership = await client.query(`SELECT pi.patient_id::text AS patient_id FROM patient_insurance pi JOIN insurance_policies p ON p.policy_id=pi.policy_id ${policyJoins} WHERE pi.patient_insurance_id=$1 AND pi.hospital_id=$2 AND pi.status='ACTIVE' AND ${availablePolicy}`, [value.patientInsuranceId, actor.hospitalId]);
    if (membership.rowCount !== 1) throw new AccessError(400, "Choose an active insurance membership in your hospital.");
    if (membership.rows[0].patient_id !== value.patientId) throw new AccessError(400, "The insurance membership belongs to a different patient.");
    const encounter = await client.query("SELECT patient_id::text AS patient_id,branch_id::text AS branch_id,admission_date FROM encounters WHERE encounter_id=$1 AND hospital_id=$2 AND status<>'CANCELLED'", [value.encounterId, actor.hospitalId]);
    if (encounter.rowCount !== 1) throw new AccessError(400, "Choose an available encounter in your hospital and assigned branch.");
    if (encounter.rows[0].patient_id !== value.patientId || encounter.rows[0].branch_id !== value.branchId) throw new AccessError(400, "The encounter must belong to this patient and selected branch.");
    const owner = await client.query<{ allowed: boolean }>("SELECT smiley_private.lock_case_owner($1::bigint,$2::bigint) AS allowed", [value.ownerId, value.branchId]);
    if (owner.rows[0]?.allowed !== true) throw new AccessError(400, "Choose an active desk or hospital administrator assigned to this branch.");
    const result = await client.query(`INSERT INTO claims(hospital_id,branch_id,claim_no,patient_id,patient_insurance_id,encounter_id,claim_type,claim_stage,claim_status,admission_date,created_by,assigned_to,version,next_action,creation_key,creation_fingerprint) VALUES($1,$2,$3,$4,$5,$6,'CASHLESS','REGISTERED','DRAFT',$7,$8,$9,1,$10,$11,$12) RETURNING claim_id::text AS id`, [actor.hospitalId, value.branchId, `CLM-${randomUUID()}`, value.patientId, value.patientInsuranceId, value.encounterId, encounter.rows[0].admission_date, actor.userId, value.ownerId, value.nextAction, value.creationKey, fingerprint]);
    const id = result.rows[0].id as string;
    const payload = { patientId: value.patientId, patientInsuranceId: value.patientInsuranceId, encounterId: value.encounterId, ownerId: value.ownerId, nextAction: value.nextAction, status: "DRAFT", stage: "REGISTERED" };
    await client.query(`INSERT INTO claim_events(event_id,hospital_id,branch_id,claim_id,actor_user_id,event_type,occurred_at,payload,idempotency_key,fingerprint,case_version) VALUES($1,$2,$3,$4,$5,'CREATED',now(),$6::jsonb,$7,$8,1)`, [randomUUID(), actor.hospitalId, value.branchId, id, actor.userId, JSON.stringify(payload), value.creationKey, fingerprint]);
    await writeAudit(client, actor, value.branchId, "claims", "CREATED", id, null, payload);
    return { id };
  });
}
