ALTER TABLE "interaction_rules" ADD COLUMN "status" varchar DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "interaction_rules" ADD COLUMN "source_type" varchar;--> statement-breakpoint
ALTER TABLE "interaction_rules" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "interaction_rules" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "interaction_rules" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "interaction_rules" ADD COLUMN "reviewed_at" timestamp;