import { z } from "zod";
import {
  ARM_SWINGS,
  EQUIPMENT_TYPES,
  JUMPER_TYPES,
  TAKEOFF_LEGS,
  UNIT_SYSTEMS,
  type Equipment,
  type UnitSystem,
} from "@/lib/taxonomy";
import { round1, toCanonical, toDisplay } from "@/lib/units";

/**
 * Validation for the profile screen, shared by the form and the action that
 * writes the single `profile` row.
 *
 * This is the row the generator reads: equipment is what the pre-filter
 * intersects every exercise against, and the weekdays are the only days a
 * session may land on. So the values here are exactly the ones those consumers
 * expect - equipment as taxonomy values, weekdays as 0 Sunday to 6 Saturday -
 * rather than anything shaped for the form's convenience.
 *
 * Lengths arrive in the display units of the unit system submitted alongside
 * them, not the stored one, because the unit system is edited on the same
 * screen. Imports nothing but the taxonomy and the unit arithmetic, so the
 * browser does not pull the database driver in behind it.
 */

/**
 * Everything the owner can tick. `none` is left out: the pre-filter treats it as
 * always satisfied, so as a box to tick it would mean nothing.
 */
export const PROFILE_EQUIPMENT = EQUIPMENT_TYPES.filter(
  (item): item is Exclude<Equipment, "none"> => item !== "none",
);

/**
 * The body dimensions, with a canonical ceiling each. Checked in centimetres
 * after conversion so the bound means the same thing in either unit system, and
 * kept under what the column can hold: femur and tibia are `numeric(4,1)`.
 */
export const LENGTH_FIELDS = {
  heightCm: { label: "Height", maxCm: 272 },
  reachCm: { label: "Standing reach", maxCm: 350 },
  femurCm: { label: "Femur", maxCm: 80 },
  tibiaCm: { label: "Tibia", maxCm: 70 },
} as const;
export type LengthField = keyof typeof LENGTH_FIELDS;
const LENGTH_KEYS = Object.keys(LENGTH_FIELDS) as LengthField[];

export const MAX_GOALS = 8;
const MAX_GOAL_LENGTH = 200;

/** A typed number, or `undefined` when the field was left blank. */
function optionalNumber(message: string) {
  return z
    .string()
    .trim()
    .default("")
    .transform((value, ctx) => {
      if (!value) return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return parsed;
    });
}

const length = optionalNumber("Enter a positive length, or leave it blank.");

export const profileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .max(80, "Keep the name under 80 characters.")
      .default("")
      .transform((value) => value || null),
    unitSystem: z.enum(UNIT_SYSTEMS),

    heightCm: length,
    reachCm: length,
    femurCm: length,
    tibiaCm: length,
    /** Zero is a real answer here - a first-year athlete - so it is not blank. */
    trainingAgeYears: z
      .string()
      .trim()
      .default("")
      .transform((value, ctx) => {
        if (!value) return undefined;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 60) {
          ctx.addIssue({ code: "custom", message: "Training age is 0 to 60 years." });
          return z.NEVER;
        }
        return parsed;
      }),

    dominantTakeoffLeg: z.enum(TAKEOFF_LEGS),
    jumperType: z.enum(JUMPER_TYPES),
    preferredArmSwing: z.enum(ARM_SWINGS),

    /** One goal per line, blank lines dropped. */
    goals: z
      .string()
      .default("")
      .transform((value, ctx) => {
        const goals = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (goals.length > MAX_GOALS) {
          ctx.addIssue({
            code: "custom",
            message: `Keep it to ${MAX_GOALS} goals. The ebook's own advice is one or two targets at a time.`,
          });
          return z.NEVER;
        }
        if (goals.some((goal) => goal.length > MAX_GOAL_LENGTH)) {
          ctx.addIssue({
            code: "custom",
            message: `Keep each goal under ${MAX_GOAL_LENGTH} characters.`,
          });
          return z.NEVER;
        }
        return goals;
      }),

    // Deduplicated and put in a fixed order, so saving the same choices twice
    // writes the same row and the cached prompt prefix built from it stays hot.
    availableEquipment: z
      .array(z.enum(PROFILE_EQUIPMENT, "That is not a piece of equipment the app knows."))
      .default([])
      .transform((items) => PROFILE_EQUIPMENT.filter((item) => items.includes(item))),
    trainableWeekdays: z
      .array(z.number().int().min(0, "Weekdays are 0 to 6.").max(6, "Weekdays are 0 to 6."))
      .default([])
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  })
  .superRefine((values, ctx) => {
    for (const key of LENGTH_KEYS) {
      const value = values[key];
      if (value === undefined) continue;
      const { label, maxCm } = LENGTH_FIELDS[key];
      if (toCanonical(value, "length", values.unitSystem) > maxCm) {
        const shown = round1(toDisplay(maxCm, "length", values.unitSystem));
        const unit = values.unitSystem === "imperial" ? "in" : "cm";
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${label} tops out at ${shown} ${unit}. Check the units.`,
        });
      }
    }
  });

export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileValues = z.output<typeof profileSchema>;

/** The stored lengths, canonical centimetres, as the write path compares against. */
export type StoredLengths = Record<LengthField, number | null>;

/** A stored length as the form shows it: one decimal in the owner's units. */
export function lengthText(cm: number | null, system: UnitSystem) {
  return cm === null ? "" : String(round1(toDisplay(cm, "length", system)));
}

/**
 * A submitted length back to canonical centimetres.
 *
 * A value that still reads exactly as the stored one was displayed is the stored
 * one, untouched. Without that, a height saved as 180.0 cm shows as 70.9 in and
 * comes back as 180.1 cm: saving the screen to change a weekday would quietly
 * rewrite a measurement nobody touched.
 */
export function lengthToCm(
  value: number | undefined,
  system: UnitSystem,
  stored: number | null,
) {
  if (value === undefined) return null;
  if (stored !== null && round1(toDisplay(stored, "length", system)) === value) {
    return stored;
  }
  return toCanonical(value, "length", system);
}

/**
 * The validated form as the `profile` row it writes. Numerics cross the driver
 * as strings, so each is fixed to its column's scale here.
 */
export function profileRow(values: ProfileValues, stored: StoredLengths) {
  const cm = (key: LengthField) => {
    const value = lengthToCm(values[key], values.unitSystem, stored[key]);
    return value === null ? null : value.toFixed(1);
  };
  return {
    displayName: values.displayName,
    unitSystem: values.unitSystem,
    heightCm: cm("heightCm"),
    reachCm: cm("reachCm"),
    femurCm: cm("femurCm"),
    tibiaCm: cm("tibiaCm"),
    trainingAgeYears:
      values.trainingAgeYears === undefined ? null : values.trainingAgeYears.toFixed(1),
    dominantTakeoffLeg: values.dominantTakeoffLeg,
    jumperType: values.jumperType,
    preferredArmSwing: values.preferredArmSwing,
    goals: values.goals,
    availableEquipment: values.availableEquipment,
    trainableWeekdays: values.trainableWeekdays,
  };
}
