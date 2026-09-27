import Link from "next/link";
import { Card, EmptyState, Tag } from "@/components/ui";
import { storedInsights } from "@/lib/analytics/persist";
import { dayOf, formatDay } from "@/lib/time";
import { memoryFactTypeLabels } from "@/lib/labels";
import { factSummary, type MemoryFact } from "@/lib/memory/facts";
import { memoryFeed } from "@/lib/memory/queries";
import { FactActions } from "./fact-actions";
import { InsightList } from "./insight-list";
import { RecomputeInsights } from "./recompute-insights";
import { StateFact } from "./state-fact";

export const metadata = { title: "Memory" };

/**
 * What the app has learned, in the order the owner has to deal with it.
 *
 * The queue is first because it is the only part that blocks: a held fact is written
 * but inert, so until it is approved or deleted the planner is working without
 * something it thinks it knows. Then the live facts, then the insights, then the
 * corrections and deletions - which are shown rather than hidden, because a history of
 * being wrong is the only evidence anyone will have about whether reflection earns the
 * money it spends.
 */
export default async function MemoryPage() {
  const [feed, insights] = await Promise.all([memoryFeed(), storedInsights()]);

  return (
    <>
      {/*
        Its own header rather than `PageHeader`, matching the library detail page:
        `PageHeader` puts its children beside the title and wraps them underneath the
        subtitle at phone widths, where a back link left-aligned under a paragraph
        reads as one more line of prose. Above the title it reads as the way out.
      */}
      <header className="mb-6">
        <Link href="/plan" className="text-sm text-ink-faint hover:text-ink-muted">
          ← Plan
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Memory</h1>
        <p className="mt-1 text-sm text-ink-faint">
          What the app has learned, and what the numbers support saying.
        </p>
      </header>

      <div className="space-y-6">
        {feed.pending.length > 0 ? (
          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">
              Waiting on you
            </h2>
            <p className="mb-2.5 text-sm text-ink-faint">
              Two kinds of fact are never acted on unasked: anything that changes how a
              tendon is handled, and anything that would stop an exercise being
              prescribed at all. Each of these is written down and doing nothing until
              you say.
            </p>
            <ul className="space-y-2.5">
              {feed.pending.map((fact) => (
                <li key={fact.id}>
                  <FactCard fact={fact} pending />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h2 className="mb-2.5 text-base font-semibold text-ink">
            What it remembers
          </h2>
          {feed.active.length === 0 ? (
            <EmptyState title="Nothing learned yet">
              Reflection reads each session after you finish it, against what was
              prescribed and whatever you wrote in the notes. Anything it works out
              shows up here.
            </EmptyState>
          ) : (
            <ul className="space-y-2.5">
              {feed.active.map((fact) => (
                <li key={fact.id}>
                  <FactCard fact={fact} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-base font-semibold text-ink">Tell it something</h2>
          <p className="mb-2.5 text-sm text-ink-faint">
            Anything you say here outranks anything it works out for itself, and an
            inference that contradicts it is dropped rather than stored.
          </p>
          <Card>
            <StateFact />
          </Card>
        </section>

        <section>
          {/*
            Negative bottom margin on the row, not the button: the button's 44px hit
            area is padding, so a heading row sized by it would sit a thumb's width
            above the list it labels.
          */}
          <div className="-mb-1 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">
              What the numbers support
            </h2>
            <RecomputeInsights />
          </div>
          <InsightList insights={insights} />
        </section>

        {feed.past.length > 0 ? (
          <section>
            <h2 className="mb-1 text-base font-semibold text-ink">
              Corrected and deleted
            </h2>
            <p className="mb-2.5 text-sm text-ink-faint">
              Kept on purpose. A store that only ever showed its current facts would
              look infallible.
            </p>
            <ul className="space-y-1.5">
              {feed.past.map((fact) => (
                <li
                  key={fact.id}
                  className="rounded-field border border-line bg-surface/40 px-3 py-2"
                >
                  <p className="text-sm text-ink-faint line-through decoration-ink-faint/40">
                    {fact.body}
                  </p>
                  {/*
                    Date first, separator second, because the reason is free text: a
                    stored one ends in a full stop and a typed one may not, so appending
                    the date to it reads as either two sentence fragments or one run-on.
                  */}
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {fact.retiredAt !== null ? (
                      <>
                        <span className="tnum">
                          {formatDay(dayOf(fact.retiredAt))}
                        </span>
                        {" · "}
                        {fact.retiredReason ?? "Deleted"}
                      </>
                    ) : (
                      "Replaced by a later fact."
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

/**
 * One fact, with what it was inferred from underneath it.
 *
 * The observations are shown rather than tucked away, because they are what makes the
 * fact judgeable: "prefers to train in the morning" is worth keeping or deleting
 * depending entirely on whether it came off four sessions or one.
 */
function FactCard({
  fact,
  pending = false,
}: {
  fact: MemoryFact;
  pending?: boolean;
}) {
  return (
    <Card className="p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone={fact.source === "stated" ? "accent" : "neutral"}>
          {memoryFactTypeLabels.of(fact.type)}
        </Tag>
        {fact.source === "stated" ? <Tag tone="accent">yours</Tag> : null}
        {pending ? <Tag tone="warn">held</Tag> : null}
        {fact.supersedesId !== null ? (
          <span className="text-xs text-ink-faint">
            replaces an earlier fact
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-sm text-ink">{fact.body}</p>

      {pending && fact.confirmationReason ? (
        <p className="mt-1.5 text-sm text-warn">{fact.confirmationReason}</p>
      ) : null}

      <p className="mt-1.5 text-xs text-ink-faint">{factSummary(fact)}</p>

      {fact.observations.length > 0 ? (
        <ul className="mt-2 space-y-1 border-l border-line pl-3">
          {fact.observations.map((observation, index) => (
            <li key={index} className="text-xs text-ink-faint">
              {observation}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3">
        <FactActions id={fact.id} body={fact.body} pending={pending} />
      </div>
    </Card>
  );
}
