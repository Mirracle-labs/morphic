ALTER TABLE "models" ALTER COLUMN "input_credits_per_1m" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "output_credits_per_1m" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "provider_cost_input_per_1m" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "models" ALTER COLUMN "provider_cost_output_per_1m" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "unlimited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "resets_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "kind" text DEFAULT 'balance' NOT NULL;--> statement-breakpoint
-- Packages tied to a model were the old fair-use day passes.
UPDATE "packages" SET "kind" = 'unlimited' WHERE "model_id" IS NOT NULL;--> statement-breakpoint
-- Rebase prices: old unit 1,000 credits = $1; new unit 1 credit = 1 base token, $1 = 40M credits
-- (Rp 16.000/USD at Rp 400 per 1M base tokens). Sell = cost x 1.3, floor 1x.
UPDATE "models" SET
  "provider_cost_input_per_1m" = "provider_cost_input_per_1m" * 40000,
  "provider_cost_output_per_1m" = "provider_cost_output_per_1m" * 40000;--> statement-breakpoint
UPDATE "models" SET
  "input_credits_per_1m" = GREATEST(1000000, CEIL(COALESCE("provider_cost_input_per_1m", "input_credits_per_1m" * 40000) * 1.3)),
  "output_credits_per_1m" = GREATEST(1000000, CEIL(COALESCE("provider_cost_output_per_1m", "output_credits_per_1m" * 40000) * 1.3));
