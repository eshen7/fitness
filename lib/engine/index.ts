import { advise } from "./advisories";
import { normalizeWeek } from "./normalize";
import type { PrefilterResult } from "./prefilter";
import type {
  Advisory,
  Change,
  Directory,
  MesocycleDeclaration,
  MicrocyclePlan,
  PlannedSession,
  Violation,
} from "./types";
import { gate } from "./validate";

/**
 * The rule engine: pure TypeScript, no model involvement, no database.
 *
 * The generator calls `prefilter` before building the prompt, then hands each
 * proposal to one of the two reviews below. Both return everything the proposal
 * record stores: the normalized plan, the normalizer diff, the gate report and
 * the advisories. `passed` is the only thing that decides whether the repair
 * loop runs; advisories never do.
 */

export * from "./advisories";
export * from "./classify";
export * from "./directory";
export * from "./normalize";
export * from "./prefilter";
export * from "./rules";
export * from "./types";
export * from "./validate";

export type WeekReview = {
  week: MicrocyclePlan;
  changes: Change[];
  violations: Violation[];
  advisories: Advisory[];
  passed: boolean;
};

/** A block at declaration: the mesocycle-scope gate rules, before any week exists. */
export function reviewDeclaration(input: {
  declaration: MesocycleDeclaration;
  directory: Directory;
  prefiltered: PrefilterResult;
}) {
  const violations = gate({
    declaration: input.declaration,
    directory: input.directory,
    eligible: new Set(input.prefiltered.candidates.map((exercise) => exercise.id)),
    excluded: input.prefiltered.excluded,
  });
  return { violations, passed: violations.length === 0 };
}

/**
 * One generated week: normalize, then gate, then advise. The gate and the
 * advisories read the normalized week, so a field the normalizer fixed is never
 * also reported as a violation.
 */
export function reviewWeek(input: {
  declaration: MesocycleDeclaration;
  directory: Directory;
  prefiltered: PrefilterResult;
  week: MicrocyclePlan;
  priorWeeks?: readonly MicrocyclePlan[];
  priorSession?: PlannedSession | null;
}): WeekReview {
  const { week, changes } = normalizeWeek(
    input.week,
    input.directory,
    input.declaration.complex,
  );
  const violations = gate({
    declaration: input.declaration,
    directory: input.directory,
    eligible: new Set(input.prefiltered.candidates.map((exercise) => exercise.id)),
    excluded: input.prefiltered.excluded,
    week,
    priorWeeks: input.priorWeeks,
    priorSession: input.priorSession,
  });
  const advisories = violations.length
    ? []
    : advise({
        declaration: input.declaration,
        directory: input.directory,
        week,
        priorWeeks: input.priorWeeks,
      });
  return { week, changes, violations, advisories, passed: violations.length === 0 };
}
