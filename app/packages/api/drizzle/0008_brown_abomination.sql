CREATE TABLE "drug_generics" (
	"id" text PRIMARY KEY NOT NULL,
	"generic_name" text NOT NULL,
	"form" text,
	"product_type" varchar,
	"active_ingredients" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" varchar NOT NULL,
	"source_name" text,
	"file_name" text,
	"file_hash" text,
	"content_hash" text,
	"source_record_ids" jsonb,
	"published_at" date,
	"retrieved_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drug_master" ADD COLUMN "generic_drug_id" text;--> statement-breakpoint
ALTER TABLE "drug_master" ADD COLUMN "repackager" text;--> statement-breakpoint
ALTER TABLE "drug_master" ADD COLUMN "approval_numbers" jsonb;--> statement-breakpoint
ALTER TABLE "drug_master" ADD COLUMN "product_type" varchar;--> statement-breakpoint
ALTER TABLE "drug_master" ADD COLUMN "identity_key" text;--> statement-breakpoint
ALTER TABLE "package_inserts" ADD COLUMN "source_document_id" text;--> statement-breakpoint
ALTER TABLE "package_inserts" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "drug_generics_name_form_uq" ON "drug_generics" USING btree ("generic_name","form");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_file_hash_uq" ON "source_documents" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "drug_master_identity_key_uq" ON "drug_master" USING btree ("identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "package_inserts_drug_source_uq" ON "package_inserts" USING btree ("drug_id","source_document_id");