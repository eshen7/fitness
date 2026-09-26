ALTER TABLE "food_log_entries" ADD COLUMN "phrase_key" text;--> statement-breakpoint
CREATE INDEX "food_log_entries_phrase_idx" ON "food_log_entries" USING btree ("phrase_key","logged_at");