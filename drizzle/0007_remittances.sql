CREATE TABLE "remittance_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hospital_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"receipt_id" uuid NOT NULL,
	"claim_id" bigint NOT NULL,
	"decision_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "uq_remittance_claim" UNIQUE("receipt_id","claim_id"),
	CONSTRAINT "ck_allocation_amount" CHECK ("remittance_allocations"."amount_paise" > 0 AND "remittance_allocations"."amount_paise" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "remittance_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hospital_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"evidence_case_id" bigint NOT NULL,
	"evidence_revision_id" text NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_remittance_scope" UNIQUE("hospital_id","branch_id","id"),
	CONSTRAINT "uq_remittance_reference" UNIQUE("hospital_id","branch_id","reference"),
	CONSTRAINT "uq_remittance_key" UNIQUE("hospital_id","branch_id","idempotency_key"),
	CONSTRAINT "ck_remittance_amount" CHECK ("remittance_receipts"."amount_paise" > 0 AND "remittance_receipts"."amount_paise" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "remittance_reversals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hospital_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"receipt_id" uuid NOT NULL,
	"evidence_case_id" bigint NOT NULL,
	"evidence_revision_id" text NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reversal_receipt" UNIQUE("receipt_id"),
	CONSTRAINT "uq_reversal_key" UNIQUE("hospital_id","branch_id","idempotency_key"),
	CONSTRAINT "uq_reversal_reference" UNIQUE("hospital_id","branch_id","reference")
);
--> statement-breakpoint
ALTER TABLE "remittance_allocations" ADD CONSTRAINT "fk_allocation_receipt" FOREIGN KEY ("hospital_id","branch_id","receipt_id") REFERENCES "public"."remittance_receipts"("hospital_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_allocations" ADD CONSTRAINT "fk_allocation_decision" FOREIGN KEY ("hospital_id","branch_id","claim_id","decision_id") REFERENCES "public"."claim_records"("hospital_id","branch_id","claim_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_receipts" ADD CONSTRAINT "fk_remittance_evidence" FOREIGN KEY ("hospital_id","branch_id","evidence_case_id","evidence_revision_id") REFERENCES "public"."document_revisions"("hospital_id","branch_id","claim_id","revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_receipts" ADD CONSTRAINT "fk_remittance_actor" FOREIGN KEY ("hospital_id","actor_user_id") REFERENCES "public"."users"("hospital_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_reversals" ADD CONSTRAINT "fk_reversal_receipt" FOREIGN KEY ("hospital_id","branch_id","receipt_id") REFERENCES "public"."remittance_receipts"("hospital_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_reversals" ADD CONSTRAINT "fk_reversal_evidence" FOREIGN KEY ("hospital_id","branch_id","evidence_case_id","evidence_revision_id") REFERENCES "public"."document_revisions"("hospital_id","branch_id","claim_id","revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_reversals" ADD CONSTRAINT "fk_reversal_actor" FOREIGN KEY ("hospital_id","actor_user_id") REFERENCES "public"."users"("hospital_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_allocation_claim" ON "remittance_allocations" USING btree ("hospital_id","branch_id","claim_id");--> statement-breakpoint
CREATE INDEX "ix_allocation_decision" ON "remittance_allocations" USING btree ("hospital_id","branch_id","claim_id","decision_id");--> statement-breakpoint
CREATE INDEX "ix_remittance_evidence" ON "remittance_receipts" USING btree ("hospital_id","branch_id","evidence_case_id");--> statement-breakpoint
CREATE INDEX "ix_remittance_actor" ON "remittance_receipts" USING btree ("hospital_id","actor_user_id");--> statement-breakpoint
CREATE INDEX "ix_reversal_receipt" ON "remittance_reversals" USING btree ("hospital_id","branch_id","receipt_id");--> statement-breakpoint
CREATE INDEX "ix_reversal_evidence" ON "remittance_reversals" USING btree ("hospital_id","branch_id","evidence_case_id");--> statement-breakpoint
CREATE INDEX "ix_reversal_actor" ON "remittance_reversals" USING btree ("hospital_id","actor_user_id");
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['remittance_receipts','remittance_allocations','remittance_reversals'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY migration_cli ON public.%I FOR ALL TO smiley_migrator USING(true) WITH CHECK(true)',t);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT TO smiley_app USING(smiley_private.in_branch(hospital_id,branch_id))',t);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT TO smiley_app WITH CHECK(smiley_private.in_branch(hospital_id,branch_id,true) AND current_setting(''app.permission'',true)=''finance:write'')',t);
  EXECUTE format('CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_history_mutation()',t);
 END LOOP;
END $$;
CREATE FUNCTION smiley_private.check_remittance_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt_amount bigint; allocated numeric; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.receipt_id::text,17));
 SELECT amount_paise INTO receipt_amount FROM public.remittance_receipts WHERE id=NEW.receipt_id AND hospital_id=NEW.hospital_id AND branch_id=NEW.branch_id;
 SELECT coalesce(sum(amount_paise),0) INTO allocated FROM public.remittance_allocations WHERE receipt_id=NEW.receipt_id;
 IF receipt_amount IS NULL OR allocated+NEW.amount_paise>receipt_amount OR EXISTS(SELECT 1 FROM public.remittance_reversals WHERE receipt_id=NEW.receipt_id) THEN RAISE EXCEPTION 'Invalid remittance allocation' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.claim_records WHERE id=NEW.decision_id AND hospital_id=NEW.hospital_id AND branch_id=NEW.branch_id AND claim_id=NEW.claim_id AND kind='decision') THEN RAISE EXCEPTION 'A payer decision is required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION smiley_private.check_remittance_allocation() FROM PUBLIC;
CREATE TRIGGER allocation_bounds BEFORE INSERT ON public.remittance_allocations FOR EACH ROW EXECUTE FUNCTION smiley_private.check_remittance_allocation();
