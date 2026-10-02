CREATE TABLE "case_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hospital_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"claim_id" bigint NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"auth_owner_id" text NOT NULL,
	"pack_id" uuid NOT NULL,
	"input_version" integer NOT NULL,
	"input_fingerprint" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"retry_of" uuid,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_case_job_scope" UNIQUE("hospital_id","branch_id","claim_id","id"),
	CONSTRAINT "uq_case_job_key" UNIQUE("hospital_id","claim_id","idempotency_key"),
	CONSTRAINT "ck_job_status" CHECK ("case_jobs"."status" IN ('QUEUED','RUNNING','RETRYING','COMPLETE','FAILED','STALE','DENIED')),
	CONSTRAINT "ck_job_attempts" CHECK ("case_jobs"."attempts" BETWEEN 0 AND 3),
	CONSTRAINT "ck_job_version" CHECK ("case_jobs"."input_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "case_jobs" ADD CONSTRAINT "fk_case_job_pack" FOREIGN KEY ("hospital_id","branch_id","claim_id","pack_id") REFERENCES "public"."claim_records"("hospital_id","branch_id","claim_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_jobs" ADD CONSTRAINT "fk_case_job_actor" FOREIGN KEY ("hospital_id","actor_user_id") REFERENCES "public"."users"("hospital_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_jobs" ADD CONSTRAINT "fk_case_job_auth" FOREIGN KEY ("auth_owner_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_case_job_claim" ON "case_jobs" USING btree ("hospital_id","branch_id","claim_id");--> statement-breakpoint
CREATE INDEX "ix_case_job_actor" ON "case_jobs" USING btree ("hospital_id","actor_user_id");--> statement-breakpoint
CREATE INDEX "ix_case_job_retry" ON "case_jobs" USING btree ("retry_of");
--> statement-breakpoint
ALTER TABLE public.case_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY migration_cli ON public.case_jobs FOR ALL TO smiley_migrator USING(true) WITH CHECK(true);
CREATE POLICY scoped_read ON public.case_jobs FOR SELECT TO smiley_app USING(smiley_private.in_branch(hospital_id,branch_id));
CREATE POLICY scoped_insert ON public.case_jobs FOR INSERT TO smiley_app WITH CHECK(smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.permission',true)='case:act' AND actor_user_id=smiley_private.own_user_id() AND auth_owner_id=current_setting('app.auth_user_id',true) AND status='QUEUED' AND attempts=0 AND result IS NULL AND reason IS NULL);
CREATE FUNCTION smiley_private.enqueue_case_job(request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.case_jobs; BEGIN
 SELECT * INTO j FROM public.case_jobs WHERE id=request_id;
 IF j.id IS NULL OR j.actor_user_id<>smiley_private.own_user_id() OR j.auth_owner_id<>current_setting('app.auth_user_id',true) OR NOT smiley_private.in_branch(j.hospital_id,j.branch_id,true) OR current_setting('app.permission',true)<>'case:act' OR j.status<>'QUEUED' THEN RAISE EXCEPTION 'Job is outside active staff scope' USING ERRCODE='42501'; END IF;
 PERFORM graphile_worker.add_job('pack-review',json_build_object('requestId',request_id),max_attempts:=3,job_key:=request_id::text,job_key_mode:='unsafe_dedupe');
END $$;
REVOKE ALL ON FUNCTION smiley_private.enqueue_case_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION smiley_private.enqueue_case_job(uuid) TO smiley_app;

DROP POLICY scoped_insert ON public.remittance_receipts;
CREATE POLICY scoped_insert ON public.remittance_receipts FOR INSERT TO smiley_app WITH CHECK(smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.permission',true)='finance:write' AND actor_user_id=smiley_private.own_user_id());
DROP POLICY scoped_insert ON public.remittance_reversals;
CREATE POLICY scoped_insert ON public.remittance_reversals FOR INSERT TO smiley_app WITH CHECK(smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting('app.permission',true)='finance:write' AND actor_user_id=smiley_private.own_user_id());
