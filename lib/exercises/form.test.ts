import { describe, expect, it } from "vitest";
import { exerciseFormSchema, slugify } from "./form";

/** A minimal valid submission, as the browser would send it. */
function form(overrides: Record<string, unknown> = {}) {
  return {
    name: "Back Squat",
    primaryMuscleGroup: "knee_extensors",
    secondaryMuscleGroups: [],
    movementPattern: "squat",
    forceVelocity: "max_strength",
    laterality: "bilateral",
    plane: "sagittal",
    couplingClass: "not_plyometric",
    typicalContactSeconds: "",
    highImpact: false,
    equipment: ["barbell"],
    loadsTendonSites: ["patellar_left", "patellar_right"],
    tendonLoadRating: "3",
    technicalComplexity: "3",
    cues: "",
    ...overrides,
  };
}

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("Bulgarian Split Squat")).toBe("bulgarian-split-squat");
  });

  it("collapses punctuation rather than encoding it", () => {
    expect(slugify("Single-Leg RDL (left)")).toBe("single-leg-rdl-left");
  });

  it("strips leading and trailing separators", () => {
    expect(slugify("  ...Pogo Hop!  ")).toBe("pogo-hop");
  });

  it("caps at the column width", () => {
    expect(slugify("a".repeat(200))).toHaveLength(80);
  });
});

describe("exerciseFormSchema", () => {
  it("accepts a plain strength exercise", () => {
    const result = exerciseFormSchema.safeParse(form());
    expect(result.success).toBe(true);
  });

  it("coerces the rating selects to numbers", () => {
    const result = exerciseFormSchema.parse(form());
    expect(result.tendonLoadRating).toBe(3);
    expect(result.technicalComplexity).toBe(3);
  });

  it("reads an empty contact time as absent, not as zero", () => {
    expect(exerciseFormSchema.parse(form()).typicalContactSeconds).toBeUndefined();
  });

  it("splits cues on newlines and drops blank lines", () => {
    const result = exerciseFormSchema.parse(
      form({ cues: "Chest up\n\n  Knees out  \n" }),
    );
    expect(result.cues).toEqual(["Chest up", "Knees out"]);
  });

  // The ebook's 0.15 s line. A drill labelled shock method without a measured
  // contact time under it is exactly the mislabelling the normalizer refuses to
  // do, so the directory must not be able to hold it either.
  it("rejects shock method without a contact time", () => {
    const result = exerciseFormSchema.safeParse(
      form({ forceVelocity: "shock", movementPattern: "jump_bilateral" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["typicalContactSeconds"]);
  });

  it("rejects shock method at or above 0.15 s", () => {
    const at = exerciseFormSchema.safeParse(
      form({
        forceVelocity: "shock",
        movementPattern: "jump_bilateral",
        typicalContactSeconds: "0.150",
      }),
    );
    expect(at.success).toBe(false);
  });

  it("accepts shock method under 0.15 s", () => {
    const under = exerciseFormSchema.safeParse(
      form({
        forceVelocity: "shock",
        movementPattern: "jump_bilateral",
        typicalContactSeconds: "0.145",
      }),
    );
    expect(under.success).toBe(true);
  });

  it("rejects a plyometric squat", () => {
    const result = exerciseFormSchema.safeParse(
      form({ couplingClass: "short_ssc", typicalContactSeconds: "0.2" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["couplingClass"]);
  });

  it("rejects the primary group repeated as a secondary", () => {
    const result = exerciseFormSchema.safeParse(
      form({ secondaryMuscleGroups: ["knee_extensors"] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["secondaryMuscleGroups"]);
  });

  it("rejects a non-numeric contact time instead of storing NaN", () => {
    const result = exerciseFormSchema.safeParse(
      form({ typicalContactSeconds: "quick" }),
    );
    expect(result.success).toBe(false);
  });

  it("normalizes a supplied slug", () => {
    expect(exerciseFormSchema.parse(form({ slug: "Box Squat " })).slug).toBe(
      "box-squat",
    );
  });

  it("rejects a one-character name", () => {
    expect(exerciseFormSchema.safeParse(form({ name: "x" })).success).toBe(false);
  });
});
