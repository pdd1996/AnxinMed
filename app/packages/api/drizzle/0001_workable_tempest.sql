CREATE TABLE "drugs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"generic_name" text NOT NULL,
	"brand_name" text,
	"specification" text,
	"form" text,
	"manufacturer" text,
	"drug_master_id" text,
	"confirm_status" varchar NOT NULL,
	"stock" jsonb,
	"opened_at" date,
	"expiry" date,
	"source_id" text,
	"confirmed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"field_key" text NOT NULL,
	"value" text,
	"source_meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"drug_id" text NOT NULL,
	"dose" jsonb NOT NULL,
	"frequency" integer NOT NULL,
	"times" jsonb NOT NULL,
	"route" text,
	"meal" text,
	"cycle_type" varchar NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" varchar DEFAULT 'active' NOT NULL,
	"source" varchar NOT NULL,
	"source_id" text,
	"item_id" text,
	"tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"scheduled_time" text NOT NULL,
	"status" varchar NOT NULL,
	"acted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar NOT NULL,
	"body_image_ref" text,
	"whitelist_fields" jsonb,
	"prescription_no" text,
	"confirm_trace" jsonb,
	"sanitize_audit" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
