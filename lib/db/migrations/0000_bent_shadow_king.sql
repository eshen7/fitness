CREATE TYPE "public"."arm_swing" AS ENUM('pendulum', 'circular', 'running', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."coupling_class" AS ENUM('short_ssc', 'long_ssc', 'non_classical', 'not_plyometric');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('manual', 'whoop', 'derived');--> statement-breakpoint
CREATE TYPE "public"."equipment" AS ENUM('none', 'barbell', 'dumbbell', 'kettlebell', 'trap_bar', 'machine', 'cable', 'band', 'bench', 'rack', 'box', 'hurdle', 'sled', 'medicine_ball', 'pullup_bar', 'dip_station', 'ab_wheel', 'weight_vest', 'landmine', 'gym_rings');--> statement-breakpoint
CREATE TYPE "public"."force_velocity" AS ENUM('max_strength', 'speed_strength', 'reactive', 'shock', 'non_specific');--> statement-breakpoint
CREATE TYPE "public"."jumper_type" AS ENUM('speed', 'power', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."laterality" AS ENUM('bilateral', 'unilateral', 'alternating');--> statement-breakpoint
CREATE TYPE "public"."load_type" AS ENUM('stimulating', 'retaining', 'detraining');--> statement-breakpoint
CREATE TYPE "public"."meal_slot" AS ENUM('breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout');--> statement-breakpoint
CREATE TYPE "public"."measurement_kind" AS ENUM('bodyweight', 'standing_vertical', 'two_foot_approach_vertical', 'one_foot_approach_left', 'one_foot_approach_right', 'broad_jump', 'depth_jump_vertical', 'estimated_1rm', 'lean_mass', 'body_fat_pct', 'reach_height');--> statement-breakpoint
CREATE TYPE "public"."memory_fact_type" AS ENUM('preference', 'constraint', 'schedule', 'injury_history', 'response_pattern', 'goal', 'equipment');--> statement-breakpoint
CREATE TYPE "public"."memory_source" AS ENUM('stated', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."mesocycle_type" AS ENUM('accumulation', 'transmutation', 'realization');--> statement-breakpoint
CREATE TYPE "public"."motor_ability" AS ENUM('max_strength', 'explosive_strength', 'reactive_strength', 'speed_strength', 'rate_of_force_development', 'elastic_capacity', 'strength_endurance', 'hypertrophy', 'sprint_speed', 'work_capacity', 'mobility');--> statement-breakpoint
CREATE TYPE "public"."movement_pattern" AS ENUM('squat', 'hinge', 'lunge', 'calf_raise', 'jump_bilateral', 'jump_unilateral', 'bound', 'hop', 'depth_drop', 'sprint', 'throw', 'push_horizontal', 'push_vertical', 'pull_horizontal', 'pull_vertical', 'carry', 'brace', 'isometric_hold', 'mobility');--> statement-breakpoint
CREATE TYPE "public"."muscle_group" AS ENUM('posterior_chain', 'knee_extensors', 'lower_leg', 'core', 'upper_push', 'upper_pull', 'shoulders', 'full_body');--> statement-breakpoint
CREATE TYPE "public"."plane" AS ENUM('sagittal', 'frontal', 'transverse', 'multi');--> statement-breakpoint
CREATE TYPE "public"."proposal_scope" AS ENUM('mesocycle', 'microcycle', 'session');--> statement-breakpoint
CREATE TYPE "public"."proposal_verdict" AS ENUM('pending', 'accepted', 'edited', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('strength', 'plyometric', 'jump_technique', 'sprint', 'mixed', 'tendon_protocol', 'mobility', 'test', 'rest');--> statement-breakpoint
CREATE TYPE "public"."takeoff_leg" AS ENUM('left', 'right', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."tendon_site" AS ENUM('patellar_left', 'patellar_right', 'achilles_left', 'achilles_right');--> statement-breakpoint
CREATE TYPE "public"."whoop_record_type" AS ENUM('recovery', 'sleep', 'cycle', 'workout', 'body_measurement');--> statement-breakpoint
CREATE TABLE "exercise_suggestions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exercise_suggestions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"rationale" text NOT NULL,
	"proposed_attributes" jsonb NOT NULL,
	"accepted_exercise_id" integer,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_variants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exercise_variants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"exercise_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"modifiers" jsonb,
	"available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exercises_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"primary_muscle_group" "muscle_group" NOT NULL,
	"secondary_muscle_groups" "muscle_group"[] DEFAULT '{}' NOT NULL,
	"movement_pattern" "movement_pattern" NOT NULL,
	"force_velocity" "force_velocity" NOT NULL,
	"laterality" "laterality" NOT NULL,
	"plane" "plane" NOT NULL,
	"coupling_class" "coupling_class" DEFAULT 'not_plyometric' NOT NULL,
	"typical_contact_seconds" numeric(4, 3),
	"high_impact" boolean DEFAULT false NOT NULL,
	"equipment" "equipment"[] DEFAULT '{}' NOT NULL,
	"loads_tendon_sites" "tendon_site"[] DEFAULT '{}' NOT NULL,
	"tendon_load_rating" smallint DEFAULT 1 NOT NULL,
	"technical_complexity" smallint DEFAULT 1 NOT NULL,
	"cues" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"progression_of_id" integer,
	"regression_of_id" integer,
	"available" boolean DEFAULT true NOT NULL,
	"is_stock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "measurements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "measurement_kind" NOT NULL,
	"exercise_id" integer,
	"value" numeric(8, 2) NOT NULL,
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"test_group" uuid,
	"attempt" smallint,
	"source" "data_source" DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"display_name" text,
	"height_cm" numeric(5, 1),
	"reach_cm" numeric(5, 1),
	"femur_cm" numeric(4, 1),
	"tibia_cm" numeric(4, 1),
	"training_age_years" numeric(3, 1),
	"dominant_takeoff_leg" "takeoff_leg" DEFAULT 'unknown' NOT NULL,
	"jumper_type" "jumper_type" DEFAULT 'unknown' NOT NULL,
	"preferred_arm_swing" "arm_swing" DEFAULT 'unknown' NOT NULL,
	"goals" text[] DEFAULT '{}' NOT NULL,
	"available_equipment" text[] DEFAULT '{}' NOT NULL,
	"trainable_weekdays" smallint[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_checkins" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "readiness_checkins_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"day" date NOT NULL,
	"soreness_by_region" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"motivation" smallint,
	"prior_session_rpe" numeric(3, 1),
	"notes" text,
	"recovery_score" smallint,
	"hrv_ms" numeric(6, 2),
	"resting_heart_rate" smallint,
	"sleep_minutes" integer,
	"sleep_performance_pct" smallint,
	"sleep_efficiency_pct" smallint,
	"slow_wave_minutes" integer,
	"rem_minutes" integer,
	"day_strain" numeric(4, 2),
	"whoop_filled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tendon_status" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tendon_status_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site" "tendon_site" NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"pain_during_load" smallint NOT NULL,
	"pain_after_load" smallint NOT NULL,
	"morning_stiffness" smallint NOT NULL,
	"protocol_phase" smallint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whoop_connection" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"whoop_user_id" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whoop_records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "whoop_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "whoop_record_type" NOT NULL,
	"whoop_id" text NOT NULL,
	"record_start" timestamp with time zone,
	"record_end" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"projected_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whoop_webhook_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "whoop_webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"whoop_id" text NOT NULL,
	"trace_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_complex_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exercise_complex_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"complex_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"variant_id" integer,
	"is_main" boolean DEFAULT false NOT NULL,
	"target_weekly_frequency" smallint DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_complexes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exercise_complexes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mesocycle_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logged_sets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "logged_sets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL,
	"prescribed_set_id" integer,
	"exercise_id" integer NOT NULL,
	"set_index" smallint NOT NULL,
	"reps" smallint,
	"hold_seconds" numeric(5, 1),
	"load_kg" numeric(6, 2),
	"box_height_cm" numeric(5, 1),
	"rpe" numeric(3, 1),
	"quality_rating" smallint,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macrocycles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "macrocycles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"objective" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mesocycles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mesocycles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"macrocycle_id" integer NOT NULL,
	"ordinal" smallint NOT NULL,
	"type" "mesocycle_type" NOT NULL,
	"start_date" date NOT NULL,
	"planned_microcycles" smallint NOT NULL,
	"target_abilities" "motor_ability"[] NOT NULL,
	"technical_focus" text,
	"rationale" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "microcycles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "microcycles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mesocycle_id" integer NOT NULL,
	"ordinal" smallint NOT NULL,
	"start_date" date NOT NULL,
	"load_type" "load_type" DEFAULT 'stimulating' NOT NULL,
	"relative_load" numeric(3, 2),
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_proposals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plan_proposals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scope" "proposal_scope" NOT NULL,
	"mesocycle_id" integer,
	"microcycle_id" integer,
	"session_id" integer,
	"inputs" jsonb NOT NULL,
	"proposal" jsonb NOT NULL,
	"normalized" jsonb,
	"normalizer_diff" jsonb,
	"gate_report" jsonb,
	"advisories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text,
	"claimed_constraints" text[] DEFAULT '{}' NOT NULL,
	"repair_attempts" smallint DEFAULT 0 NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"supersedes_id" integer,
	"verdict" "proposal_verdict" DEFAULT 'pending' NOT NULL,
	"verdict_reason" text,
	"verdict_at" timestamp with time zone,
	"owner_edits" jsonb,
	"model" text,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescribed_sets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prescribed_sets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"block_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"exercise_id" integer NOT NULL,
	"variant_id" integer,
	"sets" smallint NOT NULL,
	"reps" smallint,
	"hold_seconds" numeric(5, 1),
	"load_kg" numeric(6, 2),
	"load_pct_of_1rm" smallint,
	"box_height_cm" numeric(5, 1),
	"target_rpe" numeric(3, 1),
	"rest_seconds" smallint,
	"coupling_class" "coupling_class",
	"tempo" text,
	"cue_override" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_blocks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_blocks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"label" text NOT NULL,
	"paired_with_block_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"microcycle_id" integer NOT NULL,
	"day" date NOT NULL,
	"kind" "session_kind" NOT NULL,
	"title" text,
	"planned_intensity" smallint,
	"planned_sets" smallint,
	"planned_contacts" smallint,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"reported_rpe" numeric(3, 1),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_log_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "food_log_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"food_id" integer NOT NULL,
	"quantity" numeric(8, 2) NOT NULL,
	"meal" "meal_slot" NOT NULL,
	"day" date NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "foods_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"grams_per_unit" numeric(8, 2),
	"kcal_per_unit" numeric(8, 2) NOT NULL,
	"protein_g_per_unit" numeric(7, 2) NOT NULL,
	"carbs_g_per_unit" numeric(7, 2) NOT NULL,
	"fat_g_per_unit" numeric(7, 2) NOT NULL,
	"fiber_g_per_unit" numeric(7, 2),
	"provenance" text DEFAULT 'model' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_targets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "nutrition_targets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"effective_from" date NOT NULL,
	"effective_to" date,
	"kcal" integer NOT NULL,
	"protein_g" integer NOT NULL,
	"carbs_g" integer NOT NULL,
	"fat_g" integer NOT NULL,
	"fluid_ml" integer,
	"target_weekly_change_pct" numeric(4, 2),
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "derived_insights" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "derived_insights_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"statement" text NOT NULL,
	"value" numeric(12, 4),
	"unit" text,
	"n" integer NOT NULL,
	"ci_low" numeric(12, 4),
	"ci_high" numeric(12, 4),
	"p_adjusted" numeric(6, 5),
	"tier" integer DEFAULT 1 NOT NULL,
	"assertable" boolean DEFAULT false NOT NULL,
	"detail" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_value" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "memory_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "memory_fact_type" NOT NULL,
	"body" text NOT NULL,
	"source" "memory_source" NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '0.5' NOT NULL,
	"observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"derived_from_proposal_id" integer,
	"derived_from_session_id" integer,
	"supersedes_id" integer,
	"superseded_by_id" integer,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_suggestions" ADD CONSTRAINT "exercise_suggestions_accepted_exercise_id_exercises_id_fk" FOREIGN KEY ("accepted_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_variants" ADD CONSTRAINT "exercise_variants_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_complex_items" ADD CONSTRAINT "exercise_complex_items_complex_id_exercise_complexes_id_fk" FOREIGN KEY ("complex_id") REFERENCES "public"."exercise_complexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_complex_items" ADD CONSTRAINT "exercise_complex_items_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_complex_items" ADD CONSTRAINT "exercise_complex_items_variant_id_exercise_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."exercise_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_complexes" ADD CONSTRAINT "exercise_complexes_mesocycle_id_mesocycles_id_fk" FOREIGN KEY ("mesocycle_id") REFERENCES "public"."mesocycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logged_sets" ADD CONSTRAINT "logged_sets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logged_sets" ADD CONSTRAINT "logged_sets_prescribed_set_id_prescribed_sets_id_fk" FOREIGN KEY ("prescribed_set_id") REFERENCES "public"."prescribed_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logged_sets" ADD CONSTRAINT "logged_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesocycles" ADD CONSTRAINT "mesocycles_macrocycle_id_macrocycles_id_fk" FOREIGN KEY ("macrocycle_id") REFERENCES "public"."macrocycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microcycles" ADD CONSTRAINT "microcycles_mesocycle_id_mesocycles_id_fk" FOREIGN KEY ("mesocycle_id") REFERENCES "public"."mesocycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_proposals" ADD CONSTRAINT "plan_proposals_mesocycle_id_mesocycles_id_fk" FOREIGN KEY ("mesocycle_id") REFERENCES "public"."mesocycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_proposals" ADD CONSTRAINT "plan_proposals_microcycle_id_microcycles_id_fk" FOREIGN KEY ("microcycle_id") REFERENCES "public"."microcycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_proposals" ADD CONSTRAINT "plan_proposals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_sets" ADD CONSTRAINT "prescribed_sets_block_id_session_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."session_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_sets" ADD CONSTRAINT "prescribed_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescribed_sets" ADD CONSTRAINT "prescribed_sets_variant_id_exercise_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."exercise_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_blocks" ADD CONSTRAINT "session_blocks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_microcycle_id_microcycles_id_fk" FOREIGN KEY ("microcycle_id") REFERENCES "public"."microcycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_variants_slug_idx" ON "exercise_variants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_slug_idx" ON "exercises" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "exercises_pattern_idx" ON "exercises" USING btree ("movement_pattern");--> statement-breakpoint
CREATE INDEX "exercises_available_idx" ON "exercises" USING btree ("available");--> statement-breakpoint
CREATE INDEX "measurements_kind_time_idx" ON "measurements" USING btree ("kind","measured_at");--> statement-breakpoint
CREATE INDEX "measurements_group_idx" ON "measurements" USING btree ("test_group");--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_checkins_day_idx" ON "readiness_checkins" USING btree ("day");--> statement-breakpoint
CREATE INDEX "tendon_status_site_time_idx" ON "tendon_status" USING btree ("site","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whoop_records_type_id_idx" ON "whoop_records" USING btree ("type","whoop_id");--> statement-breakpoint
CREATE INDEX "whoop_records_start_idx" ON "whoop_records" USING btree ("type","record_start");--> statement-breakpoint
CREATE INDEX "whoop_records_unprojected_idx" ON "whoop_records" USING btree ("projected_at");--> statement-breakpoint
CREATE INDEX "whoop_webhook_events_lookup_idx" ON "whoop_webhook_events" USING btree ("event_type","whoop_id");--> statement-breakpoint
CREATE INDEX "whoop_webhook_events_unhandled_idx" ON "whoop_webhook_events" USING btree ("handled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "complex_items_idx" ON "exercise_complex_items" USING btree ("complex_id","exercise_id");--> statement-breakpoint
CREATE INDEX "logged_sets_session_idx" ON "logged_sets" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "logged_sets_exercise_time_idx" ON "logged_sets" USING btree ("exercise_id","performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "logged_sets_client_id_idx" ON "logged_sets" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mesocycles_ordinal_idx" ON "mesocycles" USING btree ("macrocycle_id","ordinal");--> statement-breakpoint
CREATE INDEX "mesocycles_start_idx" ON "mesocycles" USING btree ("start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "microcycles_ordinal_idx" ON "microcycles" USING btree ("mesocycle_id","ordinal");--> statement-breakpoint
CREATE INDEX "microcycles_start_idx" ON "microcycles" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "plan_proposals_scope_idx" ON "plan_proposals" USING btree ("scope","created_at");--> statement-breakpoint
CREATE INDEX "plan_proposals_verdict_idx" ON "plan_proposals" USING btree ("verdict");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribed_sets_position_idx" ON "prescribed_sets" USING btree ("block_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "session_blocks_position_idx" ON "session_blocks" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "sessions_day_idx" ON "sessions" USING btree ("day");--> statement-breakpoint
CREATE INDEX "food_log_entries_day_idx" ON "food_log_entries" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_key_idx" ON "foods" USING btree ("key");--> statement-breakpoint
CREATE INDEX "nutrition_targets_from_idx" ON "nutrition_targets" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "derived_insights_key_idx" ON "derived_insights" USING btree ("key","computed_at");--> statement-breakpoint
CREATE INDEX "derived_insights_assertable_idx" ON "derived_insights" USING btree ("assertable");--> statement-breakpoint
CREATE INDEX "memory_facts_active_idx" ON "memory_facts" USING btree ("retired_at","type");--> statement-breakpoint
CREATE INDEX "memory_facts_embedding_idx" ON "memory_facts" USING hnsw ("embedding" vector_cosine_ops);