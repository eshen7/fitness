import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, Tag } from "@/components/ui";
import { planSnapshot } from "@/lib/ai/proposals";
import { loadProfile } from "@/lib/ai/queries";
import { formatUsd } from "@/lib/ai/pricing";
import { formatDay } from "@/lib/days";
import type { Directory } from "@/lib/engine/types";
import { mesocycleTypeLabels, motorAbilityLabels } from "@/lib/labels";
import { getUnitSystem } from "@/lib/log/queries";
import { pendingFactCount } from "@/lib/memory/queries";
import { prescriptionMaxes } from "@/lib/prescription";
import { currentOneRms } from "@/lib/strength/queries";
import { today } from "@/lib/time";
import { CloseBlock } from "./close-block";
import { DeclareBlock } from "./declare-block";
import { GenerateWeek } from "./generate-week";
import { ProposalReview } from "./proposal-review";
import type { PlanLoads } from "./week-editor";
import { VerdictOutcome, VerdictOutcomeProvider } from "./verdict-outcome";

export const metadata = { title: "Plan" };

/**
 * The plan screen, which is one question at a time.
 *
 * With no block open the only question is whether to open one. With a block open
 * it is which week comes next. A pending proposal outranks both, because a
 * proposal awaiting a verdict is work already spent, and offering "generate
 * another" next to it is how you end up paying twice for the same week.
 */
export default async function PlanPage() {
  const [snapshot, pendingFacts, profile, unitSystem, current] = await Promise.all([
    planSnapshot(),
    pendingFactCount(),
    loadProfile(),
    getUnitSystem(),
    currentOneRms(),
  ]);
  const gaps = profileGaps(profile);
  const { block, pending, nextWeek } = snapshot;
  const names = namesOf(snapshot.directory);
  const loads: PlanLoads = {
    unitSystem,
    maxes: prescriptionMaxes(snapshot.directory.values(), current),
    slugs: Object.fromEntries(
      [...snapshot.directory].map(([id, exercise]) => [String(id), exercise.slug]),
    ),
  };
  const sidelinedIds = new Set(snapshot.sidelined.map((exclusion) => exclusion.exerciseId));

  return (
    <>
      <PageHeader title="Plan" subtitle="Blocks up front, weeks rolling.">
        {/*
          Start-aligned until `sm`: at phone widths `PageHeader` wraps this under the
          subtitle, where right-aligning the link to the end of the spend line leaves it
          floating mid-row.
        */}
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <span className="text-xs text-ink-faint tabular-nums">
            {formatUsd(snapshot.spendUsd)} of {formatUsd(snapshot.spendCapUsd)} spent
          </span>
          {/*
            All here rather than in the nav, which stays at six items. The profile and
            memory are what the generator reads, so the screen it is generated from is
            where a wrong fact gets noticed; the export is the same kind of thing one
            level up - it is what you reach for when you want the data out from under
            the app.
          */}
          <div className="flex items-center gap-4">
            <Link
              href="/profile"
              className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              Profile
              <span aria-hidden className="ml-1">→</span>
            </Link>
            <Link
              href="/plan/memory"
              className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              Memory
              {pendingFacts > 0 ? (
                <span className="ml-1.5 text-warn tabular-nums">
                  {pendingFacts} waiting
                </span>
              ) : null}
              <span aria-hidden className="ml-1">→</span>
            </Link>
            <Link
              href="/export"
              className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline"
            >
              Export
              <span aria-hidden className="ml-1">↓</span>
            </Link>
          </div>
        </div>
      </PageHeader>

      <VerdictOutcomeProvider>
        <div className="space-y-5">
          {gaps ? (
            <Card>
              <p className="text-sm text-ink-muted">
                <span className="font-medium text-warn">Profile incomplete.</span>{" "}
                {gaps}{" "}
                <Link
                  href="/profile"
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  Set up your profile
                  <span aria-hidden> →</span>
                </Link>
              </p>
            </Card>
          ) : null}

          {!snapshot.hasKey ? (
            <Card>
              <p className="text-sm text-ink-muted">
                <span className="font-medium text-warn">No API key.</span> Generation
                needs <code className="text-xs">OPENAI_API_KEY</code> in the
                environment. Everything already written still reads normally.
              </p>
            </Card>
          ) : null}

          {block ? (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-ink">
                      Block {block.ordinal}
                    </h2>
                    <Tag tone="accent">
                      {mesocycleTypeLabels.of(block.declaration.type)}
                    </Tag>
                    <Tag>
                      {block.priorWeeks.length} of{" "}
                      {block.declaration.plannedMicrocycles} weeks
                    </Tag>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">
                    From {formatDay(block.startDate)}
                  </p>
                </div>
                <CloseBlock />
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {block.declaration.targetAbilities.map((ability) => (
                  <Tag key={ability} tone="cool">
                    {motorAbilityLabels.of(ability)}
                  </Tag>
                ))}
              </div>
              {block.declaration.technicalFocus.length ? (
                <p className="mt-2 text-sm text-ink-muted">
                  <span className="text-ink-faint">Technical focus: </span>
                  {block.declaration.technicalFocus.join("; ")}
                </p>
              ) : null}

              <div className="mt-4">
                <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
                  The complex
                </p>
                {block.declaration.complex.length ? (
                  <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {block.declaration.complex.map((item) => (
                      <li
                        key={item.exerciseId}
                        className="flex items-center justify-between gap-2 rounded-field border border-line bg-surface-sunken px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-sm text-ink">
                          {names[String(item.exerciseId)] ?? `Exercise ${item.exerciseId}`}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {sidelinedIds.has(item.exerciseId) ? (
                            <Tag tone="warn">out for now</Tag>
                          ) : null}
                          {item.isMain ? <Tag tone="accent">main</Tag> : null}
                          <span className="text-xs text-ink-faint tabular-nums">
                            {item.targetWeeklyFrequency ?? 2}x/wk
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  // A block from before the generator existed has no complex recorded,
                  // and a week generated inside one cannot satisfy stable-complex. Say
                  // that, rather than leaving the heading standing over nothing.
                  <p className="mt-1.5 text-sm text-ink-muted">
                    Not recorded for this block, so a generated week has nothing to hold
                    stable. End the block and declare the next one.
                  </p>
                )}
                {snapshot.sidelined.length ? (
                  <div className="mt-3 rounded-field border border-warn/40 bg-warn/5 px-3 py-2.5 text-sm text-ink-muted">
                    <p>
                      <span className="font-medium text-warn">
                        {snapshot.sidelined.length} of {block.declaration.complex.length}{" "}
                        out for now.
                      </span>{" "}
                      The next week is planned without{" "}
                      {snapshot.sidelined.length === 1 ? "it" : "them"}, and until that
                      changes a regenerated week meets the same gap. If most of the
                      complex is out, ending the block and declaring one around what you
                      can do fits better.
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-ink-faint">
                      {snapshot.sidelined.map((exclusion) => (
                        <li key={exclusion.exerciseId}>{exclusion.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          <VerdictOutcome />

          {pending ? (
            <>
              {/* Keyed by proposal: a regeneration is a different proposal, and an
                  edit draft or an open reason form carried across to it would
                  accept the week that was just thrown away under the new one's id. */}
              <ProposalReview
                key={pending.id}
                proposal={pending}
                names={names}
                loads={loads}
              />
              {block && nextWeek ? (
                <Card>
                  <h2 className="text-base font-semibold text-ink">
                    Not what you wanted?
                  </h2>
                  <p className="mt-1 mb-3 text-sm text-ink-faint">
                    Regenerating supersedes the proposal above rather than replacing
                    it, so the reason it was thrown away stays on the record.
                  </p>
                  <GenerateWeek
                    key={pending.id}
                    mesocycleId={block.mesocycleId}
                    ordinal={pending.ask?.ordinal ?? nextWeek.ordinal}
                    startDate={pending.ask?.startDate ?? nextWeek.startDate}
                    supersedesId={pending.id}
                    disabled={!snapshot.hasKey}
                  />
                </Card>
              ) : null}
            </>
          ) : block && nextWeek ? (
            <Card>
              <h2 className="text-base font-semibold text-ink">
                Week {nextWeek.ordinal}
              </h2>
              <p className="mt-1 mb-4 text-sm text-ink-faint">
                Generated inside the declaration above: the complex is fixed, the load
                is what varies.
              </p>
              <GenerateWeek
                mesocycleId={block.mesocycleId}
                ordinal={nextWeek.ordinal}
                startDate={nextWeek.startDate}
                disabled={!snapshot.hasKey}
              />
            </Card>
          ) : (
            <Card>
              <h2 className="text-base font-semibold text-ink">Declare a block</h2>
              <p className="mt-1 mb-4 text-sm text-ink-faint">
                Type, one or two target abilities, one technical focus, and a stable
                complex of about ten exercises. Weeks are generated inside it
                afterwards, one at a time.
              </p>
              <DeclareBlock defaultStartDate={today()} disabled={!snapshot.hasKey} />
            </Card>
          )}

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">Recent proposals</h2>
            {snapshot.history.length === 0 ? (
              <EmptyState title="Nothing generated yet">
                Every proposal is kept, accepted or not, with the inputs it saw and
                what the gate made of it.
              </EmptyState>
            ) : (
              <ul className="space-y-1.5">
                {snapshot.history.map((proposal) => (
                  <li
                    key={proposal.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-field border border-line bg-surface px-3 py-2 text-sm"
                  >
                    <span className="text-ink-faint tabular-nums">#{proposal.id}</span>
                    <span className="text-ink">
                      {proposal.scope === "mesocycle" ? "Block" : "Week"}
                      {proposal.ask ? ` ${proposal.ask.ordinal}` : ""}
                    </span>
                    <Tag tone={verdictTone(proposal.verdict)}>{proposal.verdict}</Tag>
                    {proposal.isFallback ? <Tag tone="bad">fallback</Tag> : null}
                    {proposal.repairAttempts > 0 ? (
                      <Tag tone="warn">
                        {`${proposal.repairAttempts} repair${proposal.repairAttempts === 1 ? "" : "s"}`}
                      </Tag>
                    ) : null}
                    <span className="ml-auto text-xs text-ink-faint">
                      {proposal.ask ? formatDay(proposal.ask.startDate) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </VerdictOutcomeProvider>
    </>
  );
}

/**
 * Exercise names as a plain record. A `Map` cannot cross to a client component,
 * and the name is the only thing the review needs the directory for.
 */
function namesOf(directory: Directory): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [id, exercise] of directory) names[String(id)] = exercise.name;
  return names;
}

function verdictTone(verdict: string) {
  if (verdict === "accepted") return "accent" as const;
  if (verdict === "edited") return "cool" as const;
  if (verdict === "rejected") return "bad" as const;
  if (verdict === "pending") return "warn" as const;
  return "neutral" as const;
}

/**
 * What a blank profile costs the plan, or null when nothing is missing. The
 * pre-filter reads no equipment literally, as bodyweight only, so a fresh
 * install quietly plans push-ups for someone standing next to a rack.
 */
function profileGaps(profile: {
  availableEquipment: readonly string[];
  trainableWeekdays: readonly number[];
}) {
  const noEquipment = profile.availableEquipment.length === 0;
  const noDays = profile.trainableWeekdays.length === 0;
  if (noEquipment && noDays) {
    return "No equipment and no training days are set, so every plan is bodyweight only and lands on days the planner picks.";
  }
  if (noEquipment) return "No equipment is set, so every plan is bodyweight only.";
  if (noDays) return "No training days are set, so sessions land on days the planner picks.";
  return null;
}
