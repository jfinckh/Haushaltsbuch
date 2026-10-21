CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"household_id" text,
	"visibility" text NOT NULL,
	"name" text NOT NULL,
	"bank" text NOT NULL,
	"type" text NOT NULL,
	"role" text NOT NULL,
	"opening_balance_cents" bigint DEFAULT 0 NOT NULL,
	"iban_encrypted" text,
	"iban_index" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_visibility_check" CHECK ("account"."visibility" IN ('private', 'shared')),
	CONSTRAINT "account_household_check" CHECK (("account"."visibility" = 'shared') = ("account"."household_id" IS NOT NULL)),
	CONSTRAINT "account_bank_check" CHECK ("account"."bank" IN ('ing', 'trade_republic', 'cash', 'other')),
	CONSTRAINT "account_type_check" CHECK ("account"."type" IN ('checking', 'savings', 'clearing', 'depot', 'cash')),
	CONSTRAINT "account_role_check" CHECK ("account"."role" IN ('everyday', 'savings')),
	CONSTRAINT "account_cash_check" CHECK (("account"."bank" = 'cash') = ("account"."type" = 'cash')),
	CONSTRAINT "account_iban_pair_check" CHECK (("account"."iban_encrypted" IS NULL) = ("account"."iban_index" IS NULL)),
	CONSTRAINT "account_cash_iban_check" CHECK ("account"."bank" <> 'cash' OR "account"."iban_encrypted" IS NULL)
);
--> statement-breakpoint
CREATE INDEX "account_owner_user_id_idx" ON "account" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "account_household_id_idx" ON "account" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "account_iban_index_idx" ON "account" USING btree ("iban_index");