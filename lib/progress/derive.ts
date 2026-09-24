import type { MesocycleType, TendonSite, TestKind } from "@/lib/taxonomy";
import { addDays } from "./scale";

/**
 * The shaping the progress queries do after the rows come back.
 *
 * Split from `queries.ts` so the part that is real logic can be tested without a
 * database, and kept free of `lib/time`, which reads the environment. Callers turn
 * every timestamp into a training day before it gets here, so every input is a
 * plain `YYYY-MM-DD` key and "today" is always passed in rather than read.
 */

/** A jump test: one sitting, every attempt, and the best of them. */
export type JumpSitting = {
  testGroup: string;
  kind: TestKind;
  day: string;
  attempts: number[];
  best: number;
  boxHeightCm: number | null;
};

export type JumpRow = {
  testGroup: string | null;
  kind: TestKind;
  value: number;
  boxHeightCm: number | null;
  day: string;
  /** Distinguishes two ungrouped readings on one day. */
  instant: string;
};

/**
 * Attempts share a test group. A row without one is its own sitting rather than
 * being dropped: a single number typed in months ago is still the only reading
 * for that day, and the noise floor simply has nothing to say about it.
 */
export function groupSittings(rows: JumpRow[]): JumpSitting[] {
  const groups = new Map<string, JumpSitting>();
  for (const row of rows) {
    const key = row.testGroup ?? `solo:${row.kind}:${row.instant}`;
    const existing = groups.get(key);
    if (existing) {
      existing.attempts.push(row.value);
      existing.best = Math.max(existing.best, row.value);
    } else {
      groups.set(key, {
        testGroup: key,
        kind: row.kind,
        day: row.day,
        attempts: [row.value],
        best: row.value,
        boxHeightCm: row.boxHeightCm,
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export type BlockBand = {
  id: number;
  type: MesocycleType;
  ordinal: number;
  startDay: string;
  /** Exclusive. Derived, because a block's end is only known once it closes. */
  endDay: string;
  closed: boolean;
};

export type BlockRow = {
  id: number;
  type: MesocycleType;
  ordinal: number;
  startDay: string;
  plannedMicrocycles: number;
  /** The training day the block was closed on, null while it is still running. */
  closedDay: string | null;
};

/**
 * The mesocycle blocks, with an end date for each.
 *
 * A block does not store one: it stores a start and a planned length, and it
 * closes when it closes. So a closed block ends the day it was closed, which is
 * not always its planned end, because a flare or a missed week cuts a block short
 * and shading the weeks it never ran would put the next readings under the wrong
 * label. An open block ends at its planned length, or tomorrow if it has already
 * outrun its plan, since then it is still running. Either way it stops at the next
 * block's start. Rows must be ordered by start day.
 */
export function deriveBlockBands(
  rows: BlockRow[],
  today: string,
  fromDay: string,
): BlockBand[] {
  const tomorrow = addDays(today, 1);
  const bands = rows.map((row, i): BlockBand => {
    const next = rows[i + 1]?.startDay;
    const planned = addDays(row.startDay, row.plannedMicrocycles * 7);
    const closed = row.closedDay !== null;
    const own =
      row.closedDay !== null
        ? // Closing on the day it opened still leaves the block a day to be drawn.
          maxDay(row.closedDay, addDays(row.startDay, 1))
        : maxDay(planned, tomorrow);
    return {
      id: row.id,
      type: row.type,
      ordinal: row.ordinal,
      startDay: row.startDay,
      endDay: next && next < own ? next : own,
      closed,
    };
  });
  return bands.filter((band) => band.endDay > fromDay);
}

function maxDay(a: string, b: string) {
  return a > b ? a : b;
}

export type TendonWeek = {
  week: string;
  /** The worst reading of the week per site: the number that would stop training. */
  painBySite: Partial<Record<TendonSite, number>>;
  worstPain: number | null;
  contacts: number;
};

/**
 * Weekly tendon pain against weekly high-impact contacts.
 *
 * Every week from `fromWeek` to `lastWeek` exists, even an empty one: a gap in the
 * bars is information, it is the week nothing was jumped. Both bounds are
 * Mondays, and each reading's `week` is the Monday of the week it fell in.
 *
 * A reading's pain is the worst of its three questions, because any one of them
 * being high is the signal, and morning stiffness is the earliest of them. A
 * contact is one landing, so the count is reps and not sets.
 */
export function bucketTendonWeeks(
  fromWeek: string,
  lastWeek: string,
  pain: {
    week: string;
    site: TendonSite;
    during: number;
    after: number;
    stiffness: number;
  }[],
  contacts: { week: string; reps: number | null }[],
): TendonWeek[] {
  const byWeek = new Map<string, TendonWeek>();
  const bucket = (week: string) => {
    let row = byWeek.get(week);
    if (!row) {
      row = { week, painBySite: {}, worstPain: null, contacts: 0 };
      byWeek.set(week, row);
    }
    return row;
  };

  for (let week = fromWeek; week <= lastWeek; week = addDays(week, 7)) {
    bucket(week);
  }

  for (const row of pain) {
    const week = bucket(row.week);
    const worst = Math.max(row.during, row.after, row.stiffness);
    const prior = week.painBySite[row.site];
    if (prior === undefined || worst > prior) week.painBySite[row.site] = worst;
    if (week.worstPain === null || worst > week.worstPain) week.worstPain = worst;
  }

  for (const row of contacts) {
    bucket(row.week).contacts += row.reps ?? 1;
  }

  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Exponentially weighted bodyweight, one value per day that has a reading.
 *
 * Daily bodyweight is mostly noise, and every use of it here is as a denominator,
 * so it is smoothed once at the source rather than in each caller. The 0.25 factor
 * gives roughly a week of memory, which is the timescale a real change happens on.
 * Readings must be in day order.
 */
export function bodyweightTrend(readings: { day: string; kg: number }[]) {
  const out: { day: string; kg: number }[] = [];
  let level: number | null = null;
  for (const reading of readings) {
    level = level === null ? reading.kg : level + 0.25 * (reading.kg - level);
    out.push({ day: reading.day, kg: level });
  }
  return out;
}

/**
 * The trend bodyweight a lift on `day` is divided by.
 *
 * The latest value on or before the day, falling forward to the first later one
 * rather than giving up: a lift tested the week before the first weigh-in is still
 * a real data point. Null only when there is no bodyweight at all.
 */
export function bodyweightOn(trend: { day: string; kg: number }[], day: string) {
  let found: number | null = null;
  for (const point of trend) {
    if (point.day > day) break;
    found = point.kg;
  }
  return found ?? trend[0]?.kg ?? null;
}

/**
 * Best attempt per box height, in height order.
 *
 * The calibration question is what a height makes possible, not what an off
 * attempt at it looked like.
 */
export function bestByHeight(
  drops: { boxHeightCm: number; jumpCm: number; day: string }[],
) {
  const best = new Map<number, { day: string; jumpCm: number }>();
  for (const drop of drops) {
    const prior = best.get(drop.boxHeightCm);
    if (!prior || drop.jumpCm > prior.jumpCm) {
      best.set(drop.boxHeightCm, { day: drop.day, jumpCm: drop.jumpCm });
    }
  }
  return [...best.entries()]
    .map(([boxHeightCm, reading]) => ({ boxHeightCm, ...reading }))
    .sort((a, b) => a.boxHeightCm - b.boxHeightCm);
}
