CREATE TABLE "claim_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hospital_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"claim_id" bigint NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"case_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "uq_claim_record_scope" UNIQUE("hospital_id","branch_id","claim_id","id"),
	CONSTRAINT "ck_claim_records_version" CHECK ("claim_records"."case_version" > 0),
	CONSTRAINT "ck_claim_records_payload" CHECK (jsonb_typeof("claim_records"."payload")='object'),
	CONSTRAINT "ck_claim_records_kind" CHECK ("claim_records"."kind" IN ('bill','assess','pack','submission','query-ack','query-resolve','decision','confirm','patient-receipt','patient-reversal','patient-refund'))
);
--> statement-breakpoint
ALTER TABLE "claim_records" ADD CONSTRAINT "fk_claim_records_claim" FOREIGN KEY ("hospital_id","branch_id","claim_id") REFERENCES "public"."claims"("hospital_id","branch_id","claim_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_records" ADD CONSTRAINT "fk_claim_records_actor" FOREIGN KEY ("hospital_id","actor_user_id") REFERENCES "public"."users"("hospital_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_claim_records_scope" ON "claim_records" USING btree ("hospital_id","branch_id","claim_id","case_version");
--> statement-breakpoint
CREATE TRIGGER claim_records_immutable BEFORE UPDATE OR DELETE ON public.claim_records FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation();
ALTER TABLE public.claim_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_records FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public.claim_records FOR ALL TO smiley_migrator USING(true) WITH CHECK(true);
CREATE POLICY scoped_read ON public.claim_records FOR SELECT TO smiley_app USING(smiley_private.in_branch(hospital_id,branch_id));

CREATE OR REPLACE FUNCTION smiley_private.in_branch(tenant bigint, branch bigint, writing boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, public, smiley_private AS $$
 SELECT smiley_private.in_hospital(tenant) AND
 branch = ANY(coalesce(string_to_array(nullif(current_setting(CASE WHEN writing THEN 'app.write_branch_ids' ELSE 'app.branch_ids' END,true),''),',')::bigint[],ARRAY[]::bigint[]))
 AND EXISTS(SELECT 1 FROM public.branches b WHERE b.hospital_id=tenant AND b.branch_id=branch AND b.status='ACTIVE')
 AND (EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r USING(role_id)
 WHERE ur.user_id=smiley_private.own_user_id() AND r.role_code='HOSPITAL_ADMIN' AND r.status='ACTIVE')
 OR EXISTS(SELECT 1 FROM public.user_branch_memberships m JOIN public.roles r USING(role_id)
 WHERE m.user_id=smiley_private.own_user_id() AND m.hospital_id=tenant AND m.branch_id=branch
 AND m.status='ACTIVE' AND r.status='ACTIVE' AND
 ((NOT writing AND r.role_code IN ('INSURANCE_EXECUTIVE','TPA_EXECUTIVE','CLAIM_VERIFIER','BILLING_OFFICER','FINANCE_OFFICER','REPORT_USER','DOCTOR','RECEPTIONIST'))
 OR (current_setting('app.permission',true) IN ('case:write','case:act','document:write','patient:write') AND r.role_code IN ('INSURANCE_EXECUTIVE','TPA_EXECUTIVE','CLAIM_VERIFIER'))
 OR (current_setting('app.permission',true)='billing:write' AND r.role_code='BILLING_OFFICER')
 OR (current_setting('app.permission',true)='finance:write' AND r.role_code='FINANCE_OFFICER')
 OR (current_setting('app.can_register',true)='true' AND current_setting('app.permission',true)='patient:write' AND r.role_code='RECEPTIONIST'))))
$$;

CREATE POLICY scoped_insert ON public.claim_records FOR INSERT TO smiley_app WITH CHECK (
 smiley_private.in_branch(hospital_id,branch_id,true) AND actor_user_id=smiley_private.own_user_id() AND
 ((current_setting('app.permission',true)='billing:write' AND kind IN ('bill','assess','confirm','patient-receipt','patient-reversal'))
 OR (current_setting('app.permission',true)='finance:write' AND kind='patient-refund')
 OR (current_setting('app.permission',true)='case:act' AND kind IN ('pack','submission','query-ack','query-resolve','decision'))));

DROP POLICY scoped_update ON public.claims;
CREATE POLICY scoped_update ON public.claims FOR UPDATE TO smiley_app USING (
 smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.permission',true) IN ('case:write','case:act','document:write','billing:write','finance:write'))
 WITH CHECK (smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.permission',true) IN ('case:write','case:act','document:write','billing:write','finance:write'));
DROP POLICY scoped_insert ON public.claim_events;
CREATE POLICY scoped_insert ON public.claim_events FOR INSERT TO smiley_app WITH CHECK (
 smiley_private.in_branch(hospital_id,branch_id,true) AND actor_user_id=smiley_private.own_user_id()
 AND current_setting('app.permission',true) IN ('case:write','case:act','document:write','billing:write','finance:write'));

