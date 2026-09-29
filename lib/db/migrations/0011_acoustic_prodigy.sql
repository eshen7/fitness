ALTER TABLE "profile" ADD COLUMN "guide_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "profile_saved_at" timestamp with time zone;--> statement-breakpoint
-- An owner who had already filled in the profile has saved it, so the setup guide should not ask again.
UPDATE "profile" SET "profile_saved_at" = "updated_at" WHERE cardinality("available_equipment") > 0 OR cardinality("trainable_weekdays") > 0;
