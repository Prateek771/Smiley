ALTER TABLE "claims" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "next_action" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "creation_key" varchar(150);--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "creation_fingerprint" text;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "uq_claim_creation_key" UNIQUE("hospital_id","branch_id","creation_key");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "ck_claims_version" CHECK ("claims"."version" > 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "ck_users_active_identity" CHECK ("users"."status" <> 'ACTIVE' OR "users"."auth_user_id" IS NOT NULL);