import { z } from "zod";
import {
  COUPLING_CLASSES,
  EQUIPMENT_TYPES,
  FORCE_VELOCITIES,
  LATERALITIES,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  PLANES,
  TENDON_SITES,
} from "@/lib/taxonomy";

/**
 * Validation for the library editor.
 *
 * The enum members come from `lib/taxonomy.ts`, the same arrays the Postgres enums
 * are built from, so adding a value to the taxonomy cannot leave the form silently
 * accepting or rejecting the wrong set. Importing the taxonomy rather than the
 * schema also keeps the database driver out of the client bundle, since this
 * module is shared with the form component.
 */

/** `Some Name (v2)` becomes `some-name-v2`. */
export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const rating = z.coerce.number().int().min(1).max(5);

/** A textarea of one item per line, blank lines dropped. */
const lines = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );

export const exerciseFormSchema = z
  .object({
    name: z.string().trim().min(2, "Give it a name.").max(80),
    slug: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((value) => (value ? slugify(value) : undefined)),

    primaryMuscleGroup: z.enum(MUSCLE_GROUPS),
    secondaryMuscleGroups: z.array(z.enum(MUSCLE_GROUPS)).default([]),
    movementPattern: z.enum(MOVEMENT_PATTERNS),
    forceVelocity: z.enum(FORCE_VELOCITIES),
    laterality: z.enum(LATERALITIES),
    plane: z.enum(PLANES),

    couplingClass: z.enum(COUPLING_CLASSES).default("not_plyometric"),
    typicalContactSeconds: z
      .string()
      .trim()
      .optional()
      .transform((value, ctx) => {
        if (!value) return undefined;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 9.999) {
          ctx.addIssue({
            code: "custom",
            message: "Contact time must be between 0 and 9.999 seconds.",
          });
          return z.NEVER;
        }
        return parsed;
      }),
    highImpact: z.coerce.boolean().default(false),

    equipment: z.array(z.enum(EQUIPMENT_TYPES)).default([]),
    loadsTendonSites: z.array(z.enum(TENDON_SITES)).default([]),
    tendonLoadRating: rating,
    technicalComplexity: rating,

    cues: lines,
    notes: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => value || null),

  })
  .refine(
    (v) => v.couplingClass === "not_plyometric" || v.movementPattern !== "squat",
    {
      path: ["couplingClass"],
      message: "A squat is not a plyometric drill.",
    },
  )
  .refine(
    // The ebook's line, and the reason the normalizer refuses to label slower
    // work as shock method. Enforced here too so bad data never reaches it.
    (v) =>
      v.forceVelocity !== "shock" ||
      (v.typicalContactSeconds !== undefined && v.typicalContactSeconds < 0.15),
    {
      path: ["typicalContactSeconds"],
      message:
        "Shock method requires a measured ground contact under 0.15 s. Set the contact time, or pick another point on the force velocity curve.",
    },
  )
  .refine((v) => !v.secondaryMuscleGroups.includes(v.primaryMuscleGroup), {
    path: ["secondaryMuscleGroups"],
    message: "The primary group does not need repeating as a secondary one.",
  });

export type ExerciseFormValues = z.output<typeof exerciseFormSchema>;

/**
 * The form as the browser holds it: every field a string, a string list, or a
 * checkbox. The editor renders from this rather than from the database row, so a
 * rejected submission can be echoed back verbatim.
 *
 * Availability is deliberately absent. It is owned by the switch in the page
 * header, which writes immediately; carrying it here too would mean a save could
 * quietly resurrect an exercise the owner had just turned off.
 */
export type ExerciseFormFields = {
  name: string;
  slug: string;
  primaryMuscleGroup: string;
  secondaryMuscleGroups: string[];
  movementPattern: string;
  forceVelocity: string;
  laterality: string;
  plane: string;
  couplingClass: string;
  typicalContactSeconds: string;
  highImpact: boolean;
  equipment: string[];
  loadsTendonSites: string[];
  tendonLoadRating: string;
  technicalComplexity: string;
  cues: string;
  notes: string;
};

/**
 * Field errors keyed the way the form renders them, plus a form-level list.
 *
 * `fields` carries the rejected submission back. React resets an uncontrolled
 * form once its action resolves, so without this a single bad field would throw
 * away every other edit on the page.
 */
export type FormState = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  fields?: ExerciseFormFields;
};

const EMPTY_FIELDS: ExerciseFormFields = {
  name: "",
  slug: "",
  primaryMuscleGroup: "knee_extensors",
  secondaryMuscleGroups: [],
  movementPattern: "squat",
  forceVelocity: "max_strength",
  laterality: "bilateral",
  plane: "sagittal",
  couplingClass: "not_plyometric",
  typicalContactSeconds: "",
  highImpact: false,
  equipment: [],
  loadsTendonSites: [],
  tendonLoadRating: "1",
  technicalComplexity: "1",
  cues: "",
  notes: "",
};

/** What the editor shows for an existing row, or for a blank new entry. */
export function exerciseFormFields(
  exercise?: Pick<
    ExerciseFormValues,
    | "name"
    | "primaryMuscleGroup"
    | "secondaryMuscleGroups"
    | "movementPattern"
    | "forceVelocity"
    | "laterality"
    | "plane"
    | "couplingClass"
    | "highImpact"
    | "equipment"
    | "loadsTendonSites"
  > & {
    slug: string;
    typicalContactSeconds: string | null;
    tendonLoadRating: number;
    technicalComplexity: number;
    cues: string[];
    notes: string | null;
  },
): ExerciseFormFields {
  if (!exercise) return EMPTY_FIELDS;
  return {
    name: exercise.name,
    slug: exercise.slug,
    primaryMuscleGroup: exercise.primaryMuscleGroup,
    secondaryMuscleGroups: [...exercise.secondaryMuscleGroups],
    movementPattern: exercise.movementPattern,
    forceVelocity: exercise.forceVelocity,
    laterality: exercise.laterality,
    plane: exercise.plane,
    couplingClass: exercise.couplingClass,
    // Stored as numeric(4,3), so trailing zeros come back: 0.140, not 0.14.
    typicalContactSeconds: exercise.typicalContactSeconds ?? "",
    highImpact: exercise.highImpact,
    equipment: [...exercise.equipment],
    loadsTendonSites: [...exercise.loadsTendonSites],
    tendonLoadRating: String(exercise.tendonLoadRating),
    technicalComplexity: String(exercise.technicalComplexity),
    cues: exercise.cues.join("\n"),
    notes: exercise.notes ?? "",
  };
}

/** Reads the submission without validating it, so it can be echoed back. */
export function readExerciseForm(formData: FormData): ExerciseFormFields {
  const text = (key: string) => String(formData.get(key) ?? "");
  const list = (key: string) => formData.getAll(key).map(String);
  return {
    name: text("name"),
    slug: text("slug"),
    primaryMuscleGroup: text("primaryMuscleGroup"),
    secondaryMuscleGroups: list("secondaryMuscleGroups"),
    movementPattern: text("movementPattern"),
    forceVelocity: text("forceVelocity"),
    laterality: text("laterality"),
    plane: text("plane"),
    couplingClass: text("couplingClass"),
    typicalContactSeconds: text("typicalContactSeconds"),
    highImpact: formData.get("highImpact") === "on",
    equipment: list("equipment"),
    loadsTendonSites: list("loadsTendonSites"),
    tendonLoadRating: text("tendonLoadRating"),
    technicalComplexity: text("technicalComplexity"),
    cues: text("cues"),
    notes: text("notes"),
  };
}

export function parseExerciseForm(fields: ExerciseFormFields) {
  return exerciseFormSchema.safeParse(fields);
}
