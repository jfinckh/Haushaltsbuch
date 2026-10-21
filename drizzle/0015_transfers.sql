CREATE TABLE "transfer_booking" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"mentioned_iban_index" text,
	"mentioned_bank" text,
	"counterparty_member_id" text,
	"expects_partner" boolean DEFAULT false NOT NULL,
	"decision" text,
	"decided_kind" text,
	"target" text,
	"target_account_id" text,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_booking_decision_check" CHECK ("transfer_booking"."decision" IS NULL OR "transfer_booking"."decision" IN ('kind', 'no-partner')),
	CONSTRAINT "transfer_booking_kind_check" CHECK (("transfer_booking"."decision" = 'kind') = ("transfer_booking"."decided_kind" IS NOT NULL)),
	CONSTRAINT "transfer_booking_target_check" CHECK (("transfer_booking"."decision" = 'no-partner') = ("transfer_booking"."target" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "transfer_pair" (
	"id" text PRIMARY KEY NOT NULL,
	"outgoing_transaction_id" text NOT NULL,
	"incoming_transaction_id" text NOT NULL,
	"status" text NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"decided_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_pair_status_check" CHECK ("transfer_pair"."status" IN ('linked', 'proposed', 'rejected')),
	CONSTRAINT "transfer_pair_sides_check" CHECK ("transfer_pair"."outgoing_transaction_id" <> "transfer_pair"."incoming_transaction_id")
);
--> statement-breakpoint
CREATE INDEX "transfer_booking_iban_idx" ON "transfer_booking" USING btree ("mentioned_iban_index");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_pair_bookings_idx" ON "transfer_pair" USING btree ("outgoing_transaction_id","incoming_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_pair_linked_outgoing_idx" ON "transfer_pair" USING btree ("outgoing_transaction_id") WHERE status = 'linked';--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_pair_linked_incoming_idx" ON "transfer_pair" USING btree ("incoming_transaction_id") WHERE status = 'linked';--> statement-breakpoint
CREATE INDEX "transfer_pair_incoming_idx" ON "transfer_pair" USING btree ("incoming_transaction_id");