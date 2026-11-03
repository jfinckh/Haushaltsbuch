CREATE TABLE "recurring_occurrence" (
	"template_id" text NOT NULL,
	"due_date" date NOT NULL,
	"transaction_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_occurrence_template_id_due_date_pk" PRIMARY KEY("template_id","due_date")
);
--> statement-breakpoint
CREATE TABLE "recurring_template" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"kind" text NOT NULL,
	"category" text,
	"counterparty_encrypted" text,
	"counterparty_iban_encrypted" text,
	"counterparty_iban_index" text,
	"reference_encrypted" text,
	"counts_next_month" boolean,
	"classified_by" text NOT NULL,
	"interval_months" integer NOT NULL,
	"day_of_month" integer NOT NULL,
	"next_due_date" date NOT NULL,
	"end_date" date,
	"paused" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_template_amount_check" CHECK ("recurring_template"."amount_cents" <> 0),
	CONSTRAINT "recurring_template_kind_check" CHECK ("recurring_template"."kind" IN ('expense', 'income', 'transfer', 'saving')),
	CONSTRAINT "recurring_template_category_check" CHECK ("recurring_template"."category" IS NULL OR "recurring_template"."kind" IN ('expense', 'income')),
	CONSTRAINT "recurring_template_iban_pair_check" CHECK (("recurring_template"."counterparty_iban_encrypted" IS NULL) = ("recurring_template"."counterparty_iban_index" IS NULL)),
	CONSTRAINT "recurring_template_classified_by_check" CHECK ("recurring_template"."classified_by" IN ('auto', 'manual')),
	CONSTRAINT "recurring_template_interval_check" CHECK ("recurring_template"."interval_months" IN (1, 3, 6, 12)),
	CONSTRAINT "recurring_template_day_check" CHECK ("recurring_template"."day_of_month" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE INDEX "recurring_occurrence_transaction_idx" ON "recurring_occurrence" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "recurring_template_account_idx" ON "recurring_template" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "recurring_template_next_due_idx" ON "recurring_template" USING btree ("next_due_date");