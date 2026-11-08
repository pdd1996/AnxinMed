CREATE TABLE "manual_review_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"insert_id" text NOT NULL,
	"action" varchar NOT NULL,
	"reviewer" text NOT NULL,
	"diff" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "package_inserts" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "package_inserts" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "package_inserts" ADD COLUMN "review_meta" jsonb;