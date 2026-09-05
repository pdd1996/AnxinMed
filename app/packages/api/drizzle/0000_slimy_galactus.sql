CREATE TABLE "drug_master" (
	"id" text PRIMARY KEY NOT NULL,
	"generic_name" text NOT NULL,
	"brand_name" text,
	"specification" text NOT NULL,
	"form" text NOT NULL,
	"manufacturer" text,
	"approval_number" text,
	"otc_class" text,
	"insurance_class" text,
	"is_original" boolean DEFAULT false,
	"curation_status" varchar DEFAULT 'mock' NOT NULL,
	"data_source" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"drug_ids" jsonb NOT NULL,
	"level" varchar NOT NULL,
	"note" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_inserts" (
	"id" text PRIMARY KEY NOT NULL,
	"drug_id" text NOT NULL,
	"generic_name" text NOT NULL,
	"brand_name" text,
	"form" text,
	"specification" text,
	"indication" text,
	"components" text,
	"dosage" jsonb,
	"contraindications" jsonb,
	"adverse_reactions" text,
	"precautions" jsonb,
	"interactions" text,
	"pharmacology" text,
	"pharmacokinetics" text,
	"storage" text,
	"after_opening_days" integer,
	"source" text,
	"version" text,
	"source_url" text,
	"curation_status" varchar DEFAULT 'mock' NOT NULL,
	"curation_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
