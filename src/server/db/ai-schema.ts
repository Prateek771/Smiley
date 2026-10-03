import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { claims, documentRevisions, users } from "./schema";
import { authUser } from "./auth-schema";
const scope = () => ({ hospitalId: bigint("hospital_id", { mode: "bigint" }).notNull(), branchId: bigint("branch_id", { mode: "bigint" }).notNull(), claimId: bigint("claim_id", { mode: "bigint" }).notNull() });
export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").primaryKey(), ...scope(), actorUserId: bigint("actor_user_id", { mode: "bigint" }).notNull(), authOwnerId: text("auth_owner_id").notNull().references(() => authUser.id),
  kind: text("kind").notNull(), inputVersion: integer("input_version").notNull(), inputFingerprint: text("input_fingerprint").notNull(), requestFingerprint: text("request_fingerprint").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), queryReference: text("query_reference"), querySnapshot: jsonb("query_snapshot"), synthetic: boolean("synthetic").notNull(), retryOf: uuid("retry_of"),
  status: text("status").notNull().default("QUEUED"), attempts: integer("attempts").notNull().default(0), reason: text("reason"), result: jsonb("result"),
  workerPid: integer("worker_pid"), workerHost: text("worker_host"), queueWorkerId: text("queue_worker_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("ai_runs_hospital_id_branch_id_claim_id_id_key").on(table.hospitalId, table.branchId, table.claimId, table.id), unique("ai_runs_hospital_id_claim_id_idempotency_key_key").on(table.hospitalId, table.claimId, table.idempotencyKey),
  foreignKey({ columns: [table.hospitalId, table.branchId, table.claimId], foreignColumns: [claims.hospitalId, claims.branchId, claims.claimId] }), foreignKey({ columns: [table.hospitalId, table.actorUserId], foreignColumns: [users.hospitalId, users.userId] }),
  foreignKey({ columns: [table.hospitalId, table.branchId, table.claimId, table.retryOf], foreignColumns: [table.hospitalId, table.branchId, table.claimId, table.id] }),
  index("ix_ai_run_scope").on(table.hospitalId, table.branchId, table.claimId, table.createdAt), index("ix_ai_run_actor").on(table.hospitalId, table.actorUserId), index("ix_ai_run_auth").on(table.authOwnerId), index("ix_ai_run_retry").on(table.retryOf),
  check("ai_runs_kind_check", sql`${table.kind} IN ('EXTRACTION','PACK_CHECK','RESPONSE_DRAFT')`), check("ai_runs_synthetic_check", sql`${table.synthetic}`), check("ai_runs_attempts_check", sql`${table.attempts} BETWEEN 0 AND 3`),
  check("ai_runs_input_version_check", sql`${table.inputVersion}>0`), check("ai_runs_input_fingerprint_check", sql`${table.inputFingerprint} ~ '^[0-9a-f]{64}$'`), check("ai_runs_request_fingerprint_check", sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`), check("ai_runs_idempotency_key_check", sql`length(${table.idempotencyKey}) BETWEEN 8 AND 100`),
  check("ai_runs_status_check", sql`${table.status} IN ('QUEUED','RUNNING','RETRYING','COMPLETE','FAILED','STALE','DENIED','REVIEW_REQUIRED')`), check("ai_runs_check", sql`(${table.kind}='RESPONSE_DRAFT' AND ${table.queryReference} IS NOT NULL AND ${table.querySnapshot} IS NOT NULL) OR (${table.kind}<>'RESPONSE_DRAFT' AND ${table.queryReference} IS NULL AND ${table.querySnapshot} IS NULL)`), check("ai_runs_result_check", sql`${table.result} IS NULL OR jsonb_typeof(${table.result})='object'`),
]);
export const aiRunSources = pgTable("ai_run_sources", {
  ...scope(), runId: uuid("run_id").notNull(), revisionId: text("revision_id").notNull(), sha256: text("sha256").notNull(), documentType: text("document_type").notNull(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.revisionId] }), check("ai_run_sources_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`), foreignKey({ columns: [table.hospitalId, table.branchId, table.claimId, table.runId], foreignColumns: [aiRuns.hospitalId, aiRuns.branchId, aiRuns.claimId, aiRuns.id] }),
  foreignKey({ columns: [table.hospitalId, table.branchId, table.claimId, table.revisionId], foreignColumns: [documentRevisions.hospitalId, documentRevisions.branchId, documentRevisions.claimId, documentRevisions.revisionId] }),
  index("ix_ai_source_scope").on(table.hospitalId, table.branchId, table.claimId), index("ix_ai_source_revision").on(table.hospitalId, table.branchId, table.claimId, table.revisionId),
]);
export const aiReviews = pgTable("ai_reviews", {
  id: uuid("id").primaryKey(), ...scope(), runId: uuid("run_id").notNull(), actorUserId: bigint("actor_user_id", { mode: "bigint" }).notNull(), itemIndex: integer("item_index").notNull(), action: text("action").notNull(), value: text("value"), reason: text("reason").notNull(), inputFingerprint: text("input_fingerprint").notNull(), requestFingerprint: text("request_fingerprint").notNull(), idempotencyKey: text("idempotency_key").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("ai_reviews_hospital_id_claim_id_idempotency_key_key").on(table.hospitalId, table.claimId, table.idempotencyKey), foreignKey({ columns: [table.hospitalId, table.branchId, table.claimId, table.runId], foreignColumns: [aiRuns.hospitalId, aiRuns.branchId, aiRuns.claimId, aiRuns.id] }), foreignKey({ columns: [table.hospitalId, table.actorUserId], foreignColumns: [users.hospitalId, users.userId] }), index("ix_ai_review_scope").on(table.hospitalId, table.branchId, table.claimId, table.runId, table.createdAt), index("ix_ai_review_actor").on(table.hospitalId, table.actorUserId),
  check("ai_reviews_item_index_check", sql`${table.itemIndex}>=-1`), check("ai_reviews_action_check", sql`${table.action} IN ('ACCEPT','CORRECT','REJECT')`), check("ai_reviews_reason_check", sql`length(${table.reason}) BETWEEN 1 AND 2000`), check("ai_reviews_idempotency_key_check", sql`length(${table.idempotencyKey}) BETWEEN 8 AND 100`), check("ai_reviews_value_check", sql`${table.value} IS NULL OR length(${table.value})<=20000`),
]);
