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

type SessionPair = { before: PlannedSession | null; after: PlannedSession | null };

/**
 * Which accepted session each proposed one became.
 *
 * Neither array position nor kind alone works. Position breaks the moment a
 * session is dropped or moved, because the editor keeps sessions sorted by day.
 * Kind alone collides, because a week with two mixed days is ordinary - the
 * baseline week is one. So a session first claims one of its kind still on its
 * own day, and only a session that moved takes the next unclaimed one of its kind.
 */
function pairSessions(before: MicrocyclePlan, after: MicrocyclePlan): SessionPair[] {
  const unclaimed = new Set(after.sessions);
  const partner = new Map<PlannedSession, PlannedSession>();
  const claim = (session: PlannedSession, fits: (candidate: PlannedSession) => boolean) => {
    for (const candidate of unclaimed) {
      if (candidate.kind !== session.kind || !fits(candidate)) continue;
      unclaimed.delete(candidate);
      partner.set(session, candidate);
      return;
    }
  };
  for (const session of before.sessions) claim(session, (candidate) => candidate.day === session.day);
  for (const session of before.sessions) {
    if (!partner.has(session)) claim(session, () => true);
  }
  return [
    ...before.sessions.map((session) => ({ before: session, after: partner.get(session) ?? null })),
    ...[...unclaimed].map((session) => ({ before: null, after: session })),
  ];
}

function itemsOf(session: PlannedSession | null) {
  const items = new Map<number, PlannedSet>();
  for (const block of session?.blocks ?? []) {
    for (const item of block.items) items.set(item.exerciseId, item);
  }
  return items;
}

/**
 * The difference between the plan as proposed and the plan as accepted.
 *
 * Keyed on the paired session plus exercise rather than on array position,
 * because the edits worth learning from are "less of this exercise" and "this
 * session moved", and position-keyed diffs report both as a wholesale rewrite the
 * moment a session is dropped.
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

  const pairs = pairSessions(before, after);

  for (const { before: session, after: moved } of pairs) {
    if (!session) continue;
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
  for (const { before: session, after: added } of pairs) {
    if (session || !added) continue;
    edits.push({
      kind: "added",
      day: added.day,
      field: "session",
      from: null,
      to: added.kind,
    });
  }

  for (const { before: session, after: next } of pairs) {
    if (!session) continue;
    const nextItems = itemsOf(next);
    for (const item of itemsOf(session).values()) {
      const edited = nextItems.get(item.exerciseId);
      if (!next || !edited) {
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
        const to = edited[field] ?? null;
        if (from !== to) {
          edits.push({
            kind: "prescription",
            day: next.day,
            exerciseId: item.exerciseId,
            field,
            from,
            to,
          });
        }
      }
    }
  }
  for (const { before: session, after: next } of pairs) {
    if (!next) continue;
    const proposed = itemsOf(session);
    for (const item of itemsOf(next).values()) {
      if (proposed.has(item.exerciseId)) continue;
      edits.push({
        kind: "added",
        day: next.day,
        exerciseId: item.exerciseId,
        from: null,
        to: item.sets,
      });
    }
  }

  return edits;
}
