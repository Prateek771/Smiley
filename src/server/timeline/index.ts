import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AccessError, withActorTransaction } from "../access";
import { writeAudit } from "../audit";

const id = z.string().max(19).regex(/^[1-9][0-9]*$/u)
  .refine((value) => /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= BigInt("9223372036854775807"));
const text = z.string().trim().min(1).max(2000);
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("edit"), ownerId: id, nextAction: text, dueAt: z.iso.datetime({ offset: true }).nullable() }).strict(),
  z.object({ type: z.literal("status"), status: z.enum(["PENDING", "IN_PROGRESS", "CANCELLED"]), reason: text }).strict(),
  z.object({ type: z.literal("query-open"), reference: z.string().trim().min(1).max(150), text }).strict(),
  z.object({ type: z.literal("query-response"), reference: z.string().trim().min(1).max(150), text }).strict(),
]);
const inputSchema = z.object({ expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(8).max(150), action }).strict();
export type CaseActionInput = z.infer<typeof inputSchema>;
export type ActionResult = { caseId: string; version: number; eventId: string; idempotent: boolean };

export async function applyCaseAction(headers: Headers, caseId: string, input: unknown): Promise<ActionResult> {
  if (!id.safeParse(caseId).success) throw new AccessError(400, "Provide a valid case ID.");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new AccessError(400, "Provide a supported preparation action, current version and action key.");
  const value = parsed.data;
  const fingerprint = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return withActorTransaction(headers, "case:act", undefined, async (client, actor) => {
    const selected = await client.query("SELECT * FROM claims WHERE claim_id=$1 AND hospital_id=$2 FOR UPDATE", [caseId, actor.hospitalId]);
    const current = selected.rows[0];
    if (!current) throw new AccessError(404, "The case is unavailable in your assigned branches.");
    const previous = await client.query("SELECT event_id,fingerprint,case_version FROM claim_events WHERE hospital_id=$1 AND claim_id=$2 AND idempotency_key=$3", [actor.hospitalId, caseId, value.idempotencyKey]);
    if (previous.rowCount) {
      if (previous.rows[0].fingerprint !== fingerprint) throw new AccessError(409, "This action key was already used for different information.");
      return { caseId, version: previous.rows[0].case_version, eventId: previous.rows[0].event_id, idempotent: true };
    }
    if (current.version !== value.expectedVersion) throw new AccessError(409, "The case changed. Refresh and review the latest version before acting.");
    if (!["DRAFT", "PENDING", "IN_PROGRESS", "QUERY"].includes(current.claim_status)) throw new AccessError(409, "This case is no longer open for preparation actions.");
    const before = { status: current.claim_status, ownerId: current.assigned_to, nextAction: current.next_action, dueAt: current.due_at };
    let status: string = current.claim_status;
    let stage: string = current.claim_stage;
    let owner: string = current.assigned_to;
    let nextAction: string = current.next_action;
    let dueAt: string | null = current.due_at?.toISOString() ?? null;
    let eventType = "CASE_EDITED";
    if (value.action.type === "edit") {
      const eligible = await client.query("SELECT smiley_private.lock_case_owner($1::bigint,$2::bigint) AS allowed", [value.action.ownerId,current.branch_id]);
      if (!eligible.rows[0].allowed) throw new AccessError(400, "Assign an active preparation officer in this branch.");
      owner = value.action.ownerId; nextAction = value.action.nextAction; dueAt = value.action.dueAt;
    } else if (value.action.type === "status") {
      const transitions: Record<string, string[]> = { DRAFT: ["PENDING", "CANCELLED"], PENDING: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["CANCELLED"], QUERY: ["CANCELLED"] };
      if (!transitions[status]?.includes(value.action.status)) throw new AccessError(409, "This preparation transition is unavailable. Payer decisions are recorded in a later phase.");
      status = value.action.status; eventType = "PREPARATION_STATUS_CHANGED";
    } else if (value.action.type === "query-open") {
      if (!["IN_PROGRESS", "QUERY"].includes(status)) throw new AccessError(409, "Start preparation before recording a payer query.");
      const existing = await client.query("SELECT query_id FROM claim_queries WHERE hospital_id=$1 AND claim_id=$2 AND external_reference=$3", [actor.hospitalId, caseId, value.action.reference]);
      if (existing.rowCount) throw new AccessError(409, "This query reference is already recorded for the case.");
      await client.query(`INSERT INTO claim_queries(hospital_id,branch_id,claim_id,query_no,external_reference,query_text,query_date,status,assigned_to)
        VALUES($1,$2,$3,$4,$5,$6,now(),'OPEN',$7)`, [actor.hospitalId, current.branch_id, caseId, `Q-${randomUUID()}`, value.action.reference, value.action.text, current.assigned_to]);
      status = "QUERY"; stage = "QUERY"; eventType = "PAYER_QUERY_RECORDED";
    } else {
      if (!["IN_PROGRESS", "QUERY"].includes(status)) throw new AccessError(409, "Start preparation before preparing a payer query response.");
      const recorded = await client.query("SELECT query_id,status FROM claim_queries WHERE hospital_id=$1 AND claim_id=$2 AND external_reference=$3 FOR UPDATE", [actor.hospitalId, caseId, value.action.reference]);
      if (!recorded.rowCount || !["OPEN", "RESPONDED"].includes(recorded.rows[0].status)) throw new AccessError(409, "This query is unavailable for a prepared response.");
      await client.query("UPDATE claim_queries SET response_text=$1,responded_at=now(),status='RESPONDED' WHERE query_id=$2 AND hospital_id=$3", [value.action.text, recorded.rows[0].query_id, actor.hospitalId]);
      eventType = "QUERY_RESPONSE_PREPARED";
    }
    const version: number = current.version + 1;
    const eventId = randomUUID();
    await client.query("UPDATE claims SET claim_status=$1,claim_stage=$2,assigned_to=$3,next_action=$4,due_at=$5,version=$6 WHERE claim_id=$7 AND hospital_id=$8", [status, stage, owner, nextAction, dueAt, version, caseId, actor.hospitalId]);
    const after = { status, ownerId: owner, nextAction, dueAt };
    const payload = { action: value.action, before, after };
    await client.query(`INSERT INTO claim_events(event_id,hospital_id,branch_id,claim_id,actor_user_id,event_type,occurred_at,payload,idempotency_key,fingerprint,case_version)
      VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10)`, [eventId, actor.hospitalId, current.branch_id, caseId, actor.userId, eventType, JSON.stringify(payload), value.idempotencyKey, fingerprint, version]);
    await writeAudit(client, actor, String(current.branch_id), "claims", eventType, caseId, before, { ...after, version });
    return { caseId, version, eventId, idempotent: false };
  });
}

export async function getCaseTimeline(headers: Headers, caseId: string) {
  if (!id.safeParse(caseId).success) throw new AccessError(400, "Provide a valid case ID.");
  return withActorTransaction(headers, "case:read", undefined, async (client, actor) => {
    const found = await client.query("SELECT claim_id FROM claims WHERE claim_id=$1 AND hospital_id=$2", [caseId, actor.hospitalId]);
    if (!found.rowCount) throw new AccessError(404, "The case is unavailable in your assigned branches.");
    const events = await client.query(`SELECT e.event_id,e.event_type,e.occurred_at,e.recorded_at,e.case_version,e.payload,COALESCE(a.name,u.username) AS actor_name
      FROM claim_events e JOIN users u ON u.user_id=e.actor_user_id AND u.hospital_id=e.hospital_id LEFT JOIN auth_user a ON a.id=u.auth_user_id
      WHERE e.claim_id=$1 AND e.hospital_id=$2 ORDER BY e.recorded_at,e.event_id`, [caseId, actor.hospitalId]);
    const queries = await client.query("SELECT query_id,external_reference,query_text,response_text,status,query_date AS received_at,responded_at FROM claim_queries WHERE claim_id=$1 AND hospital_id=$2 ORDER BY query_date,query_id", [caseId, actor.hospitalId]);
    return { events: events.rows, queries: queries.rows };
  });
}
