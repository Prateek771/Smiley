import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { hospitals, insurancePolicies, users } from "./schema";

export const ruleRevisions = pgTable("rule_revisions", {
  id: uuid("id").primaryKey(), hospitalId: bigint("hospital_id", { mode: "bigint" }).notNull(), policyId: bigint("policy_id", { mode: "bigint" }).notNull(),
  name: text("name").notNull(), rule: jsonb("rule").notNull(), reason: text("reason").notNull(), createdBy: bigint("created_by", { mode: "bigint" }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("uq_rule_revision_scope").on(t.hospitalId, t.id), index("ix_rule_policy").on(t.hospitalId, t.policyId), index("ix_rule_actor").on(t.hospitalId, t.createdBy),
  foreignKey({ name: "fk_rule_hospital", columns: [t.hospitalId], foreignColumns: [hospitals.hospitalId] }).onDelete("restrict"),
  foreignKey({ name: "fk_rule_policy", columns: [t.policyId], foreignColumns: [insurancePolicies.policyId] }).onDelete("restrict"),
  foreignKey({ name: "fk_rule_actor", columns: [t.hospitalId, t.createdBy], foreignColumns: [users.hospitalId, users.userId] }).onDelete("restrict")]);
export const ruleLifecycleEvents = pgTable("rule_lifecycle_events", {
  id: uuid("id").primaryKey(), hospitalId: bigint("hospital_id", { mode: "bigint" }).notNull(), ruleId: uuid("rule_id").notNull(), version: integer("version").notNull(), status: text("status").notNull(),
  reason: text("reason").notNull(), actorId: bigint("actor_id", { mode: "bigint" }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("uq_rule_lifecycle_version").on(t.ruleId, t.version), check("ck_rule_lifecycle_version", sql`${t.version} > 0`), check("ck_rule_lifecycle_status", sql`${t.status} IN ('DRAFT','APPROVED','RETIRED')`),
  index("ix_rule_lifecycle_scope").on(t.hospitalId, t.ruleId, t.version), index("ix_rule_lifecycle_actor").on(t.hospitalId, t.actorId),
  foreignKey({ name: "fk_rule_lifecycle_revision", columns: [t.hospitalId, t.ruleId], foreignColumns: [ruleRevisions.hospitalId, ruleRevisions.id] }).onDelete("restrict"),
  foreignKey({ name: "fk_rule_lifecycle_actor", columns: [t.hospitalId, t.actorId], foreignColumns: [users.hospitalId, users.userId] }).onDelete("restrict")]);
