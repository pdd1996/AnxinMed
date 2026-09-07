CREATE TABLE "insight_ask_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text,
	"question" text NOT NULL,
	"mode" varchar NOT NULL,
	"intent" text,
	"tool_used" text,
	"answer_snapshot" jsonb,
	"citations" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
