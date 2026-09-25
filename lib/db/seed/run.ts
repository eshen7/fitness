/**
 * Seed runner. Run with `npm run db:seed`, or `npm run db:seed -- --force` to
 * push corrected stock attributes over rows that already exist.
 *
 * Idempotent by construction: every step is keyed on a natural key. By default an
 * exercise that already exists is left completely alone, because re-tagging and
 * disabling entries from `/library` are first-class owner actions and a seed that
 * silently reverts them is worse than no seed at all. `--force` is the explicit
 * opt-in for the other case, where the stock data itself was wrong.
 */
import { config } from "dotenv";
import { eq, inArray, sql as raw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import { STOCK_EXERCISES } from "./exercises";

config({ path: [".env.local", ".env"], quiet: true });

type SeedDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * The single profile row. Left almost entirely blank on purpose: measured values
 * belong to the owner, and a default height or training age would be read back
 * later as if it had been entered.
 */
async function seedProfile(db: SeedDb) {
  const [row] = await db
    .insert(schema.profile)
    .values({ id: 1 })
    .onConflictDoNothing({ target: schema.profile.id })
    .returning({ id: schema.profile.id });

  return row ? "created" : "already present";
}

async function seedExercises(db: SeedDb, force: boolean) {
  const rows = STOCK_EXERCISES.map(({ progressionOf: _progressionOf, ...rest }) => ({
    ...rest,
    isStock: true,
  }));

  const insert = db.insert(schema.exercises).values(rows);

  // `available` is deliberately absent from the update set even under --force:
  // whether a piece of equipment is reachable this month is the owner's fact
  // about their gym, never the seed file's.
  const written = await (force
    ? insert.onConflictDoUpdate({
        target: schema.exercises.slug,
        set: {
          name: raw`excluded.name`,
          primaryMuscleGroup: raw`excluded.primary_muscle_group`,
          secondaryMuscleGroups: raw`excluded.secondary_muscle_groups`,
          movementPattern: raw`excluded.movement_pattern`,
          forceVelocity: raw`excluded.force_velocity`,
          laterality: raw`excluded.laterality`,
          plane: raw`excluded.plane`,
          couplingClass: raw`excluded.coupling_class`,
          typicalContactSeconds: raw`excluded.typical_contact_seconds`,
          highImpact: raw`excluded.high_impact`,
          equipment: raw`excluded.equipment`,
          equipmentAnyOf: raw`excluded.equipment_any_of`,
          loadsTendonSites: raw`excluded.loads_tendon_sites`,
          tendonLoadRating: raw`excluded.tendon_load_rating`,
          protocolPhase: raw`excluded.protocol_phase`,
          technicalComplexity: raw`excluded.technical_complexity`,
          cues: raw`excluded.cues`,
          notes: raw`excluded.notes`,
          updatedAt: new Date(),
        },
      })
    : insert.onConflictDoNothing({ target: schema.exercises.slug })
  ).returning({ slug: schema.exercises.slug });

  await linkProgressions(db);
  return `${written.length} of ${rows.length} written`;
}

/**
 * Progression links are resolved in a second pass, because they are self
 * references and the target may not have existed when the source was inserted.
 */
async function linkProgressions(db: SeedDb) {
  const pairs = STOCK_EXERCISES.filter((e) => e.progressionOf).map((e) => ({
    slug: e.slug,
    from: e.progressionOf!,
  }));
  if (pairs.length === 0) return;

  const known = await db
    .select({ id: schema.exercises.id, slug: schema.exercises.slug })
    .from(schema.exercises)
    .where(
      inArray(
        schema.exercises.slug,
        pairs.flatMap((p) => [p.slug, p.from]),
      ),
    );
  const idBySlug = new Map(known.map((r) => [r.slug, r.id]));

  for (const pair of pairs) {
    const id = idBySlug.get(pair.slug);
    const fromId = idBySlug.get(pair.from);
    if (id === undefined || fromId === undefined) {
      throw new Error(`Unresolved progression: ${pair.slug} <- ${pair.from}`);
    }
    // Both directions, so a regression is reachable from either end.
    await db
      .update(schema.exercises)
      .set({ progressionOfId: fromId })
      .where(eq(schema.exercises.id, id));
    await db
      .update(schema.exercises)
      .set({ regressionOfId: id })
      .where(eq(schema.exercises.id, fromId));
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const force = process.argv.includes("--force");

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema, casing: "snake_case" });

  console.log("profile:", await seedProfile(db));
  console.log("exercises:", await seedExercises(db, force));

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
