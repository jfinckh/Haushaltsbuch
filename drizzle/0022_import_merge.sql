ALTER TABLE "import" ADD COLUMN "merged_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "merged_from_encrypted" text;