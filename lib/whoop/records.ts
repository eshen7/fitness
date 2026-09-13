import { z } from "zod";

/**
 * Shapes of the v2 records the app reads, and the fields it reads from them.
 *
 * Everything scored is optional. WHOOP returns a record as soon as the window
 * closes and fills the score afterwards, with `score_state` saying which, so a
 * record arriving unscored is normal and not an error. The raw payload is stored
 * verbatim either way, so a record that scores later is re-projected rather than
 * refetched.
 *
 * Only the fields the app actually projects are described. `.loose()` keeps the
 * rest, so a schema addition on WHOOP's side is not a parse failure.
 */

const scoreState = z.enum(["SCORED", "PENDING_SCORE", "UNSCORABLE"]).optional();

export const whoopSleep = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    start: z.string(),
    end: z.string(),
    nap: z.boolean().optional(),
    score_state: scoreState,
    score: z
      .object({
        stage_summary: z
          .object({
            total_in_bed_time_milli: z.number().optional(),
            total_awake_time_milli: z.number().optional(),
            total_light_sleep_time_milli: z.number().optional(),
            total_slow_wave_sleep_time_milli: z.number().optional(),
            total_rem_sleep_time_milli: z.number().optional(),
          })
          .loose()
          .optional(),
        sleep_performance_percentage: z.number().nullish(),
        sleep_efficiency_percentage: z.number().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export const whoopRecovery = z
  .object({
    cycle_id: z.union([z.string(), z.number()]).transform(String),
    sleep_id: z.union([z.string(), z.number()]).transform(String),
    created_at: z.string().optional(),
    score_state: scoreState,
    score: z
      .object({
        recovery_score: z.number().nullish(),
        resting_heart_rate: z.number().nullish(),
        hrv_rmssd_milli: z.number().nullish(),
        spo2_percentage: z.number().nullish(),
        skin_temp_celsius: z.number().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export const whoopCycle = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    start: z.string(),
    end: z.string().nullish(),
    score_state: scoreState,
    score: z
      .object({
        strain: z.number().nullish(),
        kilojoule: z.number().nullish(),
        average_heart_rate: z.number().nullish(),
        max_heart_rate: z.number().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export const whoopWorkout = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    start: z.string(),
    end: z.string(),
    sport_name: z.string().nullish(),
    score_state: scoreState,
    score: z
      .object({
        strain: z.number().nullish(),
        average_heart_rate: z.number().nullish(),
        max_heart_rate: z.number().nullish(),
        kilojoule: z.number().nullish(),
        zone_durations: z.record(z.string(), z.number()).optional(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export const whoopBodyMeasurement = z
  .object({
    height_meter: z.number().nullish(),
    weight_kilogram: z.number().nullish(),
    max_heart_rate: z.number().nullish(),
  })
  .loose();

export type WhoopSleep = z.infer<typeof whoopSleep>;
export type WhoopRecovery = z.infer<typeof whoopRecovery>;
export type WhoopCycle = z.infer<typeof whoopCycle>;
export type WhoopWorkout = z.infer<typeof whoopWorkout>;
export type WhoopBodyMeasurement = z.infer<typeof whoopBodyMeasurement>;

export const minutes = (milli: number | null | undefined) =>
  milli === null || milli === undefined ? null : Math.round(milli / 60000);

/** Percentages arrive as floats and are stored as whole points. */
export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value);
