import { describe, expect, it } from "vitest";
import {
  APPROACH,
  BACK_SQUAT,
  DEPTH_JUMP,
  baselineWeek,
} from "@/lib/engine/fixtures/baseline";
import { addDays } from "@/lib/days";
import type { MicrocyclePlan, PlannedSession } from "@/lib/engine/types";
import { diffWeeks, identityOrigins } from "./edits";

/**
 * Owner edits are stored as a diff because the diff is the training signal:
 * "always cuts the third plyometric set" is a preference, and the edited plan on
 * its own records only the destination.
 */

/** Rewrites one prescription wherever it appears in a session. */
function change(
  week: MicrocyclePlan,
  input: { sessionIndex: number; exerciseId: number; patch: Record<string, number | null> },
): MicrocyclePlan {
  return mapSession(week, input.sessionIndex, (session) => ({
    ...session,
    blocks: session.blocks.map((block) => ({
      ...block,
      items: block.items.map((item) =>
        item.exerciseId === input.exerciseId ? { ...item, ...input.patch } : item,
      ),
    })),
  }));
}

function mapSession(
  week: MicrocyclePlan,
  index: number,
  fix: (session: PlannedSession) => PlannedSession,
): MicrocyclePlan {
  return {
    ...week,
    sessions: week.sessions.map((session, at) => (at === index ? fix(session) : session)),
  };
}

describe("diffWeeks", () => {
  it("reports nothing for an untouched week", () => {
    expect(diffWeeks(baselineWeek(), baselineWeek(), identityOrigins(baselineWeek()))).toEqual([]);
  });

  it("names the field, the day and both values of a prescription edit", () => {
    const before = baselineWeek();
    const after = change(before, {
      sessionIndex: 0,
      exerciseId: BACK_SQUAT,
      patch: { sets: 4, loadPctOf1rm: 90 },
    });

    expect(diffWeeks(before, after, identityOrigins(after))).toEqual([
      {
        kind: "prescription",
        day: before.sessions[0].day,
        exerciseId: BACK_SQUAT,
        field: "sets",
        from: 5,
        to: 4,
      },
      {
        kind: "prescription",
        day: before.sessions[0].day,
        exerciseId: BACK_SQUAT,
        field: "loadPctOf1rm",
        from: 87,
        to: 90,
      },
    ]);
  });

  it("treats clearing a field as an edit to null rather than as nothing", () => {
    const before = baselineWeek();
    const after = change(before, {
      sessionIndex: 0,
      exerciseId: DEPTH_JUMP,
      patch: { boxHeightCm: null },
    });

    expect(diffWeeks(before, after, identityOrigins(after))).toEqual([
      {
        kind: "prescription",
        day: before.sessions[0].day,
        exerciseId: DEPTH_JUMP,
        field: "boxHeightCm",
        from: 45,
        to: null,
      },
    ]);
  });

  it("records a moved session once, not as a rewrite of everything in it", () => {
    const before = baselineWeek();
    const moved = addDays(before.sessions[1].day, 1);
    const after = mapSession(before, 1, (session) => ({ ...session, day: moved }));

    expect(diffWeeks(before, after, identityOrigins(after))).toEqual([
      {
        kind: "session",
        day: moved,
        field: "day",
        from: before.sessions[1].day,
        to: moved,
      },
    ]);
  });

  it("distinguishes two sessions of the same kind", () => {
    // The baseline week has two mixed days, and the approach jump appears on both.
    // Keyed on kind alone the Monday edit would vanish behind the Friday session.
    const before = baselineWeek();
    const after = change(before, {
      sessionIndex: 0,
      exerciseId: APPROACH,
      patch: { sets: 2 },
    });

    expect(diffWeeks(before, after, identityOrigins(after))).toEqual([
      {
        kind: "prescription",
        day: before.sessions[0].day,
        exerciseId: APPROACH,
        field: "sets",
        from: 3,
        to: 2,
      },
    ]);
  });

  it("follows sessions that cross each other when moved", () => {
    // The editor keeps sessions sorted by day, so swapping the two mixed days
    // reorders them. Identity rides along as the origin index, so it is still two
    // moves and not two rewrites of each other's prescriptions.
    const before = baselineWeek();
    const [first, , last] = before.sessions;
    const days = new Map([
      [0, addDays(last.day, 1)],
      [2, addDays(before.startDate, 1)],
    ]);
    const edited = before.sessions
      .map((session, origin) => ({
        origin,
        session: { ...session, day: days.get(origin) ?? session.day },
      }))
      .sort((a, b) => a.session.day.localeCompare(b.session.day));
    const after: MicrocyclePlan = { ...before, sessions: edited.map((row) => row.session) };

    expect(
      diffWeeks(
        before,
        after,
        edited.map((row) => row.origin),
      ),
    ).toEqual([
      { kind: "session", day: days.get(0), field: "day", from: first.day, to: days.get(0) },
      { kind: "session", day: days.get(2), field: "day", from: last.day, to: days.get(2) },
    ]);
  });

  it("reports a dropped prescription and a dropped session", () => {
    const before = baselineWeek();
    const after: MicrocyclePlan = {
      ...before,
      sessions: [
        {
          ...before.sessions[0],
          blocks: before.sessions[0].blocks.map((block) => ({
            ...block,
            items: block.items.filter((item) => item.exerciseId !== DEPTH_JUMP),
          })),
        },
        before.sessions[2],
      ],
    };

    const edits = diffWeeks(before, after, [0, 2]);
    expect(edits).toContainEqual({
      kind: "removed",
      day: before.sessions[1].day,
      field: "session",
      from: "strength",
      to: null,
    });
    expect(edits).toContainEqual({
      kind: "removed",
      day: before.sessions[0].day,
      exerciseId: DEPTH_JUMP,
      from: 4,
      to: null,
    });
    // Every prescription in the dropped session is reported too, because the
    // signal is which work was thrown away rather than only that a day was.
    expect(
      edits.filter((edit) => edit.kind === "removed" && edit.exerciseId != null).length,
    ).toBe(6);
  });

  it("reports an added session and an added prescription", () => {
    const before = baselineWeek();
    const extra: PlannedSession = {
      day: addDays(before.startDate, 6),
      kind: "plyometric",
      title: "Extra jumps",
      plannedIntensity: 6,
      blocks: [
        { label: "Jumps", items: [{ exerciseId: APPROACH, sets: 3, reps: 8, restSeconds: 90 }] },
      ],
    };
    const after: MicrocyclePlan = { ...before, sessions: [...before.sessions, extra] };

    expect(diffWeeks(before, after, identityOrigins(after))).toEqual([
      { kind: "added", day: extra.day, field: "session", from: null, to: "plyometric" },
      { kind: "added", day: extra.day, exerciseId: APPROACH, from: null, to: 3 },
    ]);
  });

  it("records a change of load type or relative load against the week itself", () => {
    const before = baselineWeek();
    const after: MicrocyclePlan = { ...before, loadType: "retaining", relativeLoad: 0.7 };

    expect(diffWeeks(before, after, identityOrigins(after))).toEqual([
      {
        kind: "session",
        day: before.startDate,
        field: "loadType",
        from: "stimulating",
        to: "retaining",
      },
      {
        kind: "session",
        day: before.startDate,
        field: "relativeLoad",
        from: 0.9,
        to: 0.7,
      },
    ]);
  });

  it("reports an intensity edit separately from the prescriptions under it", () => {
    const before = baselineWeek();
    const after = mapSession(before, 2, (session) => ({ ...session, plannedIntensity: 9 }));

    expect(diffWeeks(before, after, identityOrigins(after))).toEqual([
      {
        kind: "session",
        day: before.sessions[2].day,
        field: "plannedIntensity",
        from: 7,
        to: 9,
      },
    ]);
  });
});
