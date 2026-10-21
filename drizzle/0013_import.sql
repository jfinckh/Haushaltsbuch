CREATE TABLE "import" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"bank" text NOT NULL,
	"file_name_encrypted" text NOT NULL,
	"file_encrypted" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"row_count" integer NOT NULL,
	"new_count" integer NOT NULL,
	"duplicate_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "import_bank_check" CHECK ("import"."bank" IN ('ing', 'trade_republic'))
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"account_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"line" integer NOT NULL,
	"raw_encrypted" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "import_account_id_idx" ON "import" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_row_account_fingerprint_idx" ON "import_row" USING btree ("account_id","fingerprint");--> statement-breakpoint
CREATE INDEX "import_row_import_id_idx" ON "import_row" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "import_row_transaction_id_idx" ON "import_row" USING btree ("transaction_id");