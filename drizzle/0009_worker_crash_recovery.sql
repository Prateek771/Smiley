ALTER TABLE "case_jobs" ADD COLUMN "worker_pid" integer;--> statement-breakpoint
ALTER TABLE "case_jobs" ADD COLUMN "worker_host" text;--> statement-breakpoint
ALTER TABLE "case_jobs" ADD COLUMN "queue_worker_id" text;