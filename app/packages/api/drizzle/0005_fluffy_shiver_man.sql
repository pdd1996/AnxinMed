CREATE TABLE "consult_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consult_logs" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "consult_logs" ADD COLUMN "turn_no" integer;--> statement-breakpoint
ALTER TABLE "consult_logs" ADD COLUMN "intent" text;