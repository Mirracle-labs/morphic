CREATE TABLE "gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"purchaser_id" uuid NOT NULL,
	"design" text NOT NULL,
	"recipient_email" text,
	"redeem_code_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchaser_id_users_id_fk" FOREIGN KEY ("purchaser_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_redeem_code_id_redeem_codes_id_fk" FOREIGN KEY ("redeem_code_id") REFERENCES "public"."redeem_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_cards_purchaser_idx" ON "gift_cards" USING btree ("purchaser_id");