ALTER TABLE "exercises" ADD COLUMN "equipment_any_of" "equipment"[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "protocol_phase" smallint;--> statement-breakpoint
-- `equipment` now means needed all together, and interchangeable items move to
-- `equipment_any_of`. Stock rows still holding the old mixed list are rewritten
-- to the new meaning; a row whose list the owner has since edited is left alone,
-- because that edit is the owner's fact about their gym.
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{barbell,dumbbell}'::equipment[], "updated_at" = now() WHERE "slug" = 'jump-squat-loaded' AND "is_stock" AND "equipment" = '{barbell,dumbbell}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{machine,dumbbell}'::equipment[], "updated_at" = now() WHERE "slug" = 'standing-calf-raise' AND "is_stock" AND "equipment" = '{machine,dumbbell}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{machine,dumbbell}'::equipment[], "updated_at" = now() WHERE "slug" = 'slow-heavy-calf-raise' AND "is_stock" AND "equipment" = '{machine,dumbbell}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{cable,machine}'::equipment[], "updated_at" = now() WHERE "slug" = 'lat-pulldown' AND "is_stock" AND "equipment" = '{cable,machine}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{rack,gym_rings}'::equipment[], "updated_at" = now() WHERE "slug" = 'inverted-row' AND "is_stock" AND "equipment" = '{barbell,rack,gym_rings}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{dumbbell,cable}'::equipment[], "updated_at" = now() WHERE "slug" = 'lateral-raise' AND "is_stock" AND "equipment" = '{dumbbell,cable}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{cable,band}'::equipment[], "updated_at" = now() WHERE "slug" = 'face-pull' AND "is_stock" AND "equipment" = '{cable,band}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{cable,band}'::equipment[], "updated_at" = now() WHERE "slug" = 'pallof-press' AND "is_stock" AND "equipment" = '{cable,band}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{dumbbell,kettlebell}'::equipment[], "updated_at" = now() WHERE "slug" = 'farmers-carry' AND "is_stock" AND "equipment" = '{dumbbell,kettlebell}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{}'::equipment[], "equipment_any_of" = '{dumbbell,kettlebell}'::equipment[], "updated_at" = now() WHERE "slug" = 'suitcase-carry' AND "is_stock" AND "equipment" = '{dumbbell,kettlebell}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{none}'::equipment[], "equipment_any_of" = '{}'::equipment[], "updated_at" = now() WHERE "slug" = 'tibialis-raise' AND "is_stock" AND "equipment" = '{none,band}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{none}'::equipment[], "equipment_any_of" = '{}'::equipment[], "updated_at" = now() WHERE "slug" = 'ankle-dorsiflexion-mobilization' AND "is_stock" AND "equipment" = '{none,band}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{dip_station}'::equipment[], "equipment_any_of" = '{}'::equipment[], "updated_at" = now() WHERE "slug" = 'dip' AND "is_stock" AND "equipment" = '{dip_station,weight_vest}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{none}'::equipment[], "equipment_any_of" = '{}'::equipment[], "updated_at" = now() WHERE "slug" = 'push-up' AND "is_stock" AND "equipment" = '{none,weight_vest}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{pullup_bar}'::equipment[], "equipment_any_of" = '{}'::equipment[], "updated_at" = now() WHERE "slug" = 'pull-up' AND "is_stock" AND "equipment" = '{pullup_bar,weight_vest}'::equipment[];
--> statement-breakpoint
UPDATE "exercises" SET "equipment" = '{pullup_bar}'::equipment[], "equipment_any_of" = '{}'::equipment[], "updated_at" = now() WHERE "slug" = 'chin-up' AND "is_stock" AND "equipment" = '{pullup_bar,weight_vest}'::equipment[];
--> statement-breakpoint
-- Tag the stock tendon protocol prescriptions. The column is new, so there is no
-- owner edit to preserve. Phase 4 is ordinary jumping at a managed dose, so no
-- single exercise is its prescription and nothing is tagged 4.
UPDATE "exercises" SET "protocol_phase" = 1, "updated_at" = now() WHERE "is_stock" AND "slug" IN ('spanish-squat-isometric', 'single-leg-extension-isometric', 'isometric-calf-hold');
--> statement-breakpoint
UPDATE "exercises" SET "protocol_phase" = 2, "updated_at" = now() WHERE "is_stock" AND "slug" IN ('slow-heavy-leg-extension', 'slow-heavy-calf-raise');
--> statement-breakpoint
UPDATE "exercises" SET "protocol_phase" = 3, "updated_at" = now() WHERE "is_stock" AND "slug" = 'depth-landing';
