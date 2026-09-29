import { z } from "zod";
import { BODY_KINDS, MUSCLE_GROUPS, TENDON_SITES, TEST_KINDS } from "@/lib/taxonomy";

/**
 * Validators for the manual entry forms, shared between the client components and
 * the server actions.
 *
 * Values arrive in the owner's display units and are converted to canonical
 * kilograms and centimetres on the server, where the unit preference lives. So
 * the bounds here are deliberately generous: they are here to catch a fat-fingered
 * `385` in a bodyweight field, not to encode what is physiologically plausible in
 * one particular unit.
 *
 * Imports nothing but the taxonomy, so the browser does not pull the database
 * driver in behind these.
 */

/**
 * What every log action returns.
 *
 * Lives here rather than beside the actions so a client component can import the
 * type without importing a `"use server"` module.
 */
export type ActionResult = {
  ok: boolean;
  message: string;
  /** Field path to message, for the few forms that can point at a field. */
  errors?: Record<string, string>;
};

/**
 * A failed parse as an `ActionResult`, keyed by dotted field path so a form can
 * put each message under the field it belongs to.
 */
export function invalid(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): ActionResult {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    errors[issue.path.map(String).join(".")] = issue.message;
  }
  return {
    ok: false,
    message: Object.values(errors)[0] ?? "That did not validate.",
    errors,
  };
}

/** A number typed into a field. Blank becomes undefined rather than zero. */
function optionalNumber(max: number, message: string) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return parsed;
    });
}

/** 0 to 10 self-report. Zero is meaningful here, so it is not treated as blank. */
function optionalScore(message = "Use a number from 0 to 10.") {
  return z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === "") return undefined;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return parsed;
    });
}

const notes = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => value || null);

/**
 * A test is a list of attempts in one sitting. Every attempt is kept, not just
 * the best: the within-session spread *is* the measurement noise floor, and the
 * minimal detectable change drawn on the jump chart is derived from it.
 */
export const testSchema = z.object({
  kind: z.enum(TEST_KINDS),
  attempts: z
    .array(z.string())
    .min(1)
    .transform((values, ctx) => {
      const parsed: number[] = [];
      for (const [index, raw] of values.entries()) {
        const text = raw.trim();
        if (!text) continue;
        const value = Number(text);
        if (!Number.isFinite(value) || value <= 0 || value > 500) {
          ctx.addIssue({
            code: "custom",
            path: ["attempts", index],
            message: "Each attempt is a positive measurement.",
          });
          return z.NEVER;
        }
        parsed.push(value);
      }
      if (parsed.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["attempts", 0],
          message: "Record at least one attempt.",
        });
        return z.NEVER;
      }
      return parsed;
    }),
  /** Only meaningful for a depth jump, where it is the whole point of the test. */
  boxHeight: optionalNumber(200, "Box height must be a positive measurement."),
  notes,
});

export const bodySchema = z.object({
  kind: z.enum(BODY_KINDS),
  value: z
    .string()
    .trim()
    .min(1, "Enter a value.")
    .transform((raw, ctx) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 || value > 1000) {
        ctx.addIssue({ code: "custom", message: "Enter a positive value." });
        return z.NEVER;
      }
      return value;
    }),
  notes,
});

/**
 * One check-in covers every site, because a site left blank is ambiguous between
 * "no pain" and "did not check", and the pre-filter treats those very differently.
 * Protocol phase is per site: the left patellar tendon can be in phase 2 while
 * the right is off protocol entirely.
 */
export const tendonSiteSchema = z.object({
  painDuringLoad: optionalScore(),
  painAfterLoad: optionalScore(),
  morningStiffness: optionalScore(),
  /** Empty means not on a protocol, which is different from phase 1. */
  protocolPhase: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
        ctx.addIssue({ code: "custom", message: "Protocol phase is 1 to 4." });
        return z.NEVER;
      }
      return parsed;
    }),
});

export const tendonSchema = z.object({
  sites: z.record(z.enum(TENDON_SITES), tendonSiteSchema),
  notes,
});

export const readinessSchema = z.object({
  soreness: z.record(z.enum(MUSCLE_GROUPS), optionalScore()),
  motivation: optionalScore(),
  priorSessionRpe: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
        ctx.addIssue({ code: "custom", message: "RPE runs from 1 to 10." });
        return z.NEVER;
      }
      return parsed;
    }),
  notes,
});

/**
 * A logged set, as the offline queue posts it.
 *
 * `clientId` is generated in the browser and carries a unique index in the
 * database, so a queue that flushes twice writes once. Values are canonical here
 * rather than in display units: the queue can sit in local storage across a
 * change of unit preference, and a set that silently changed meaning would be
 * worse than one that failed to send.
 */
export const loggedSetSchema = z.object({
  clientId: z.string().min(8).max(64),
  sessionId: z.number().int().positive(),
  exerciseId: z.number().int().positive(),
  prescribedSetId: z.number().int().positive().nullish(),
  setIndex: z.number().int().min(1).max(99),
  reps: z.number().int().min(1).max(500).nullish(),
  holdSeconds: z.number().min(0).max(3600).nullish(),
  loadKg: z.number().min(0).max(1000).nullish(),
  boxHeightCm: z.number().min(0).max(300).nullish(),
  rpe: z.number().min(1).max(10).nullish(),
  qualityRating: z.number().int().min(1).max(5).nullish(),
  /** When the set actually happened, so an offline flush is not backdated to now. */
  performedAt: z.string().datetime(),
  notes: z.string().trim().max(500).nullish(),
});

export type LoggedSetInput = z.input<typeof loggedSetSchema>;

/**
 * A queue flush posts a batch, since a whole session may have been offline.
 *
 * The items are deliberately unvalidated at this level: the receiver validates each
 * set on its own and answers with the ones it accepted and the ones it refused, so
 * a single malformed set cannot wedge a queue that is otherwise fine.
 */
export const loggedSetBatchSchema = z.object({
  sets: z.array(z.unknown()).min(1).max(200),
});

/**
 * A max the owner actually lifted, in display units. The server checks the
 * exercise is one a one-rep max means something for.
 */
export const testedMaxSchema = z.object({
  exerciseId: z.number().int().positive(),
  value: z
    .string()
    .trim()
    .min(1, "Enter the weight lifted.")
    .transform((raw, ctx) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 || value > 1000) {
        ctx.addIssue({ code: "custom", message: "Enter a positive weight." });
        return z.NEVER;
      }
      return value;
    }),
});
