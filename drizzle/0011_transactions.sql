CREATE TABLE "transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"booking_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"kind" text NOT NULL,
	"category" text,
	"counterparty_encrypted" text,
	"counterparty_iban_encrypted" text,
	"counterparty_iban_index" text,
	"reference_encrypted" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_amount_check" CHECK ("transaction"."amount_cents" <> 0),
	CONSTRAINT "transaction_kind_check" CHECK ("transaction"."kind" IN ('expense', 'income', 'transfer', 'saving')),
	CONSTRAINT "transaction_category_check" CHECK ("transaction"."category" IS NULL OR "transaction"."kind" IN ('expense', 'income')),
	CONSTRAINT "transaction_iban_pair_check" CHECK (("transaction"."counterparty_iban_encrypted" IS NULL) = ("transaction"."counterparty_iban_index" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "transaction_account_date_idx" ON "transaction" USING btree ("account_id","booking_date");--> statement-breakpoint
CREATE INDEX "transaction_counterparty_iban_index_idx" ON "transaction" USING btree ("counterparty_iban_index");