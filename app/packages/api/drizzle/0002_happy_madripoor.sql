CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
