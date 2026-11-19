CREATE TABLE "doctor_bind_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" varchar(6) NOT NULL,
	"doctor_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"used_by_patient_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_patient_links" (
	"id" text PRIMARY KEY NOT NULL,
	"doctor_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"source" varchar DEFAULT 'bind-code' NOT NULL,
	"bound_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" varchar DEFAULT 'patient' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_bind_codes_code_uq" ON "doctor_bind_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "doctor_bind_codes_doctor_idx" ON "doctor_bind_codes" USING btree ("doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_patient_uq" ON "doctor_patient_links" USING btree ("doctor_id","patient_id");--> statement-breakpoint
CREATE INDEX "doctor_patient_doctor_idx" ON "doctor_patient_links" USING btree ("doctor_id","status");--> statement-breakpoint
CREATE INDEX "doctor_patient_patient_idx" ON "doctor_patient_links" USING btree ("patient_id","status");