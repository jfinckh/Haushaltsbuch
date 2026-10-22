CREATE TABLE "booking_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"household_id" text,
	"owner_user_id" text,
	"counterparty_pattern_encrypted" text,
	"reference_pattern_encrypted" text,
	"amount_sign" text,
	"result_kind" text NOT NULL,
	"result_category" text,
	"transfer_target" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "booking_rule_scope_check" CHECK (num_nonnulls("booking_rule"."account_id", "booking_rule"."household_id", "booking_rule"."owner_user_id") = 1),
	CONSTRAINT "booking_rule_pattern_check" CHECK ("booking_rule"."counterparty_pattern_encrypted" IS NOT NULL OR "booking_rule"."reference_pattern_encrypted" IS NOT NULL),
	CONSTRAINT "booking_rule_sign_check" CHECK ("booking_rule"."amount_sign" IS NULL OR "booking_rule"."amount_sign" IN ('negative', 'positive')),
	CONSTRAINT "booking_rule_kind_check" CHECK ("booking_rule"."result_kind" IN ('expense', 'income', 'transfer', 'saving')),
	CONSTRAINT "booking_rule_category_check" CHECK ("booking_rule"."result_category" IS NULL OR "booking_rule"."result_kind" IN ('expense', 'income')),
	CONSTRAINT "booking_rule_target_check" CHECK ("booking_rule"."transfer_target" IS NULL OR ("booking_rule"."transfer_target" = 'external' AND "booking_rule"."result_kind" IN ('transfer', 'saving')))
);
--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "classified_by" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_booking" ADD COLUMN "rule_target" text;--> statement-breakpoint
CREATE INDEX "booking_rule_account_idx" ON "booking_rule" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "booking_rule_household_idx" ON "booking_rule" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "booking_rule_owner_idx" ON "booking_rule" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_classified_by_check" CHECK ("transaction"."classified_by" IN ('auto', 'rule', 'manual'));--> statement-breakpoint
ALTER TABLE "transfer_booking" ADD CONSTRAINT "transfer_booking_rule_target_check" CHECK ("transfer_booking"."rule_target" IS NULL OR "transfer_booking"."rule_target" = 'external');