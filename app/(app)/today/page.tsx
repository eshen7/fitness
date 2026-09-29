import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NeedsMaxNote } from "@/components/needs-max-note";
import { PrescriptionRow } from "@/components/prescription";
import { ButtonLink, Card, DetailLine, EmptyState, Notice, QUIET_LINK, Tag, TextLink } from "@/components/ui";
import { loadDirectory, loadOpenBlock, loadPlannedDay } from "@/lib/ai/queries";
import { formatDay } from "@/lib/days";
import { loadGuideState } from "@/lib/guide/queries";
import { offerGuide, setupProgress } from "@/lib/guide/steps";
import { loadTypeLabels, mesocycleTypeLabels, sessionKindLabels } from "@/lib/labels";
import { getUnitSystem } from "@/lib/log/queries";
import { quietDay, type QuietDay } from "@/lib/plan/today";
import {
  liftsNeedingMax,
  prescriptionDetail,
  prescriptionLoad,
  prescriptionMaxes,
  prescriptionVolume,
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
      <PageHeader eyebrow={formatDay(day)} title="Today">
        {/* Always here, so the guide outlives the prompt that offers it. */}
        <Link href="/guide" className={QUIET_LINK}>
          Guide
        </Link>
      </PageHeader>

      <div className="space-y-6">
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
          <article key={sessionId} className="space-y-5">
            <header>
              <p className="eyebrow">
                <DetailLine
                  parts={[
                    `Block ${meta.ordinal} · ${mesocycleTypeLabels.of(meta.type)}`,
                    `Week ${week.ordinal}`,
                    loadTypeLabels.of(week.loadType),
                    <span key="load" className="tnum">
                      Load {week.relativeLoad.toFixed(2)}
                    </span>,
                  ]}
                />
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-ink">
                {session.title ?? sessionKindLabels.of(session.kind)}
              </h2>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Tag>{sessionKindLabels.of(session.kind)}</Tag>
                <Tag tone={session.plannedIntensity >= 8 ? "warn" : "neutral"}>
                  Intensity {session.plannedIntensity}/10
                </Tag>
                {completedAt ? <Tag tone="good">Done</Tag> : null}
                {skippedAt ? <Tag tone="bad">Skipped</Tag> : null}
              </div>
            </header>

            {week.loadType !== "stimulating" ? (
              <Notice tone="cool">
                <span className="font-semibold text-ink">
                  {loadTypeLabels.of(week.loadType)} week.
                </span>{" "}
                Easy on purpose: this is where the hard weeks turn into jump height, so
                the low numbers are the plan, not a shortfall.
              </Notice>
            ) : null}

            {week.rationale ? (
              <Notice>
                <h3 className="eyebrow">Why this week</h3>
                <p className="mt-1.5 whitespace-pre-line">{week.rationale}</p>
              </Notice>
            ) : null}

            <div className="space-y-3">
              {session.blocks.map((item, index) => (
                <Card key={`${item.label}-${index}`}>
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="eyebrow text-ink-muted">{item.label}</h3>
                    {item.complexPair ? <Tag tone="cool">Complex pair</Tag> : null}
                  </div>
                  <ul>
                    {item.items.map((prescription) => (
                      <PrescriptionRow
                        key={prescription.exerciseId}
                        name={
                          directory.directory.get(prescription.exerciseId)?.name ??
                          `Exercise ${prescription.exerciseId}`
                        }
                        volume={prescriptionVolume(prescription)}
                        load={prescriptionLoad(
                          prescription,
                          unitSystem,
                          maxes[String(prescription.exerciseId)],
                        )}
                        detail={prescriptionDetail(prescription)}
                      />
                    ))}
                  </ul>
                </Card>
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
              <ButtonLink
                href={`/log/session/${sessionId}`}
                size="lg"
                className="w-full sm:w-auto sm:min-w-56"
              >
                Log this session
              </ButtonLink>
            )}
          </article>
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
  return <TextLink href="/plan">{children}</TextLink>;
}
