import type { MeasurementKind, UnitSystem } from "@/lib/taxonomy";

/**
 * Unit handling.
 *
 * Every stored number is canonical: kilograms for load and bodyweight,
 * centimetres for heights and distances, seconds for time. A series that mixes
 * units is a series no trend can be fitted to, so conversion happens at the edge
 * of the app rather than in the database.
 *
 * The owner trains in a country that measures a vertical in inches and a barbell
 * in pounds, so imperial is the default display. Nothing downstream of the form
 * ever sees a pound.
 */

const LB_PER_KG = 2.20462262;
const CM_PER_IN = 2.54;

export function kgToLb(kg: number) {
  return kg * LB_PER_KG;
}
export function lbToKg(lb: number) {
  return lb / LB_PER_KG;
}
export function cmToIn(cm: number) {
  return cm / CM_PER_IN;
}
export function inToCm(inches: number) {
  return inches * CM_PER_IN;
}

/** What a measurement kind is dimensionally, which is what conversion needs. */
export type Dimension = "mass" | "length" | "percent" | "count";

const DIMENSIONS: Record<MeasurementKind, Dimension> = {
  bodyweight: "mass",
  standing_vertical: "length",
  two_foot_approach_vertical: "length",
  one_foot_approach_left: "length",
  one_foot_approach_right: "length",
  broad_jump: "length",
  depth_jump_vertical: "length",
  estimated_1rm: "mass",
  lean_mass: "mass",
  body_fat_pct: "percent",
  reach_height: "length",
};

export function dimensionOf(kind: MeasurementKind): Dimension {
  return DIMENSIONS[kind];
}

/** The unit a value is entered and shown in, for a dimension and preference. */
export function displayUnit(dimension: Dimension, system: UnitSystem) {
  if (dimension === "percent") return "%";
  if (dimension === "count") return "";
  if (dimension === "mass") return system === "imperial" ? "lb" : "kg";
  return system === "imperial" ? "in" : "cm";
}

/** Canonical value to the number a form field or chart axis should show. */
export function toDisplay(
  value: number,
  dimension: Dimension,
  system: UnitSystem,
) {
  if (system === "metric" || dimension === "percent" || dimension === "count") {
    return value;
  }
  return dimension === "mass" ? kgToLb(value) : cmToIn(value);
}

/** What the owner typed, back to the canonical value that gets stored. */
export function toCanonical(
  value: number,
  dimension: Dimension,
  system: UnitSystem,
) {
  if (system === "metric" || dimension === "percent" || dimension === "count") {
    return value;
  }
  return dimension === "mass" ? lbToKg(value) : inToCm(value);
}

/**
 * Rounding for display. One decimal everywhere: a vertical measured to a tenth
 * of an inch is already at the edge of what a tape and a chalked hand can
 * resolve, and more digits would imply precision the measurement does not have.
 */
export function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function formatMeasurement(
  value: number,
  kind: MeasurementKind,
  system: UnitSystem,
) {
  const dimension = dimensionOf(kind);
  const shown = round1(toDisplay(value, dimension, system));
  const unit = displayUnit(dimension, system);
  return unit ? `${shown} ${unit}` : String(shown);
}
