import { describe, expect, it } from "vitest";
import {
  cycleDay,
  cyclePatch,
  recoveryPatch,
  sleepDay,
  sleepPatch,
} from "./project";
import { whoopCycle, whoopRecovery, whoopSleep } from "./records";

/**
 * A night ending at 06:40 on 13 September in New York, which is 10:40 UTC. The
 * UTC instant and the training day are deliberately the same date here; the
 * late-night case below is the one that separates them.
 */
const sleep = whoopSleep.parse({
  id: "9f1c0f6e-2a3b-4c5d-8e9f-0a1b2c3d4e5f",
  start: "2026-09-12T22:15:00.000Z",
  end: "2026-09-13T10:40:00.000Z",
  nap: false,
  score_state: "SCORED",
  score: {
    stage_summary: {
      total_in_bed_time_milli: 26_400_000,
      total_awake_time_milli: 1_800_000,
      total_light_sleep_time_milli: 13_200_000,
      total_slow_wave_sleep_time_milli: 5_400_000,
      total_rem_sleep_time_milli: 6_000_000,
    },
    sleep_performance_percentage: 88.4,
    sleep_efficiency_percentage: 93.2,
  },
});

describe("sleep projection", () => {
  it("dates a night by the morning it ends, in the training zone", () => {
    expect(sleepDay(sleep)).toBe("2026-09-13");
  });

  it("reports time asleep rather than time in bed", () => {
    // 26,400,000 ms in bed less 1,800,000 awake is 410 minutes.
    expect(sleepPatch(sleep).sleepMinutes).toBe(410);
  });

  it("carries the stages the reactive-performance insight needs", () => {
    const patch = sleepPatch(sleep);
    expect(patch.slowWaveMinutes).toBe(90);
    expect(patch.remMinutes).toBe(100);
  });

  it("rounds the percentages to whole points", () => {
    const patch = sleepPatch(sleep);
    expect(patch.sleepPerformancePct).toBe(88);
    expect(patch.sleepEfficiencyPct).toBe(93);
  });

  it("returns an empty patch for a record WHOOP has not scored yet", () => {
    const pending = whoopSleep.parse({
      id: "pending",
      start: "2026-09-12T22:15:00.000Z",
      end: "2026-09-13T10:40:00.000Z",
      score_state: "PENDING_SCORE",
      score: null,
    });
    expect(sleepPatch(pending)).toEqual({});
  });

  it("falls back to time in bed when no awake time is reported", () => {
    const partial = whoopSleep.parse({
      id: "partial",
      start: "2026-09-12T22:15:00.000Z",
      end: "2026-09-13T10:40:00.000Z",
      score_state: "SCORED",
      score: { stage_summary: { total_in_bed_time_milli: 26_400_000 } },
    });
    expect(sleepPatch(partial).sleepMinutes).toBe(440);
  });
});

describe("recovery projection", () => {
  const recovery = whoopRecovery.parse({
    cycle_id: 93845,
    sleep_id: "9f1c0f6e-2a3b-4c5d-8e9f-0a1b2c3d4e5f",
    score_state: "SCORED",
    score: {
      recovery_score: 67,
      resting_heart_rate: 48,
      hrv_rmssd_milli: 84.126,
      spo2_percentage: 96.4,
    },
  });

  it("keeps HRV as a fixed-scale string, since the column is numeric", () => {
    expect(recoveryPatch(recovery)).toEqual({
      recoveryScore: 67,
      restingHeartRate: 48,
      hrvMs: "84.13",
    });
  });

  it("normalises both ids to strings, whichever form they arrive in", () => {
    expect(recovery.cycle_id).toBe("93845");
    expect(recovery.sleep_id).toBe("9f1c0f6e-2a3b-4c5d-8e9f-0a1b2c3d4e5f");
  });

  it("returns an empty patch when the recovery is unscorable", () => {
    const unscorable = whoopRecovery.parse({
      cycle_id: 1,
      sleep_id: "s",
      score_state: "UNSCORABLE",
      score: null,
    });
    expect(recoveryPatch(unscorable)).toEqual({});
  });
});

describe("cycle projection", () => {
  it("dates a cycle by the day it starts on, in the training zone", () => {
    // 03:30 UTC on the 13th is 23:30 on the 12th in New York, and the strain of
    // that cycle accumulated on the 12th.
    const cycle = whoopCycle.parse({
      id: 93845,
      start: "2026-09-13T03:30:00.000Z",
      end: null,
      score_state: "SCORED",
      score: { strain: 14.732, kilojoule: 9421.4 },
    });
    expect(cycleDay(cycle)).toBe("2026-09-12");
    expect(cyclePatch(cycle)).toEqual({ dayStrain: "14.73" });
  });

  it("returns an empty patch for a cycle still in progress", () => {
    const open = whoopCycle.parse({
      id: 93846,
      start: "2026-09-13T13:30:00.000Z",
      score_state: "PENDING_SCORE",
      score: null,
    });
    expect(cyclePatch(open)).toEqual({});
  });
});
