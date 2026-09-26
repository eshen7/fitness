import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, Tag } from "@/components/ui";
import { loadDirectory, loadOpenBlock, loadPlannedDay } from "@/lib/ai/queries";
import { formatDay } from "@/lib/days";
import { loadTypeLabels, mesocycleTypeLabels, sessionKindLabels } from "@/lib/labels";
import { describePrescription, prescriptionDetail } from "@/lib/prescription";
import { today } from "@/lib/time";

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
  const [days, block, directory] = await Promise.all([
    loadPlannedDay(day),
    loadOpenBlock(),
    loadDirectory(),
  ]);

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={`${formatDay(day)}. The generated session, with the reasoning behind it.`}
      />

      <div className="space-y-5">
        {days.length === 0 ? (
          <EmptyState title="Nothing planned for today">
            {block
              ? "This block is open but today is not in a generated week. Generate the next week on Plan."
              : "No block is open. Declare one on Plan and the weeks follow from it."}
          </EmptyState>
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
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                <span>
                  Block {meta.ordinal}, {mesocycleTypeLabels.of(meta.type)}
                </span>
                <span aria-hidden="true">·</span>
                <span>Week {week.ordinal}</span>
                <span aria-hidden="true">·</span>
                <span>{loadTypeLabels.of(week.loadType)}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  relative load {week.relativeLoad.toFixed(2)}
                </span>
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
                            {describePrescription(prescription)}
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
