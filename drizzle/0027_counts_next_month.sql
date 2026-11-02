-- A person's choice which month a booking counts for (null = automatic, src/transactions/counting-month.ts).
ALTER TABLE "transaction" ADD COLUMN "counts_next_month" boolean;
--> statement-breakpoint
-- app_user may update only listed columns (0021_tighter_rls.sql); the choice is changed by hand.
GRANT UPDATE ("counts_next_month") ON "transaction" TO app_user;
