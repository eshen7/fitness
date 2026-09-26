import type { FoodUnit } from "@/lib/taxonomy";

/**
 * The two cache keys, and the one normaliser behind both.
 *
 * Everything about nutrition costing nothing on a repeat rests on these strings,
 * so they live alone in a module that imports no database and no clock and can be
 * tested exhaustively. Two levels, because they answer different questions:
 *
 * - `phraseKey` is the whole sentence. The owner eats the same breakfast most
 *   days, and a phrase seen before is replayed from its own prior entries with no
 *   model call at all. That is what makes a repeat instant, and it is also what
 *   makes it *identical*: a parser asked twice may answer "greek yoghurt" and then
 *   "Greek yogurt, plain", which are two food keys and so two estimates.
 * - `foodKey` is one resolved item. It catches the other case, a new sentence made
 *   of familiar foods, and it is the unique index on `foods`.
 *
 * Both are deliberately lossy in the same ways and lossless in one: they fold
 * case, accents, punctuation and runs of whitespace, and they do not stem. A
 * stemmer is what turns `oats` into `oat` and then `oat milk` into a match for
 * porridge, and the cost of a near-miss here is one extra estimate while the cost
 * of a false match is macros silently attributed to the wrong food.
 */

/**
 * Fold to the comparable core of a phrase: lower case, no accents, no
 * punctuation, single spaces.
 *
 * Numbers survive, because `2 eggs` and `3 eggs` are different meals, and so does
 * word order, because `chicken and rice` is the same phrase however it is spaced
 * but not the same as `rice and chicken` to a parser that reads quantities off
 * position. Being conservative costs an estimate; being clever costs correctness.
 */
function fold(text: string) {
  return (
    text
      .normalize("NFKD")
      // Combining marks, so `jalapeño` and `jalapeno` are one key.
      .replace(/\p{Mark}+/gu, "")
      .toLowerCase()
      // Keep letters, digits and decimal points; everything else is a separator,
      // so `2x eggs`, `2 eggs` and `2  eggs!` fold together while `1.5` stays one
      // number rather than becoming `1 5`.
      .replace(/[^\p{Letter}\p{Number}.]+/gu, " ")
      // A period that is not between digits is punctuation, not a decimal point.
      .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * The sentence cache key, or null when the sentence folds away to nothing.
 *
 * Null rather than the empty string so a caller cannot accidentally look up every
 * entry that was logged without a phrase.
 */
export function phraseKey(text: string): string | null {
  const folded = fold(text);
  return folded === "" ? null : folded;
}

/**
 * The `foods` cache key: the folded name and the unit its macros are per.
 *
 * The unit is part of the key rather than a column to reconcile, because `chicken`
 * per gram and `chicken` per item are two different sets of numbers and merging
 * them would multiply a portion by a hundred.
 */
export function foodKey(name: string, unit: FoodUnit): string {
  return `${fold(name)}|${unit}`;
}
