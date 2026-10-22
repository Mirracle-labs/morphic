CREATE TABLE "model_provider_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"provider_model_id" text NOT NULL,
	"priority" integer NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"cost_input_per_1m" integer,
	"cost_output_per_1m" integer,
	"ttfb_timeout_ms" integer,
	"data_policy" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD CONSTRAINT "model_provider_pool_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD CONSTRAINT "model_provider_pool_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_pool_model_provider_unique" ON "model_provider_pool" USING btree ("model_id","provider_id");--> statement-breakpoint
CREATE INDEX "model_provider_pool_model_priority_idx" ON "model_provider_pool" USING btree ("model_id","priority");