import { addDays } from "@/lib/days";
import type { SessionKind } from "@/lib/taxonomy";

/** The slice of an open block that decides what a day with nothing planned means. */
export type BlockCalendar = {
  plannedMicrocycles: number;
  weeks: readonly {
    ordinal: number;
    startDate: string;
    sessions: readonly { day: string; kind: SessionKind; title?: string | null }[];
  }[];
};

export type NextSession = { day: string; kind: SessionKind; title: string | null };

/**
 * Why a day has no session on it, which decides what Today says instead.
 *
 * - `no-block`: nothing is open, so the next step is declaring one.
 * - `rest`: the day sits inside, or before, the weeks already written. It is a
 *   rest day of the plan, not a gap in it, and the owner wants the next session
 *   rather than an instruction to generate a week they already have. `next` is
 *   null when the rest of the written weeks is empty too, which is when
 *   `nextOrdinal` is the week to generate.
 * - `no-week`: the day is past every written week, so the next one is due.
 * - `block-done`: every planned week is written and behind the day, so the
 *   block has run its course and the next step is ending it.
 */
export type QuietDay =
  | { kind: "no-block" }
  | { kind: "rest"; next: NextSession | null; nextOrdinal: number | null }
  | { kind: "no-week"; nextOrdinal: number }
  | { kind: "block-done" };

export function quietDay(day: string, block: BlockCalendar | null): QuietDay {
  if (!block) return { kind: "no-block" };

  const weeks = [...block.weeks].sort((a, b) => a.ordinal - b.ordinal);
  const last = weeks.at(-1);
  const lastOrdinal = last?.ordinal ?? 0;
  const moreToWrite = lastOrdinal < block.plannedMicrocycles;
  const nextOrdinal = moreToWrite ? lastOrdinal + 1 : null;

  const written = last !== undefined && day < addDays(last.startDate, 7);
  if (!written) {
    return nextOrdinal === null
      ? { kind: "block-done" }
      : { kind: "no-week", nextOrdinal };
  }

  const upcoming = weeks
    .flatMap((week) => week.sessions)
    .filter((session) => session.day > day)
    .sort((a, b) => a.day.localeCompare(b.day))[0];

  return {
    kind: "rest",
    next: upcoming
      ? { day: upcoming.day, kind: upcoming.kind, title: upcoming.title ?? null }
      : null,
    nextOrdinal: upcoming ? null : nextOrdinal,
  };
}
