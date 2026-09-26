import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { KnownFood } from "@/lib/ai/food";
import { getDb, schema, type Db } from "@/lib/db";
import type { FoodUnit } from "@/lib/taxonomy";
import { decodePerUnit, encodePerUnit, type PerUnitColumns } from "./macros";
import { foodKey } from "./normalize";
import type { CachedFood, FoodStore } from "./resolve";

/**
 * The `FoodStore` port over Postgres. The only part of the cache that needs a
 * database, which is why it is the only part that is not unit tested.
 *
 * Numerics cross the driver as strings in both directions. Per-unit macros go through
 * `encodePerUnit` and `decodePerUnit` in `./macros`, at the scale the columns in
 * `lib/db/schema/nutrition.ts` hold; reading a string as a number is the difference
 * between adding calories and concatenating them.
 */

function foodOf(
  row: PerUnitColumns & {
    id: number;
    key: string;
    name: string;
    unit: string;
    provenance: string;
  },
): CachedFood {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    // The column is text because a unit the parser invents should be storable
    // rather than a write that throws; the closed set is enforced where the parse
    // is validated.
    unit: row.unit as FoodUnit,
    perUnit: decodePerUnit(row),
    provenance: row.provenance,
  };
}

const foodColumns = {
  id: schema.foods.id,
  key: schema.foods.key,
  name: schema.foods.name,
  unit: schema.foods.unit,
  kcalPerUnit: schema.foods.kcalPerUnit,
  proteinGPerUnit: schema.foods.proteinGPerUnit,
  carbsGPerUnit: schema.foods.carbsGPerUnit,
  fatGPerUnit: schema.foods.fatGPerUnit,
  fiberGPerUnit: schema.foods.fiberGPerUnit,
  provenance: schema.foods.provenance,
};

export function foodStore(db: Db = getDb()): FoodStore {
  return {
    /**
     * The items the newest logging of this phrase resolved to.
     *
     * Newest rather than all of them, because the owner may have logged the same
     * breakfast twenty times and the answer is one breakfast. `logged_at` is the
     * grouping: every entry from one resolution shares an instant, so the maximum
     * for the phrase identifies one logging exactly, which a `limit` could not.
     */
    async byPhrase(key) {
      const { foodLogEntries, foods } = schema;
      const newest = db
        .select({ at: sql<Date>`max(${foodLogEntries.loggedAt})` })
        .from(foodLogEntries)
        .where(eq(foodLogEntries.phraseKey, key));

      const rows = await db
        .select({ quantity: foodLogEntries.quantity, ...foodColumns })
        .from(foodLogEntries)
        .innerJoin(foods, eq(foods.id, foodLogEntries.foodId))
        .where(
          and(
            eq(foodLogEntries.phraseKey, key),
            eq(foodLogEntries.loggedAt, sql`(${newest})`),
          ),
        )
        .orderBy(foodLogEntries.id);

      return rows.map((row) => ({ quantity: Number(row.quantity), food: foodOf(row) }));
    },

    async byKeys(keys) {
      if (keys.length === 0) return new Map();
      const rows = await db
        .select(foodColumns)
        .from(schema.foods)
        .where(inArray(schema.foods.key, [...new Set(keys)]));
      return new Map(rows.map((row) => [row.key, foodOf(row)]));
    },

    /**
     * The cached foods to show the model, most recently eaten first.
     *
     * Recency rather than alphabetical order, because the list is truncated and what
     * should survive the cut is what the owner still eats. Foods never logged sort
     * last, which is where a food added by a correction and then abandoned belongs.
     */
    async known(limit) {
      const { foods, foodLogEntries } = schema;
      const rows = await db
        .select({
          name: foods.name,
          unit: foods.unit,
          kcalPerUnit: foods.kcalPerUnit,
          lastUsed: sql<Date | null>`max(${foodLogEntries.loggedAt})`,
        })
        .from(foods)
        .leftJoin(foodLogEntries, eq(foodLogEntries.foodId, foods.id))
        .groupBy(foods.id, foods.name, foods.unit, foods.kcalPerUnit)
        .orderBy(sql`max(${foodLogEntries.loggedAt}) desc nulls last`)
        .limit(limit);

      return rows.map(
        (row): KnownFood => ({
          name: row.name,
          unit: row.unit as FoodUnit,
          kcalPerUnit: Number(row.kcalPerUnit),
        }),
      );
    },

    /**
     * Writes a food, or returns the one already there.
     *
     * `onConflictDoNothing` plus a read rather than `onConflictDoUpdate`: a key that
     * already exists holds numbers that are either a previous estimate or the
     * owner's own correction, and overwriting either would break the promise that
     * the same food always reports the same macros.
     */
    async upsert(food) {
      const key = foodKey(food.name, food.unit);
      const inserted = await db
        .insert(schema.foods)
        .values({
          key,
          name: food.name,
          unit: food.unit,
          ...encodePerUnit(food.perUnit),
          provenance: food.provenance,
        })
        .onConflictDoNothing({ target: schema.foods.key })
        .returning(foodColumns);
      if (inserted.length > 0) return foodOf(inserted[0]);

      const [existing] = await db
        .select(foodColumns)
        .from(schema.foods)
        .where(eq(schema.foods.key, key))
        .limit(1);
      return foodOf(existing);
    },
  };
}

/**
 * Whether any phrase has ever been logged, for the empty state.
 *
 * Cheap enough to ask on every page load and it answers the one question the UI
 * needs before it can decide whether to explain itself.
 */
export async function hasLoggedFood(db: Db = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.foodLogEntries.id })
    .from(schema.foodLogEntries)
    .where(isNotNull(schema.foodLogEntries.phraseKey))
    .orderBy(desc(schema.foodLogEntries.id))
    .limit(1);
  return row !== undefined;
}
