import { Card, EmptyState, Tag } from "@/components/ui";
import type { StoredInsight } from "@/lib/analytics/persist";
import { INSIGHT_FAMILIES } from "@/lib/analytics/insight";
import { insightFamilyLabels } from "@/lib/labels";
import { dayOf, formatDay } from "@/lib/time";

/**
 * What the numbers support saying, and what they do not yet.
 *
 * The asymmetry between the two halves is the whole point. An insight that cleared the
 * gate shows its sentence, its n and its interval. One that did not shows its subject
 * and what it is short of, and **never its value** - "your patellar ceiling is 212
 * contacts, n = 3" is a sentence the owner would remember long after the caveat, so the
 * number is not rendered at all rather than rendered with a warning beside it.
 *
 * Withheld insights are still listed, because the honest thing to show about twenty
 * weeks of one person's training is a short list of findings and a long list of
 * questions that are still open.
 */
export function InsightList({ insights }: { insights: StoredInsight[] }) {
  if (insights.length === 0) {
    return (
      <EmptyState title="Nothing computed yet">
        The suite is recomputed nightly, and every statement in it needs a few weeks of
        logged training before it can say anything.
      </EmptyState>
    );
  }

  const computedAt = insights.reduce(
    (latest, insight) => (insight.computedAt > latest ? insight.computedAt : latest),
    insights[0].computedAt,
  );
  const held = insights.filter((insight) => !insight.assertable);

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-faint">
        <span className="tnum">{insights.length - held.length}</span> of{" "}
        <span className="tnum">{insights.length}</span> statements clear the gate.
        Computed {formatDay(dayOf(computedAt))}.
      </p>

      {INSIGHT_FAMILIES.map((family) => {
        const group = insights.filter((insight) => insight.family === family);
        if (group.length === 0) return null;
        return (
          <section key={family}>
            <h3 className="mb-1.5 text-xs font-medium tracking-wide text-ink-faint uppercase">
              {insightFamilyLabels.of(family)}
            </h3>
            <ul className="space-y-1.5">
              {group.map((insight) => (
                <li key={insight.key}>
                  {insight.assertable ? (
                    <Asserted insight={insight} />
                  ) : (
                    <Withheld insight={insight} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Asserted({ insight }: { insight: StoredInsight }) {
  return (
    <Card className="p-3 sm:p-3.5">
      <p className="text-sm text-ink">{insight.statement}</p>
      {/*
        The figures carry `tnum`, the sentence above does not: `.tnum` also sets
        `white-space: nowrap`, which on a paragraph produces one long line that runs
        off the side of the card.
      */}
      <p className="mt-1.5 text-xs text-ink-faint">
        <span className="tnum">n = {insight.n}</span>
        {insight.ciLow !== null && insight.ciHigh !== null ? (
          <>
            {" · "}
            <span className="tnum">
              95% CI {round(insight.ciLow)} to {round(insight.ciHigh)}
              {insight.unit ? ` ${insight.unit}` : ""}
            </span>
          </>
        ) : null}
        {insight.pAdjusted !== null ? (
          <>
            {" · "}
            <span className="tnum">q = {insight.pAdjusted.toFixed(3)}</span>
          </>
        ) : null}
      </p>
    </Card>
  );
}

function Withheld({ insight }: { insight: StoredInsight }) {
  const short = insight.n < insight.minN;
  return (
    <div className="rounded-field border border-line border-dashed bg-surface/40 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm text-ink-muted">{insight.subject}</p>
        {short ? (
          <Tag>
            <span className="tnum">
              {insight.n} of {insight.minN}
            </span>
          </Tag>
        ) : (
          <Tag tone="warn">not yet</Tag>
        )}
      </div>
      {insight.blockedBy ? (
        <p className="mt-1 text-xs text-ink-faint">
          Withheld: {insight.blockedBy}.
        </p>
      ) : null}
    </div>
  );
}

/** Two decimals, then trimmed, so a ratio reads 1.32 and a calorie count 2550. */
function round(value: number) {
  return String(Number(value.toFixed(2)));
}
