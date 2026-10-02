CREATE TABLE "request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"user_id" uuid,
	"api_key_id" uuid,
	"model_alias" text NOT NULL,
	"resolved_model_id" uuid,
	"provider_name" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"credits_consumed" bigint,
	"latency_ms" integer,
	"gateway_latency_ms" integer,
	"status" text NOT NULL,
	"error_type" text,
	"streamed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_logs_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "replacement_model_alias" text;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "fallback_provider_id" uuid;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "circuit_breaker_state" jsonb DEFAULT '{"state":"closed","failures":0,"openUntil":null,"lastFailure":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_resolved_model_id_models_id_fk" FOREIGN KEY ("resolved_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "req_logs_user_idx" ON "request_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "req_logs_created_idx" ON "request_logs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_fallback_provider_id_providers_id_fk" FOREIGN KEY ("fallback_provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;