ALTER TABLE "user_branch_memberships" ADD COLUMN "granted_by" bigint;--> statement-breakpoint
ALTER TABLE "user_branch_memberships" ADD COLUMN "granted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_branch_memberships" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_branch_memberships" ADD CONSTRAINT "fk_membership_granted_by" FOREIGN KEY ("hospital_id","granted_by") REFERENCES "public"."users"("hospital_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_fk_membership_granted_by" ON "user_branch_memberships" USING btree ("hospital_id","granted_by");--> statement-breakpoint
ALTER TABLE "user_branch_memberships" ADD CONSTRAINT "ck_membership_revocation_status" CHECK ("user_branch_memberships"."revoked_at" IS NULL OR "user_branch_memberships"."status" = 'REVOKED');