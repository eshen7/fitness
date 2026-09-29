import { describe, expect, it } from "vitest";
import { loggedSetSchema } from "./schemas";
import {
  buildLoggedSet,
  carriesOut,
  EMPTY_FIELDS,
  nextLine,
  planProgress,
  prefill,
  type PlanLine,
} from "./plan";

function line(id: number, overrides: Partial<PlanLine> = {}): PlanLine {
  return {
    id,
    blockLabel: "Main work",
    cueOverride: null,
    exerciseId: id * 10,
    sets: 3,
    reps: 5,
    holdSeconds: null,
    loadPctOf1rm: null,
    loadKg: null,
    boxHeightCm: null,
    targetRpe: 8,
    tempo: null,
    restSeconds: 180,
    couplingClass: null,
    shockMethod: null,
    ...overrides,
  };
}

const depthJump = line(1, { blockLabel: "Jumps", exerciseId: 16, sets: 3, reps: 6, boxHeightCm: 45, targetRpe: 7 });
const deadlift = line(2, { exerciseId: 26, sets: 2, reps: 5, loadPctOf1rm: 85 });
const splitSquat = line(3, { exerciseId: 30, sets: 3, reps: 8, loadKg: 24 });
const plan = [depthJump, deadlift, splitSquat];

function logFrom(lineId: number | null, entries: { prescribedSetId: number | null }[]) {
  const progress = planProgress(plan, entries);
  return buildLoggedSet({
    clientId: "client-0001",
    sessionId: 89,
    exerciseId: 16,
    prescribedSetId: carriesOut(progress, lineId),
    setIndex: entries.length + 1,
    fields: { ...EMPTY_FIELDS, reps: "6", box: "18", rpe: "7.5", quality: 4 },
    unitSystem: "imperial",
    performedAt: new Date("2026-09-28T15:00:00Z"),
  });
}

describe("linking a logged set to its prescription", () => {
  // The regression: every set the logger wrote used to land with a null
  // prescribed set, so calibration and the plan comparison never saw real data.
  it("links a set logged against a planned line to that line", () => {
    const set = logFrom(depthJump.id, []);
    expect(set).toMatchObject({ exerciseId: 16, prescribedSetId: depthJump.id });
    // And the receiver accepts it with the link intact.
    const parsed = loggedSetSchema.parse(set);
    expect(parsed.prescribedSetId).toBe(depthJump.id);
  });

  it("keeps linking until the line's sets are done", () => {
    const set = logFrom(depthJump.id, [
      { prescribedSetId: depthJump.id },
      { prescribedSetId: depthJump.id },
    ]);
    expect(set).toMatchObject({ prescribedSetId: depthJump.id });
  });

  it("leaves an extra set past the prescription unlinked", () => {
    const set = logFrom(depthJump.id, [
      { prescribedSetId: depthJump.id },
      { prescribedSetId: depthJump.id },
      { prescribedSetId: depthJump.id },
    ]);
    expect(set).toMatchObject({ prescribedSetId: null });
  });

  it("leaves an unplanned exercise unlinked", () => {
    expect(logFrom(null, [])).toMatchObject({ prescribedSetId: null });
  });

  it("does not link to a line that is not in this session's plan", () => {
    expect(carriesOut(planProgress(plan, []), 999)).toBeNull();
  });

  it("still refuses a set with neither reps nor a hold", () => {
    const set = buildLoggedSet({
      clientId: "client-0002",
      sessionId: 89,
      exerciseId: 16,
      prescribedSetId: depthJump.id,
      setIndex: 1,
      fields: EMPTY_FIELDS,
      unitSystem: "metric",
      performedAt: new Date(),
    });
    expect(set).toEqual({ error: "A set needs either reps or a hold time." });
  });
});

describe("plan progress", () => {
  it("opens on the first planned line, in session order", () => {
    expect(nextLine(planProgress(plan, []))).toBe(depthJump);
  });

  it("counts only the sets linked to each line, queued or stored", () => {
    const progress = planProgress(plan, [
      { prescribedSetId: depthJump.id },
      { prescribedSetId: null },
      { prescribedSetId: deadlift.id },
      { prescribedSetId: depthJump.id },
    ]);
    expect(progress.map(({ done }) => done)).toEqual([2, 1, 0]);
  });

  it("moves on once a line is done and stops when the plan is", () => {
    const three = Array.from({ length: 3 }, () => ({ prescribedSetId: depthJump.id }));
    expect(nextLine(planProgress(plan, three))).toBe(deadlift);

    const all = [
      ...three,
      ...Array.from({ length: 2 }, () => ({ prescribedSetId: deadlift.id })),
      ...Array.from({ length: 3 }, () => ({ prescribedSetId: splitSquat.id })),
    ];
    expect(nextLine(planProgress(plan, all))).toBeNull();
  });

  it("returns to a line skipped earlier", () => {
    const progress = planProgress(plan, [
      ...Array.from({ length: 2 }, () => ({ prescribedSetId: deadlift.id })),
    ]);
    expect(nextLine(progress)).toBe(depthJump);
  });
});

describe("prefill", () => {
  const lastOuting = { reps: 10, loadKg: 100, holdSeconds: null, boxHeightCm: 30, rpe: 9 };

  it("fills reps and the plan's box height, in display units", () => {
    const fields = prefill({ line: depthJump, linkedTo: null, sessionSets: [], lastOuting, unitSystem: "metric" });
    expect(fields).toMatchObject({ reps: "6", box: "45", rpe: "" });
  });

  it("keeps the load the athlete settled on earlier in the session", () => {
    const sessionSets = [
      { prescribedSetId: splitSquat.id, reps: 7, loadKg: 26, holdSeconds: null, boxHeightCm: null, rpe: 8 },
    ];
    const fields = prefill({ line: splitSquat, linkedTo: splitSquat.id, sessionSets, lastOuting, unitSystem: "metric" });
    expect(fields).toMatchObject({ reps: "8", load: "26" });
  });

  it("opens a back-off line at its own load, not the top sets'", () => {
    const top = line(5, { exerciseId: 40, sets: 3, reps: 3, loadKg: 140 });
    const backOff = line(6, { exerciseId: 40, sets: 2, reps: 8, loadKg: 100 });
    const heavy = { prescribedSetId: top.id, reps: 3, loadKg: 140, holdSeconds: null, boxHeightCm: null, rpe: 8 };
    const sessionSets = [heavy, heavy, heavy];
    const progress = planProgress([top, backOff], sessionSets);
    const next = nextLine(progress);
    expect(next).toBe(backOff);
    const linkedTo = carriesOut(progress, next!.id);
    expect(prefill({ line: next, linkedTo, sessionSets, lastOuting, unitSystem: "metric" })).toMatchObject({
      reps: "8",
      load: "100",
    });
    const adjusted = [...sessionSets, { ...heavy, prescribedSetId: backOff.id, reps: 8, loadKg: 95 }];
    expect(prefill({ line: backOff, linkedTo, sessionSets: adjusted, lastOuting, unitSystem: "metric" }).load).toBe("95");
  });

  it("carries the session's last set into an extra one past the line", () => {
    const sessionSets = [
      { prescribedSetId: splitSquat.id, reps: 8, loadKg: 26, holdSeconds: null, boxHeightCm: null, rpe: 8 },
    ];
    expect(prefill({ line: splitSquat, linkedTo: null, sessionSets, lastOuting, unitSystem: "metric" }).load).toBe("26");
  });

  it("uses the planned load in kilograms before the first set", () => {
    const fields = prefill({ line: splitSquat, linkedTo: null, sessionSets: [], lastOuting, unitSystem: "metric" });
    expect(fields.load).toBe("24");
  });

  it("never converts a percentage of 1RM into a load", () => {
    const fields = prefill({ line: deadlift, linkedTo: null, sessionSets: [], lastOuting, unitSystem: "metric" });
    expect(fields.load).toBe("100");
    const fresh = prefill({ line: deadlift, linkedTo: null, sessionSets: [], lastOuting: undefined, unitSystem: "metric" });
    expect(fresh.load).toBe("");
  });

  it("falls back to the last outing for an unplanned exercise", () => {
    const fields = prefill({ line: null, linkedTo: null, sessionSets: [], lastOuting, unitSystem: "metric" });
    expect(fields).toMatchObject({ reps: "10", load: "100", box: "30", rpe: "" });
  });

  it("fills a planned hold for an isometric line", () => {
    const hold = line(4, { reps: null, holdSeconds: 45 });
    expect(prefill({ line: hold, linkedTo: null, sessionSets: [], lastOuting: undefined, unitSystem: "metric" })).toMatchObject({ hold: "45", reps: "" });
  });
});
