/**
 * Development fixture: a realistic twenty-week training history.
 *
 * Charts and analytics cannot be judged against an empty database. A jump chart
 * with two points looks correct no matter what it does wrong, and the whole point
 * of the block shading is what happens to a line across four months. So this
 * writes a season that has the shapes the app is built to read: a dip inside a
 * hard accumulation block followed by supercompensation after the taper, tendon
 * pain lagging a heavy contact week, bodyweight drifting under a strength trend,
 * and prescriptions that were sometimes harder than they were meant to be.
 *
 * Deterministic: the same seed produces the same history, so a screenshot taken
 * today is comparable with one taken next week.
 *
 * This is destructive. It deletes the existing training history, measurements,
 * tendon records and food log before writing, so it is gated behind an explicit
 * flag and refuses a non-local database unless told otherwise.
 *
 *     npx tsx scripts/seed-history.ts --replace
 */
import { config } from "dotenv";
import { inArray, sql as raw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import { addDays, dayNumber } from "../lib/progress/scale";

config({ path: [".env.local", ".env"], quiet: true });

type Db = ReturnType<typeof drizzle<typeof schema>>;

/** Noon Eastern, so the row lands on the intended training day in any zone. */
function at(day: string, hour = 16) {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
}

/** Small, seeded, and good enough for jitter: the shapes are authored, not random. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20260915);
const jitter = (spread: number) => (random() - 0.5) * 2 * spread;

const START = "2026-04-27";

/**
 * The season. Authored rather than generated, because the point of the fixture is
 * the sequence: two accumulation blocks, a transmutation, a taper that peaks, then
 * the same again with the whole curve one step higher.
 */
const BLOCKS = [
  { type: "accumulation" as const, weeks: 4 },
  { type: "accumulation" as const, weeks: 4 },
  { type: "transmutation" as const, weeks: 3 },
  { type: "realization" as const, weeks: 2 },
  { type: "accumulation" as const, weeks: 4 },
  { type: "transmutation" as const, weeks: 3 },
  { type: "realization" as const, weeks: 2 },
];

/**
 * Jump tests, fortnightly, in centimetres.
 *
 * The two-foot approach is the shape that matters: it falls through the second
 * accumulation block, bottoming out on 8 June, and comes back over its old best
 * only after the taper. That dip is what the chart has to label as expected rather
 * than leave to be read as failure.
 */
const TESTS: {
  day: string;
  twoFoot: number;
  standing: number;
  oneFootLeft: number;
  oneFootRight: number;
}[] = [
  { day: "2026-04-27", twoFoot: 76.0, standing: 66.0, oneFootLeft: 72.0, oneFootRight: 64.0 },
  { day: "2026-05-11", twoFoot: 77.0, standing: 66.5, oneFootLeft: 73.0, oneFootRight: 64.5 },
  { day: "2026-05-25", twoFoot: 76.5, standing: 67.0, oneFootLeft: 72.0, oneFootRight: 64.0 },
  { day: "2026-06-08", twoFoot: 73.5, standing: 65.5, oneFootLeft: 70.5, oneFootRight: 62.5 },
  { day: "2026-06-22", twoFoot: 75.0, standing: 66.0, oneFootLeft: 71.5, oneFootRight: 63.0 },
  { day: "2026-07-06", twoFoot: 78.0, standing: 68.0, oneFootLeft: 74.0, oneFootRight: 65.0 },
  { day: "2026-07-20", twoFoot: 80.5, standing: 69.5, oneFootLeft: 76.0, oneFootRight: 66.5 },
  { day: "2026-08-03", twoFoot: 79.0, standing: 68.5, oneFootLeft: 75.0, oneFootRight: 66.0 },
  { day: "2026-08-17", twoFoot: 78.0, standing: 68.0, oneFootLeft: 74.0, oneFootRight: 65.0 },
  { day: "2026-08-31", twoFoot: 80.0, standing: 69.0, oneFootLeft: 75.5, oneFootRight: 66.0 },
  { day: "2026-09-14", twoFoot: 82.5, standing: 70.5, oneFootLeft: 77.0, oneFootRight: 67.5 },
];

/**
 * Box height against the vertical it produced, on one calibration day. It is a
 * test day, because calibration reads each drop against that day's standing jump.
 */
const DEPTH_JUMP_DAY = "2026-08-17";
const DEPTH_JUMP: [number, number][] = [
  [30, 68.0],
  [40, 69.0],
  [50, 69.5],
  [60, 67.5],
  [70, 64.5],
];

/**
 * The exercises the fixture programmes. Slugs from the stock directory, so a
 * missing one is a loud failure rather than a silently thinner history.
 */
const STRENGTH_A = ["back-squat", "romanian-deadlift", "bench-press", "pull-up"];
const STRENGTH_B = [
  "trap-bar-deadlift",
  "bulgarian-split-squat",
  "overhead-press",
  "barbell-row",
];
const PLYO_A = ["depth-jump", "hurdle-hop", "pogo-hop"];
const PLYO_B = ["box-jump", "alternate-leg-bound", "two-foot-approach-jump"];
const TESTED_LIFTS = ["back-squat", "trap-bar-deadlift", "bench-press"];
const ALL_SLUGS = [
  ...new Set([...STRENGTH_A, ...STRENGTH_B, ...PLYO_A, ...PLYO_B, ...TESTED_LIFTS]),
];

async function clear(db: Db) {
  // Ordered by dependency, and cascades cover the session tree below `sessions`.
  await db.delete(schema.loggedSets);
  await db.delete(schema.sessions);
  await db.delete(schema.microcycles);
  await db.delete(schema.mesocycles);
  await db.delete(schema.macrocycles);
  await db.delete(schema.measurements);
  await db.delete(schema.tendonStatus);
  await db.delete(schema.foodLogEntries);
}

type Block = {
  id: number;
  type: (typeof BLOCKS)[number]["type"];
  ordinal: number;
  startDay: string;
  weeks: number;
};

async function seedBlocks(db: Db): Promise<Block[]> {
  const [macrocycle] = await db
    .insert(schema.macrocycles)
    .values({
      name: "2026 jump season",
      startDate: START,
      objective: "Two foot approach vertical, with a healthy pair of patellar tendons",
    })
    .returning({ id: schema.macrocycles.id });

  const blocks: Block[] = [];
  let day = START;
  for (const [i, spec] of BLOCKS.entries()) {
    const last = i === BLOCKS.length - 1;
    const [row] = await db
      .insert(schema.mesocycles)
      .values({
        macrocycleId: macrocycle.id,
        ordinal: i + 1,
        type: spec.type,
        startDate: day,
        plannedMicrocycles: spec.weeks,
        targetAbilities:
          spec.type === "accumulation"
            ? ["max_strength", "hypertrophy"]
            : spec.type === "transmutation"
              ? ["explosive_strength", "reactive_strength"]
              : ["reactive_strength", "rate_of_force_development"],
        technicalFocus:
          spec.type === "realization"
            ? "Penultimate step depth held into the plant"
            : "Arm swing timing on the block foot",
        // Only the block that is still running is open. An end date is not stored,
        // so leaving an earlier one open would make every band run to today.
        closedAt: last ? null : at(addDays(day, spec.weeks * 7)),
      })
      .returning({ id: schema.mesocycles.id });

    blocks.push({
      id: row.id,
      type: spec.type,
      ordinal: i + 1,
      startDay: day,
      weeks: spec.weeks,
    });
    day = addDays(day, spec.weeks * 7);
  }
  return blocks;
}

/**
 * Every measurement the season would have produced, up to today and no further.
 *
 * The authored season is longer than the part of it that has happened, so each
 * series stops at today. A fixture that writes tomorrow's bodyweight does not just
 * look odd on the log screen, it moves the smoothed trend that relative strength
 * divides by and dates "last tested" into the future.
 */
async function seedMeasurements(
  db: Db,
  liftIds: Map<string, number>,
  today: string,
) {
  const rows: (typeof schema.measurements.$inferInsert)[] = [];

  for (const test of TESTS) {
    if (test.day > today) continue;
    const kinds = [
      ["two_foot_approach_vertical", test.twoFoot],
      ["standing_vertical", test.standing],
      ["one_foot_approach_left", test.oneFootLeft],
      ["one_foot_approach_right", test.oneFootRight],
    ] as const;

    for (const [kind, best] of kinds) {
      // Three attempts with the best last, which is the usual shape of a test and
      // is what the within-sitting spread that sets the noise floor is read from.
      const group = crypto.randomUUID();
      for (const [attempt, value] of [best - 1, best - 0.5, best].entries()) {
        rows.push({
          kind,
          value: value.toFixed(2),
          unit: "cm",
          measuredAt: at(test.day, 17),
          testGroup: group,
          attempt: attempt + 1,
        });
      }
    }
  }

  const depthGroup = crypto.randomUUID();
  for (const [attempt, [box, jump]] of (
    DEPTH_JUMP_DAY > today ? [] : DEPTH_JUMP
  ).entries()) {
    rows.push({
      kind: "depth_jump_vertical",
      value: jump.toFixed(2),
      unit: "cm",
      boxHeightCm: box.toFixed(1),
      measuredAt: at(DEPTH_JUMP_DAY, 17),
      testGroup: depthGroup,
      attempt: attempt + 1,
    });
  }

  // Bodyweight every morning, following the energy balance the food log below
  // records - up about a kilo and a half across the season, gaining in accumulation
  // and giving some back in each taper - with day-to-day water noise on top, because
  // everything that divides by bodyweight has to have something worth smoothing.
  // Daily rather than sparser, because the maintenance estimate reads a rate of gain
  // off each week of the trend, and at one reading in three the noise decides
  // whether that rate is plausible about as often as the energy balance does.
  const totalDays = BLOCKS.reduce((sum, block) => sum + block.weeks * 7, 0);
  for (let d = 0; d <= totalDays; d += 1) {
    if (addDays(START, d) > today) break;
    const trend = trendKgOn(addDays(START, d));
    rows.push({
      kind: "bodyweight",
      value: (trend + jitter(0.5)).toFixed(2),
      unit: "kg",
      measuredAt: at(addDays(START, d), 12),
    });
  }

  // Estimated 1RMs every four weeks. Squat and deadlift climb faster than the
  // bench, which is what makes the relative strength lines separate at all.
  const growth: Record<string, [number, number]> = {
    "back-squat": [140, 160],
    "trap-bar-deadlift": [175, 200],
    "bench-press": [95, 102],
  };
  for (let d = 0; d <= totalDays; d += 28) {
    if (addDays(START, d) > today) break;
    for (const slug of TESTED_LIFTS) {
      const [from, to] = growth[slug];
      rows.push({
        kind: "estimated_1rm",
        exerciseId: liftIds.get(slug),
        value: (from + ((to - from) * d) / totalDays + jitter(1.2)).toFixed(2),
        unit: "kg",
        measuredAt: at(addDays(START, d), 18),
      });
    }
  }

  await db.insert(schema.measurements).values(rows);
  return rows.length;
}

// -----------------------------------------------------------------------------
// Energy balance
// -----------------------------------------------------------------------------

/**
 * The intake the fixture athlete's weight holds at, which is what the maintenance
 * estimate should recover from the food log and the bodyweight trend. Deliberately
 * well away from 33 kcal/kg of an 80 kg athlete, so a target resting on the default
 * multiplier and one resting on the measurement are told apart at a glance.
 */
const MAINTENANCE_KCAL = 3000;

/** Energy in a kilogram of bodyweight change, matching the analytics' reference. */
const KCAL_PER_KG = 7700;

/**
 * The daily surplus each week was eaten at: a surplus in accumulation, about level
 * in transmutation, a small deficit in each taper. Varied week to week as well, since
 * maintenance is read off a line through weeks and weeks eaten identically within a
 * block would leave that line almost nothing to be fitted through.
 */
function surplusOn(day: string) {
  const offset = dayNumber(day) - dayNumber(START);
  let start = 0;
  for (const block of BLOCKS) {
    const end = start + block.weeks * 7;
    if (offset < end) {
      const week = Math.floor((offset - start) / 7);
      const base =
        block.type === "accumulation" ? 200 : block.type === "transmutation" ? 50 : -200;
      return base + [60, -40, 20, -60][week % 4];
    }
    start = end;
  }
  return 0;
}

/** Trend bodyweight on a day, as the running energy balance since the season began. */
function trendKgOn(day: string) {
  let kg = 80;
  for (let d = START; d < day; d = addDays(d, 1)) kg += surplusOn(d) / KCAL_PER_KG;
  return kg;
}

/**
 * Fixture foods, one per meal, so a day of eating reads as meals rather than one
 * row. Keyed apart from anything the parser would ever write.
 */
const FIXTURE_FOODS = [
  { key: "fixture:oats-with-whey", name: "Oats with whey and banana", meal: "breakfast", share: 0.25, kcal: 520, protein: 38, carbs: 72, fat: 9 },
  { key: "fixture:chicken-rice-bowl", name: "Chicken rice bowl", meal: "lunch", share: 0.3, kcal: 680, protein: 48, carbs: 82, fat: 16 },
  { key: "fixture:salmon-potatoes", name: "Salmon with potatoes and greens", meal: "dinner", share: 0.3, kcal: 720, protein: 44, carbs: 64, fat: 30 },
  { key: "fixture:greek-yogurt-granola", name: "Greek yogurt with granola", meal: "snack", share: 0.15, kcal: 340, protein: 22, carbs: 42, fat: 9 },
] as const;

/**
 * A food log that agrees with the bodyweight above, every day up to yesterday.
 *
 * Five days in seven, with the skipped days rotating, because a real log has gaps and
 * the maintenance estimate is built to count a week only once it has enough logged
 * days. Today is left empty: it is still being eaten. Its own random stream, so adding
 * it left every jittered number the rest of the fixture draws exactly as it was.
 */
async function seedFood(db: Db, today: string) {
  await db
    .insert(schema.foods)
    .values(
      FIXTURE_FOODS.map((food) => ({
        key: food.key,
        name: food.name,
        unit: "item",
        kcalPerUnit: food.kcal.toFixed(4),
        proteinGPerUnit: food.protein.toFixed(4),
        carbsGPerUnit: food.carbs.toFixed(4),
        fatGPerUnit: food.fat.toFixed(4),
        provenance: "owner",
      })),
    )
    .onConflictDoNothing({ target: schema.foods.key });
  const foods = await db
    .select({ id: schema.foods.id, key: schema.foods.key })
    .from(schema.foods)
    .where(inArray(schema.foods.key, FIXTURE_FOODS.map((food) => food.key)));
  const foodIds = new Map(foods.map((food) => [food.key, food.id]));

  const eat = rng(20260929);
  const rows: (typeof schema.foodLogEntries.$inferInsert)[] = [];
  for (let day = START; day < today; day = addDays(day, 1)) {
    const offset = dayNumber(day) - dayNumber(START);
    if ((offset + Math.floor(offset / 7)) % 7 >= 5) continue;
    const kcal = MAINTENANCE_KCAL + surplusOn(day) + (eat() - 0.5) * 2 * 250;
    for (const [i, food] of FIXTURE_FOODS.entries()) {
      rows.push({
        foodId: foodIds.get(food.key)!,
        quantity: ((kcal * food.share) / food.kcal).toFixed(2),
        meal: food.meal,
        day,
        loggedAt: at(day, 11 + i * 4),
        rawText: food.name.toLowerCase(),
      });
    }
  }

  await db.insert(schema.foodLogEntries).values(rows);
  return rows.length;
}

/**
 * Weekly load shape inside a block: three stimulating weeks then a lighter one,
 * with the taper blocks light throughout. This one number drives contacts, sets,
 * target RPE and the pain that follows them, so the whole fixture stays coherent.
 */
function weekLoad(block: Block, weekInBlock: number) {
  if (block.type === "realization") return 0.6 - weekInBlock * 0.1;
  if (block.type === "transmutation") return 0.85 - weekInBlock * 0.05;
  const shape = [0.85, 0.95, 1, 0.65];
  return shape[Math.min(weekInBlock, shape.length - 1)];
}

type Week = { block: Block; ordinal: number; startDay: string; load: number };

function weeks(blocks: Block[]): Week[] {
  const out: Week[] = [];
  for (const block of blocks) {
    for (let w = 0; w < block.weeks; w++) {
      out.push({
        block,
        ordinal: w + 1,
        startDay: addDays(block.startDay, w * 7),
        load: weekLoad(block, w),
      });
    }
  }
  return out;
}

async function seedSessions(
  db: Db,
  blocks: Block[],
  ids: Map<string, number>,
  today: string,
) {
  let sessionCount = 0;
  let loggedCount = 0;

  for (const week of weeks(blocks)) {
    if (week.startDay > today) continue;

    const [micro] = await db
      .insert(schema.microcycles)
      .values({
        mesocycleId: week.block.id,
        ordinal: week.ordinal,
        startDate: week.startDay,
        loadType:
          week.load >= 0.85
            ? "stimulating"
            : week.load >= 0.65
              ? "retaining"
              : "detraining",
        relativeLoad: week.load.toFixed(2),
      })
      .returning({ id: schema.microcycles.id });

    // Monday and Thursday strength, Tuesday and Saturday jumping: the ebook's
    // rule against back-to-back sessions sharing a coordination pattern.
    const plan = [
      { offset: 0, kind: "strength" as const, slugs: STRENGTH_A },
      { offset: 1, kind: "plyometric" as const, slugs: PLYO_A },
      { offset: 3, kind: "strength" as const, slugs: STRENGTH_B },
      { offset: 5, kind: "plyometric" as const, slugs: PLYO_B },
    ];

    for (const entry of plan) {
      const day = addDays(week.startDay, entry.offset);
      if (day > today) continue;

      const plyo = entry.kind === "plyometric";
      const targetRpe = plyo ? 6 + week.load * 2 : 6.5 + week.load * 2.5;
      // Every fifteenth session is missed outright, which is what an adherence
      // chart is for. Deterministic, so the count does not move between runs.
      const skipped = random() < 0.07;
      const contactsPerSet = plyo ? Math.round(8 + week.load * 4) : 0;

      const [session] = await db
        .insert(schema.sessions)
        .values({
          microcycleId: micro.id,
          day,
          kind: entry.kind,
          title: plyo ? "Reactive and jumps" : "Heavy lower and upper",
          plannedIntensity: Math.round(week.load * 9),
          plannedSets: entry.slugs.length * 4,
          plannedContacts: plyo ? contactsPerSet * 3 * entry.slugs.length : 0,
          startedAt: skipped ? null : at(day, 22),
          completedAt: skipped ? null : at(day, 23),
          skippedAt: skipped ? at(day, 23) : null,
          // Reported effort runs about half a point over target, which is the
          // calibration signal the adherence chart exists to surface.
          reportedRpe: skipped
            ? null
            : Math.min(10, targetRpe + 0.5 + jitter(0.6)).toFixed(1),
        })
        .returning({ id: schema.sessions.id });
      sessionCount += 1;

      const [block] = await db
        .insert(schema.sessionBlocks)
        .values({
          sessionId: session.id,
          position: 1,
          label: plyo ? "Jumps" : "Main work",
        })
        .returning({ id: schema.sessionBlocks.id });

      const prescribed = await db
        .insert(schema.prescribedSets)
        .values(
          entry.slugs.map((slug, i) => ({
            blockId: block.id,
            position: i + 1,
            exerciseId: ids.get(slug)!,
            sets: plyo ? 3 : 4,
            reps: plyo ? contactsPerSet : Math.round(8 - week.load * 3),
            targetRpe: targetRpe.toFixed(1),
            restSeconds: plyo ? 120 : 270,
          })),
        )
        .returning({
          id: schema.prescribedSets.id,
          exerciseId: schema.prescribedSets.exerciseId,
          sets: schema.prescribedSets.sets,
          reps: schema.prescribedSets.reps,
        });

      if (skipped) continue;

      const logged: (typeof schema.loggedSets.$inferInsert)[] = [];
      for (const row of prescribed) {
        // The last set of the last exercise is the one that gets dropped when a
        // session runs long, so adherence sits just under 100 rather than at it.
        const done = random() < 0.2 ? row.sets - 1 : row.sets;
        for (let s = 0; s < done; s++) {
          logged.push({
            sessionId: session.id,
            prescribedSetId: row.id,
            exerciseId: row.exerciseId,
            setIndex: s + 1,
            reps: row.reps,
            rpe: Math.min(10, targetRpe + 0.5 + jitter(0.8)).toFixed(1),
            qualityRating: random() < 0.15 ? 3 : 4,
            performedAt: at(day, 22),
            clientId: `fixture:${session.id}:${row.id}:${s}`,
          });
        }
      }
      if (logged.length) await db.insert(schema.loggedSets).values(logged);
      loggedCount += logged.length;
    }
  }

  return { sessionCount, loggedCount };
}

/**
 * Tendon pain, weekly, per site.
 *
 * Pain follows the previous week's load rather than the current one, because that
 * lag is the correlation the chart is drawn to show. The right patellar tendon is
 * the sore one, which is the asymmetry a real history has and a flat fixture does
 * not.
 */
async function seedTendon(db: Db, blocks: Block[], today: string) {
  const all = weeks(blocks);
  const rows: (typeof schema.tendonStatus.$inferInsert)[] = [];

  for (const [i, week] of all.entries()) {
    const day = addDays(week.startDay, 6);
    if (day > today) continue;
    const drive = all[i - 1]?.load ?? week.load;

    for (const site of [
      "patellar_left",
      "patellar_right",
      "achilles_left",
      "achilles_right",
    ] as const) {
      const bias =
        site === "patellar_right" ? 2.2 : site === "patellar_left" ? 1 : 0.3;
      const base = Math.max(0, drive * 3.4 + bias - 1.4 + jitter(0.6));
      const clamp = (value: number) =>
        Math.max(0, Math.min(10, Math.round(value)));
      rows.push({
        site,
        recordedAt: at(day, 13),
        painDuringLoad: clamp(base),
        painAfterLoad: clamp(base + 0.5),
        // Morning stiffness is the earliest signal, so it leads the other two.
        morningStiffness: clamp(base + 0.9),
        protocolPhase: null,
      });
    }
  }

  await db.insert(schema.tendonStatus).values(rows);
  return rows.length;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  if (!process.argv.includes("--replace")) {
    console.error(
      "This deletes the existing training history, measurements, tendon\n" +
        "records and food log, then writes a fixture season in their place.\n" +
        "Re-run with --replace to confirm.",
    );
    process.exit(1);
  }
  const local = /localhost|127\.0\.0\.1/.test(url);
  if (!local && !process.argv.includes("--allow-remote")) {
    console.error(
      "DATABASE_URL does not look local. This is development fixture data and\n" +
        "does not belong in a real database. Pass --allow-remote if you mean it.",
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema, casing: "snake_case" });

  const known = await db
    .select({ id: schema.exercises.id, slug: schema.exercises.slug })
    .from(schema.exercises)
    .where(inArray(schema.exercises.slug, ALL_SLUGS));
  const ids = new Map(known.map((row) => [row.slug, row.id]));
  const missing = ALL_SLUGS.filter((slug) => !ids.has(slug));
  if (missing.length) {
    throw new Error(`Run npm run db:seed first. Missing: ${missing.join(", ")}`);
  }

  const [{ today }] = await db.execute<{ today: string }>(
    raw`select to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD') as today`,
  );

  await clear(db);
  const blocks = await seedBlocks(db);
  const measurements = await seedMeasurements(db, ids, today);
  const { sessionCount, loggedCount } = await seedSessions(db, blocks, ids, today);
  const tendon = await seedTendon(db, blocks, today);
  const food = await seedFood(db, today);

  console.log(`blocks:       ${blocks.length}`);
  console.log(`measurements: ${measurements}`);
  console.log(`sessions:     ${sessionCount}`);
  console.log(`logged sets:  ${loggedCount}`);
  console.log(`tendon rows:  ${tendon}`);
  console.log(`food entries: ${food}`);

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
