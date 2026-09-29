import { Card, Notice, Tag } from "@/components/ui";
import { formatDay } from "@/lib/days";
import { energyDirectionLabels, mesocycleTypeLabels } from "@/lib/labels";
import {
  defaultsNote,
  directionOf,
  goalOf,
  maintenanceBasis,
  type DailyTarget,
  type TargetGoal,
  type TargetProposal,
} from "@/lib/nutrition/targets";
import type { MesocycleType } from "@/lib/taxonomy";
import { SetTargets } from "./set-targets";

/**
 * The daily targets, and what the rules would say about them today.
 *
 * Both, because they are different questions. The target in force is a decision made
 * on a date and is what the day is read against; the proposal is what the current
 * block and the current tendon state imply, and the two drifting apart is the prompt
 * to set a new one. Replacing the target silently when a block changed would rewrite
 * what yesterday was held to.
 */
export function TargetsCard({
  target,
  proposal,
  stale,
  suggestedGoal,
  cutRefusedBecause,
  blockType,
}: {
  target: DailyTarget | null;
  /** The proposal for the suggested goal, which is what the rules say now. */
  proposal: TargetProposal | null;
  stale: boolean;
  suggestedGoal: TargetGoal;
  cutRefusedBecause: string | null;
  blockType: MesocycleType | null;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-display text-xl leading-tight font-bold text-ink">Daily targets</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone={blockType ? "accent" : "neutral"}>
            {blockType ? mesocycleTypeLabels.of(blockType) : "No block open"}
          </Tag>
          {target ? (
            <Tag tone={toneFor(target.targetWeeklyChangePct)}>
              {changeWords(target.targetWeeklyChangePct)}
            </Tag>
          ) : null}
        </div>
      </div>

      {target ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Calories" value={`${target.kcal}`} unit="kcal" />
            <Stat label="Protein" value={`${target.proteinG}`} unit="g" />
            <Stat label="Carbs" value={`${target.carbsG}`} unit="g" />
            <Stat label="Fat" value={`${target.fatG}`} unit="g" />
          </dl>
          <p className="mt-2.5 text-xs text-ink-faint">
            In force since {formatDay(target.effectiveFrom)}
            {target.fluidMl ? `. Fluid ${(target.fluidMl / 1000).toFixed(1)} L a day` : ""}.
          </p>
          {/* Dated, because it was written then: "no block is open" stays in the
              rationale after a block opens, and read in the present tense it
              contradicts the tag above. */}
          {target.rationale ? (
            <p className="mt-2 text-sm text-ink-muted">
              <span className="text-ink-faint">When set: </span>
              {target.rationale}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ink-faint">
            {defaultsNote(directionOf(goalOf(target)))}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          Nothing set yet, so today has no target to read against. The numbers come
          from the rules rather than from a field: bodyweight sets the floors, the
          block sets the direction, and a cut waits for healthy tendons.
        </p>
      )}

      {proposal === null ? (
        <Notice className="mt-4">
          <p>
            Every target is per kilogram of bodyweight, so these follow a weigh-in. Log
            a morning weight and they can be set.
          </p>
        </Notice>
      ) : (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="eyebrow">
              What the rules say now
            </p>
            <p className="tnum text-xs text-ink-muted">
              {energyDirectionLabels.of(proposal.direction)}:{" "}
              <span className="font-medium text-ink">{proposal.kcal} kcal</span>
              {` · P ${proposal.proteinG} · C ${proposal.carbsG} · F ${proposal.fatG}`}
            </p>
          </div>
          {/*
            Which maintenance the rules rest on now, unless the target in force already
            says so word for word. A target set before the history could measure one
            says "default", and this line is what shows that it no longer is.
          */}
          {target?.rationale?.includes(maintenanceBasis(proposal)) ? null : (
            <p className="mt-2 text-sm text-ink-muted">{maintenanceBasis(proposal)}</p>
          )}
          {/*
            Once, beside whichever numbers the card leads with: under the target in
            force when there is one, here when this proposal is all there is.
          */}
          {target === null ? (
            <p className="mt-2 text-xs text-ink-faint">{defaultsNote(proposal.direction)}</p>
          ) : null}

          {stale ? (
            <p className="mt-2 text-sm text-warn">
              That is not what is in force. Setting it now starts a new range from
              today and leaves the old one covering the days it governed.
            </p>
          ) : null}

          {/*
            Asked on its own rather than read off the proposal, which only carries a
            refusal when the goal in force is a cut. Telling the owner before they
            pick Cut beats a target that quietly lands at maintenance afterwards.
          */}
          {cutRefusedBecause ? (
            <p className="mt-2 text-sm text-ink-muted">
              A cut would be declined right now: {cutRefusedBecause}.
            </p>
          ) : null}

          <div className="mt-3">
            <SetTargets defaultGoal={suggestedGoal} />
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-field bg-surface-sunken px-3 py-2.5">
      <dt className="eyebrow">{label}</dt>
      <dd className="numeral mt-1.5 text-2xl leading-none text-ink">
        {value}
        <span className="ml-1 font-sans text-xs font-normal text-ink-faint">{unit}</span>
      </dd>
    </div>
  );
}

/**
 * The target rate of change in words.
 *
 * A signed percent per week is the stored form and it is unreadable at a glance, so
 * the tag says which way and how fast; the chart below carries the number.
 */
function changeWords(pct: number | null) {
  if (pct === null || pct === 0) return "Hold bodyweight";
  return `${pct > 0 ? "+" : ""}${pct}% bodyweight a week`;
}

function toneFor(pct: number | null) {
  if (pct === null || pct === 0) return "neutral" as const;
  return pct > 0 ? "accent" as const : "cool" as const;
}
