ALTER TABLE "request_logs" ADD COLUMN "served_provider_id" uuid;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "served_provider_model_id" text;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "attempts" integer;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "failover_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "attempt_latencies_ms" jsonb;