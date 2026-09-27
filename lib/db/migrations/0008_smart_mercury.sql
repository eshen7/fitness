DROP INDEX "derived_insights_key_idx";--> statement-breakpoint
ALTER TABLE "derived_insights" ALTER COLUMN "p_adjusted" SET DATA TYPE numeric(8, 7);--> statement-breakpoint
ALTER TABLE "derived_insights" ADD COLUMN "family" text DEFAULT 'load' NOT NULL;--> statement-breakpoint
ALTER TABLE "derived_insights" ADD COLUMN "min_n" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "derived_insights" ADD COLUMN "p" numeric(8, 7);--> statement-breakpoint
ALTER TABLE "derived_insights" ADD COLUMN "null_value" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "derived_insights" ADD COLUMN "blocked_by" text;--> statement-breakpoint
ALTER TABLE "memory_facts" ADD COLUMN "confirmation_reason" text;--> statement-breakpoint
CREATE INDEX "derived_insights_computed_idx" ON "derived_insights" USING btree ("computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "derived_insights_key_idx" ON "derived_insights" USING btree ("key");