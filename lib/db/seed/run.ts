/**
 * Seed runner. Run with `npm run db:seed`.
 *
 * Idempotent by construction: every step is an upsert keyed on a natural key, so
 * re-running after a schema change re-tags existing rows instead of duplicating
 * them. That matters because the exercise directory landing in phase 2 is
 * long-lived data the owner edits by hand, and a seed that clobbers those edits
 * is worse than no seed at all.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema, casing: "snake_case" });

  console.log("profile:", await seedProfile(db));
  // Phase 2 adds the stock exercise directory here.

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
