/**
 * Macro arithmetic. Pure, and the only place the numbers are added up.
 *
 * Every quantity here is in grams except `kcal`, and `fiberG` is nullable all the
 * way through: a food whose fibre was never estimated is not a food with no fibre,
 * and a day total that silently treats the two the same would report a number the
 * owner has no way to question.
 */

export type Macros = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
};

export const ZERO_MACROS: Macros = {
  kcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: null,
};

/** Atwater factors, the convention every label on a packet is built on. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/** Rounded to a tenth of a gram: two decimal places of a gram of fat is noise. */
function round(value: number) {
  return Math.round(value * 10) / 10;
}

/** Per-unit macros times a quantity of those units. */
export function scaleMacros(perUnit: Macros, quantity: number): Macros {
  return {
    kcal: Math.round(perUnit.kcal * quantity),
    proteinG: round(perUnit.proteinG * quantity),
    carbsG: round(perUnit.carbsG * quantity),
    fatG: round(perUnit.fatG * quantity),
    fiberG: perUnit.fiberG === null ? null : round(perUnit.fiberG * quantity),
  };
}

/**
 * A day, a meal, or a parsed sentence.
 *
 * `fiberG` stays null only when no contributing item had one, so a day of six
 * estimated foods and one guess still reports the fibre it knows about rather than
 * nothing.
 */
export function sumMacros(items: readonly Macros[]): Macros {
  const withFiber = items.filter((item) => item.fiberG !== null);
  return {
    kcal: items.reduce((sum, item) => sum + item.kcal, 0),
    proteinG: round(items.reduce((sum, item) => sum + item.proteinG, 0)),
    carbsG: round(items.reduce((sum, item) => sum + item.carbsG, 0)),
    fatG: round(items.reduce((sum, item) => sum + item.fatG, 0)),
    fiberG: withFiber.length
      ? round(withFiber.reduce((sum, item) => sum + (item.fiberG ?? 0), 0))
      : null,
  };
}

/**
 * What the macros say the calories are, by the Atwater factors.
 *
 * Unrounded, because this is only ever compared against another number and the
 * comparison is made on per-unit macros as often as on a portion: a gram of yoghurt
 * is 0.74 kcal, and rounding that to 1 is a 35% error injected into the check.
 */
export function impliedKcal(macros: Macros): number {
  return (
    macros.proteinG * KCAL_PER_G.protein +
    macros.carbsG * KCAL_PER_G.carbs +
    macros.fatG * KCAL_PER_G.fat
  );
}

/**
 * How far an estimate's calories are from the sum of its own macros, as a
 * fraction.
 *
 * An estimate is a guess and it is allowed to be wrong, but it is not allowed to
 * be internally inconsistent: 300 kcal of food that adds up to 500 is an
 * arithmetic slip rather than an imprecise guess, and it is the one error in a
 * parsed food that can be caught without knowing anything about the food. Flagged
 * for the owner to correct rather than rewritten, because which of the four
 * numbers is the wrong one is not knowable from here.
 */
export const KCAL_MISMATCH_TOLERANCE = 0.2;

export function kcalMismatch(macros: Macros): number {
  const implied = impliedKcal(macros);
  // No macros reported is no claim to check, not a claim that disagrees. That is
  // the honest reading of a drink whose energy is alcohol, which carries real
  // calories behind none of the three macros, and of a food known only by its
  // label calories.
  if (implied === 0) return 0;
  // Scaled by the larger of the two claims and by nothing else. A floor here would
  // make the check depend on the unit the food is stored in, and per-unit macros are
  // fractions: with a floor of one kcal, a gram of anything passes unconditionally
  // and the flag never fires on the very numbers the correction form edits.
  const scale = Math.max(implied, macros.kcal);
  return Math.abs(macros.kcal - implied) / scale;
}

export function macrosAddUp(macros: Macros): boolean {
  return kcalMismatch(macros) <= KCAL_MISMATCH_TOLERANCE;
}

/** Share of energy from each macro, for the split bar. Null on a zero-calorie day. */
export function energySplit(macros: Macros) {
  const fromProtein = macros.proteinG * KCAL_PER_G.protein;
  const fromCarbs = macros.carbsG * KCAL_PER_G.carbs;
  const fromFat = macros.fatG * KCAL_PER_G.fat;
  const total = fromProtein + fromCarbs + fromFat;
  if (total <= 0) return null;
  return {
    proteinPct: (fromProtein / total) * 100,
    carbsPct: (fromCarbs / total) * 100,
    fatPct: (fromFat / total) * 100,
  };
}
