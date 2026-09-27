import { count, desc, eq, notInArray, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import { INSIGHT_FAMILIES, type Insight, type InsightFamily, type InsightTier } from "./insight";

/**
 * Writing the suite to `derived_insights`, and reading it back.
 *
 * The table is the insight rather than a log of readings: `key` is unique, a recompute
 * updates in place, and the number it replaces moves into `previous_value`. That is
 * what the drift check the plan wants is eventually built on, and it is why the
 * previous value is taken from the row being overwritten inside the same statement
 * rather than read first and written second - two statements would race the nightly
 * recompute against a manual one and record a value as its own predecessor.
 */

/** Columns are numeric, so every number crosses the driver as a fixed-scale string. */
const VALUE_SCALE = 4;
const P_SCALE = 7;

/**
 * Replace the stored suite with this one.
 *
 * Keys absent from `insights` are deleted rather than left alone, which is the part
 * worth being deliberate about. An insight stops being computable when its data goes
 * away - a test day corrected, an exercise retired - and a stale row left behind would
 * go on asserting last month's number with last month's n on a screen that gives no
 * hint of when it was computed. Deleting is also why `previousValue` is only ever one
 * step of history: anything longer belongs in its own table, and nothing needs it yet.
 */
export async function saveInsights(
  insights: readonly Insight[],
  options: { db?: Db } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const { derivedInsights } = schema;
  const computedAt = new Date();

  const rows = insights.filter((insight) => Number.isFinite(insight.value));

  if (rows.length === 0) {
    // Nothing computable at all, which is the state of a fresh database. The table is
    // emptied rather than left as it was, for the same reason a missing key is
    // deleted: whatever is in there is no longer supported by any data.
    const deleted = await db.delete(derivedInsights).returning({ key: derivedInsights.key });
    return deleted.length;
  }

  // One transaction, so a failed delete leaves the old suite whole rather than fresh
  // rows beside stale ones.
  return db.transaction(async (tx) => {
    await tx
      .insert(derivedInsights)
      .values(
        rows.map((insight) => ({
          key: insight.key,
          family: insight.family,
          subject: insight.subject,
          statement: insight.statement,
          value: insight.value.toFixed(VALUE_SCALE),
          unit: insight.unit,
          n: insight.n,
          minN: insight.minN,
          ciLow: fixed(insight.ciLow, VALUE_SCALE),
          ciHigh: fixed(insight.ciHigh, VALUE_SCALE),
          p: fixed(insight.p, P_SCALE),
          pAdjusted: fixed(insight.pAdjusted, P_SCALE),
          nullValue: fixed(insight.nullValue, VALUE_SCALE),
          tier: insight.tier,
          assertable: insight.assertable,
          blockedBy: insight.blockedBy,
          detail: insight.detail,
          computedAt,
        })),
      )
      .onConflictDoUpdate({
        target: derivedInsights.key,
        set: {
          family: sql`excluded.family`,
          subject: sql`excluded.subject`,
          statement: sql`excluded.statement`,
          value: sql`excluded.value`,
          unit: sql`excluded.unit`,
          n: sql`excluded.n`,
          minN: sql`excluded.min_n`,
          ciLow: sql`excluded.ci_low`,
          ciHigh: sql`excluded.ci_high`,
          p: sql`excluded.p`,
          pAdjusted: sql`excluded.p_adjusted`,
          nullValue: sql`excluded.null_value`,
          tier: sql`excluded.tier`,
          assertable: sql`excluded.assertable`,
          blockedBy: sql`excluded.blocked_by`,
          detail: sql`excluded.detail`,
          computedAt: sql`excluded.computed_at`,
          // The row's own current value, before this statement overwrites it.
          previousValue: sql`${derivedInsights.value}`,
          updatedAt: computedAt,
        },
      });

    const stale = await tx
      .delete(derivedInsights)
      .where(
        notInArray(
          derivedInsights.key,
          rows.map((insight) => insight.key),
        ),
      )
      .returning({ key: derivedInsights.key });

    return rows.length + stale.length;
  });
}

export type StoredInsight = Insight & {
  computedAt: Date;
  /** The value before the last recompute, for drift. Null on the first one. */
  previousValue: number | null;
};

/**
 * How many statements currently clear the gate, for the link on `/progress`.
 *
 * Its own query rather than a filter over `storedInsights`, because the only thing
 * that screen needs is the number and every row carries a `detail` blob.
 */
export async function assertableInsightCount(options: { db?: Db } = {}): Promise<number> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ count: count() })
    .from(schema.derivedInsights)
    .where(eq(schema.derivedInsights.assertable, true));
  return row?.count ?? 0;
}

/**
 * Every stored insight, newest computation first.
 *
 * Returns the non-assertable ones too. They are what the feed renders as progress -
 * the n an insight has against the n it needs - and dropping them at the query would
 * make the screen look like the app has nothing to say rather than like it is being
 * careful. The UI, not this function, is responsible for never rendering a
 * non-assertable value.
 */
export async function storedInsights(options: { db?: Db } = {}): Promise<StoredInsight[]> {
  const db = options.db ?? getDb();
  const { derivedInsights } = schema;
  const rows = await db
    .select()
    .from(derivedInsights)
    .orderBy(desc(derivedInsights.assertable), desc(derivedInsights.computedAt));

  return rows.map((row) => ({
    key: row.key,
    family: asFamily(row.family),
    subject: row.subject,
    tier: asTier(row.tier),
    statement: row.statement,
    value: Number(row.value),
    unit: row.unit ?? "",
    n: row.n,
    minN: row.minN,
    ciLow: number(row.ciLow),
    ciHigh: number(row.ciHigh),
    p: number(row.p),
    pAdjusted: number(row.pAdjusted),
    nullValue: number(row.nullValue),
    assertable: row.assertable,
    blockedBy: row.blockedBy,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
    computedAt: row.computedAt,
    previousValue: number(row.previousValue),
  }));
}

/**
 * Coerced rather than cast, because the column is `text` and the union is a
 * TypeScript-only constraint. A family renamed in code and not migrated would
 * otherwise produce an `InsightFamily` that is not one and group into a heading that
 * does not exist.
 */
function asFamily(value: string): InsightFamily {
  return (INSIGHT_FAMILIES as readonly string[]).includes(value)
    ? (value as InsightFamily)
    : "load";
}

function asTier(value: number): InsightTier {
  return value === 2 || value === 3 ? value : 1;
}

function fixed(value: number | null, scale: number): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toFixed(scale);
}

function number(value: string | null): number | null {
  return value === null ? null : Number(value);
}
