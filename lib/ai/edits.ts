import type { MicrocyclePlan, PlannedSession, PlannedSet } from "@/lib/engine/types";

/**
 * What the owner changed before accepting, field by field.
 *
 * The plan's promise is that owner edits become training signal: a pattern of
 * cutting the third plyometric set, or of always moving Friday to Saturday, is a
 * preference the generator should learn rather than keep proposing against. That
 * only works if the edit is stored as a diff. Storing the edited plan alone
 * records the destination and throws away the correction.
 */

export type OwnerEdit = {
  kind: "session" | "prescription" | "removed" | "added";
  day: string;
  exerciseId?: number;
  field?: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
};

/** The prescription fields an owner can change from the review screen. */
const SET_FIELDS = [
  "sets",
  "reps",
  "loadKg",
  "loadPctOf1rm",
  "boxHeightCm",
  "holdSeconds",
  "targetRpe",
] as const;

/**
 * A session's identity across an edit: its kind, plus which one of that kind it is.
 *
 * Neither half alone works. Array position breaks the moment a session is dropped,
 * reporting every later session as rewritten. Kind alone collides, because a week
 * with two mixed days is ordinary - the baseline week is one - and merging them
 * would silently drop every edit made to the first.
 */
function keyedSessions(week: MicrocyclePlan) {
  const seen = new Map<string, number>();
  return week.sessions.map((session) => {
    const nth = (seen.get(session.kind) ?? 0) + 1;
    seen.set(session.kind, nth);
    return { key: `${session.kind}#${nth}`, session };
  });
}

function itemsWithSessions(week: MicrocyclePlan) {
  const rows = new Map<string, { session: PlannedSession; item: PlannedSet }>();
  for (const { key, session } of keyedSessions(week)) {
    for (const block of session.blocks) {
      for (const item of block.items) {
        rows.set(`${key}:${item.exerciseId}`, { session, item });
      }
    }
  }
  return rows;
}

/**
 * The difference between the plan as proposed and the plan as accepted.
 *
 * Keyed on session kind plus exercise rather than on array position, because the
 * edits worth learning from are "less of this exercise" and "this session moved",
 * and position-keyed diffs report both as a wholesale rewrite the moment a session
 * is dropped.
 */
export function diffWeeks(before: MicrocyclePlan, after: MicrocyclePlan): OwnerEdit[] {
  const edits: OwnerEdit[] = [];

  if (before.loadType !== after.loadType) {
    edits.push({
      kind: "session",
      day: after.startDate,
      field: "loadType",
      from: before.loadType,
      to: after.loadType,
    });
  }
  if (before.relativeLoad !== after.relativeLoad) {
    edits.push({
      kind: "session",
      day: after.startDate,
      field: "relativeLoad",
      from: before.relativeLoad,
      to: after.relativeLoad,
    });
  }

  const beforeSessions = new Map(
    keyedSessions(before).map(({ key, session }) => [key, session]),
  );
  const afterSessions = new Map(
    keyedSessions(after).map(({ key, session }) => [key, session]),
  );

  for (const [key, session] of beforeSessions) {
    const moved = afterSessions.get(key);
    if (!moved) {
      edits.push({
        kind: "removed",
        day: session.day,
        field: "session",
        from: session.kind,
        to: null,
      });
      continue;
    }
    if (moved.day !== session.day) {
      edits.push({
        kind: "session",
        day: moved.day,
        field: "day",
        from: session.day,
        to: moved.day,
      });
    }
    if (moved.plannedIntensity !== session.plannedIntensity) {
      edits.push({
        kind: "session",
        day: moved.day,
        field: "plannedIntensity",
        from: session.plannedIntensity,
        to: moved.plannedIntensity,
      });
    }
  }
  for (const [key, session] of afterSessions) {
    if (!beforeSessions.has(key)) {
      edits.push({
        kind: "added",
        day: session.day,
        field: "session",
        from: null,
        to: session.kind,
      });
    }
  }

  const beforeItems = itemsWithSessions(before);
  const afterItems = itemsWithSessions(after);

  for (const [key, { session, item }] of beforeItems) {
    const next = afterItems.get(key);
    if (!next) {
      edits.push({
        kind: "removed",
        day: session.day,
        exerciseId: item.exerciseId,
        from: item.sets,
        to: null,
      });
      continue;
    }
    for (const field of SET_FIELDS) {
      const from = item[field] ?? null;
      const to = next.item[field] ?? null;
      if (from !== to) {
        edits.push({
          kind: "prescription",
          day: next.session.day,
          exerciseId: item.exerciseId,
          field,
          from,
          to,
        });
      }
    }
  }
  for (const [key, { session, item }] of afterItems) {
    if (beforeItems.has(key)) continue;
    edits.push({
      kind: "added",
      day: session.day,
      exerciseId: item.exerciseId,
      from: null,
      to: item.sets,
    });
  }

  return edits;
}
