ALTER TABLE "claim_queries" ADD COLUMN "external_reference" varchar(150);--> statement-breakpoint
UPDATE "claim_queries" SET "external_reference" = "query_no" WHERE "external_reference" IS NULL;--> statement-breakpoint
ALTER TABLE "claim_queries" ALTER COLUMN "external_reference" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_queries" ADD CONSTRAINT "uq_claim_query_external_reference" UNIQUE("hospital_id","claim_id","external_reference");