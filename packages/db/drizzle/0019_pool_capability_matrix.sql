ALTER TABLE "model_provider_pool" ADD COLUMN "supports_tools" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD COLUMN "supports_parallel_tools" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD COLUMN "supports_reasoning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD COLUMN "reasoning_echo_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD COLUMN "supports_vision" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD COLUMN "usage_in_stream" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD COLUMN "context_length" integer;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD COLUMN "max_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD COLUMN "api_format" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_pool" ADD CONSTRAINT "model_provider_pool_api_format_check" CHECK ("model_provider_pool"."api_format" IN ('openai','anthropic'));