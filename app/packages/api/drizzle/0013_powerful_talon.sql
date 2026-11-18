ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");