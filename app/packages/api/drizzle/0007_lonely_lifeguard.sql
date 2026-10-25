ALTER TABLE "package_inserts" ADD COLUMN "source_sections" jsonb;--> statement-breakpoint
ALTER TABLE "package_inserts" ADD COLUMN "source_file" text;--> statement-breakpoint
ALTER TABLE "package_inserts" ADD COLUMN "source_record_ids" jsonb;--> statement-breakpoint
ALTER TABLE "package_inserts" ADD COLUMN "approval_numbers" jsonb;