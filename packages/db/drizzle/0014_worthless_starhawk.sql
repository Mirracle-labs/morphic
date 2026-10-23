CREATE INDEX "usage_user_created_idx" ON "usage_records" USING btree ("user_id","created_at");--> statement-breakpoint
DROP INDEX "usage_user_idx";