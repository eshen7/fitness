import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NeedsMaxNote } from "@/components/needs-max-note";
import { Card, DetailLine, EmptyState, Tag } from "@/components/ui";
import { loadDirectory, loadOpenBlock, loadPlannedDay } from "@/lib/ai/queries";
import { formatDay } from "@/lib/days";
import { loadGuideState } from "@/lib/guide/queries";
import { offerGuide, setupProgress } from "@/lib/guide/steps";
import { loadTypeLabels, mesocycleTypeLabels, sessionKindLabels } from "@/lib/labels";
import { getUnitSystem } from "@/lib/log/queries";
import { quietDay, type QuietDay } from "@/lib/plan/today";
import {
  describePrescription,
  liftsNeedingMax,
  prescriptionDetail,
  prescriptionMaxes,
} from "@/lib/prescription";
import { currentOneRms } from "@/lib/strength/queries";
import { today } from "@/lib/time";
import { GuidePrompt } from "./guide-prompt";

export const metadata = { title: "Today" };

/**
 * What to do today, and why.
 *
 * The rationale sits next to the prescription rather than a tap away, because the
 * reason a week is light is exactly the thing an athlete needs on a light day. A
 * tracker that shows only the numbers invites adding sets to a back-off week.
 */
export default async function TodayPage() {
  const day = today();
  const [days, block, directory, unitSystem, current, guide] = await Promise.all([
    loadPlannedDay(day),
    loadOpenBlock(),
    loadDirectory(),
    getUnitSystem(),
    currentOneRms(),
    loadGuideState(),
  ]);
  const maxes = prescriptionMaxes(directory.exercises, current);
  const guided = offerGuide(guide.facts, guide.dismissedAt);

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={`${formatDay(day)}. The generated session, with the reasoning behind it.`}
      >
        {/* Always here, so the guide outlives the prompt that offers it. */}
        <Link
          href="/guide"
          className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          Guide
          <span aria-hidden className="ml-1">→</span>
        </Link>
      </PageHeader>

      <div className="space-y-5">
        {guided ? <GuidePrompt progress={setupProgress(guide.facts)} /> : null}

        {days.length === 0 ? (
          <NothingToday
            guided={guided}
            quiet={quietDay(
              day,
              block && {
                plannedMicrocycles: block.declaration.plannedMicrocycles,
                weeks: block.priorWeeks,
              },
            )}
          />
        ) : null}

        {days.map(({ sessionId, session, week, block: meta, completedAt, skippedAt }) => (
          <Card key={sessionId} className="space-y-4">
            <header className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-ink">
                  {session.title ?? sessionKindLabels.of(session.kind)}
                </h2>
                <Tag>{sessionKindLabels.of(session.kind)}</Tag>
                <Tag tone={session.plannedIntensity >= 8 ? "warn" : "neutral"}>
                  intensity {session.plannedIntensity}
                </Tag>
                {completedAt ? <Tag tone="accent">done</Tag> : null}
                {skippedAt ? <Tag tone="bad">skipped</Tag> : null}
              </div>
              <p className="text-xs text-ink-faint">
                <DetailLine
                  parts={[
                    `Block ${meta.ordinal}, ${mesocycleTypeLabels.of(meta.type)}`,
                    `Week ${week.ordinal}`,
                    loadTypeLabels.of(week.loadType),
                    <span key="load" className="tabular-nums">
                      relative load {week.relativeLoad.toFixed(2)}
                    </span>,
                  ]}
                />
              </p>
            </header>

            {week.loadType !== "stimulating" ? (
              <p className="rounded-field border border-cool/40 bg-cool/5 px-3 py-2 text-sm text-ink-muted">
                This is a {loadTypeLabels.of(week.loadType).toLowerCase()} week. The
                easy period is what realizes the adaptation the hard weeks built, so
                the low numbers are the plan rather than a shortfall.
              </p>
            ) : null}

            {week.rationale ? (
              <section>
                <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">
                  Why this week
                </h3>
                <p className="mt-1.5 text-sm whitespace-pre-line text-ink-muted">
                  {week.rationale}
                </p>
              </section>
            ) : null}

            <div className="space-y-3">
              {session.blocks.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                      {item.label}
                    </p>
                    {item.complexPair ? <Tag tone="cool">complex pair</Tag> : null}
                  </div>
                  <ul className="mt-1.5 space-y-1.5">
                    {item.items.map((prescription) => (
                      <li
                        key={prescription.exerciseId}
                        className="rounded-field border border-line bg-surface-sunken px-3 py-2"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-sm text-ink">
                            {directory.directory.get(prescription.exerciseId)?.name ??
                              `Exercise ${prescription.exerciseId}`}
                          </span>
                          <span className="text-xs text-ink-muted tabular-nums">
                            {describePrescription(
                              prescription,
                              unitSystem,
                              maxes[String(prescription.exerciseId)],
                            )}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {prescriptionDetail(prescription)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <NeedsMaxNote
              lifts={liftsNeedingMax(
                session.blocks.flatMap((item) => item.items),
                maxes,
              ).flatMap((id) => {
                const exercise = directory.directory.get(id);
                return exercise ? [{ name: exercise.name, slug: exercise.slug }] : [];
              })}
            />

            {completedAt || skippedAt ? null : (
              <Link
                href={`/log/session/${sessionId}`}
                className="inline-flex h-11 items-center justify-center rounded-field bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:brightness-105"
              >
                Log this session
              </Link>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

/**
 * What a day with no session means, and the one thing to do about it.
 *
 * A rest day inside a written week is the plan working, so it gets the next
 * session rather than an instruction to generate the week it is already in.
 * While the setup prompt is showing it names the next step, so a fresh install
 * is not sent to declare a block before the planner knows what gym it is for.
 */
function NothingToday({ quiet, guided }: { quiet: QuietDay; guided: boolean }) {
  switch (quiet.kind) {
    case "no-block":
      return (
        <EmptyState
          title="No block open"
          action={guided ? null : <PlanLink>Declare a block on Plan</PlanLink>}
        >
          A block is the next few weeks: one or two targets and a fixed set of
          exercises. Once it is open, each week is generated inside it and shows up
          here.
        </EmptyState>
      );
    case "no-week":
      return (
        <EmptyState
          title="Nothing planned for today"
          action={<PlanLink>Generate week {quiet.nextOrdinal} on Plan</PlanLink>}
        >
          Week {quiet.nextOrdinal} of this block has not been generated yet.
        </EmptyState>
      );
    case "block-done":
      return (
        <EmptyState
          title="Block finished"
          action={<PlanLink>End it and declare the next on Plan</PlanLink>}
        >
          Every planned week of this block is behind you.
        </EmptyState>
      );
    case "rest":
      if (quiet.next) {
        return (
          <EmptyState title="Rest day">
            Next up: {quiet.next.title ?? sessionKindLabels.of(quiet.next.kind)} on{" "}
            {/* One unit, so a narrow screen never strands the month on its own line. */}
            <span className="whitespace-nowrap">{formatDay(quiet.next.day)}.</span>
          </EmptyState>
        );
      }
      return quiet.nextOrdinal === null ? (
        <EmptyState
          title="Rest day"
          action={<PlanLink>End it and declare the next on Plan</PlanLink>}
        >
          That was the last session of this block.
        </EmptyState>
      ) : (
        <EmptyState
          title="Rest day"
          action={<PlanLink>Generate week {quiet.nextOrdinal} on Plan</PlanLink>}
        >
          That was the last session of this week. The next one is not generated yet.
        </EmptyState>
      );
  }
}

function PlanLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href="/plan"
      className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline"
    >
      {children}
      <span aria-hidden className="ml-1">→</span>
    </Link>
  );
}
