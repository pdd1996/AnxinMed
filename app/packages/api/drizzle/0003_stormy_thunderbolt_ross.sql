CREATE TABLE "consult_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question" text NOT NULL,
	"drug_ids" jsonb,
	"risk_level" varchar NOT NULL,
	"status" varchar NOT NULL,
	"blocked_at" varchar,
	"notice" text,
	"citations" jsonb,
	"sections_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"level" varchar NOT NULL,
	"type" varchar NOT NULL,
	"drug_id" text,
	"consult_log_id" text,
	"detail" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
