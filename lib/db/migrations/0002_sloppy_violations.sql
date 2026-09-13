CREATE TYPE "public"."unit_system" AS ENUM('imperial', 'metric');--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "unit_system" "unit_system" DEFAULT 'imperial' NOT NULL;