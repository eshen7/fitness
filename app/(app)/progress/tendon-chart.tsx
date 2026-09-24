import {
  ChartCard,
  Columns,
  Dot,
  Legend,
  Lines,
  Plot,
  PointLabel,
  SERIES,
  Slices,
  TableView,
  type SliceRow,
  type Tick,
} from "@/components/chart";
import { tendonSiteLabels } from "@/lib/labels";
import type { TendonWeek } from "@/lib/progress/queries";
import { linePath, niceExtent, yPct } from "@/lib/progress/scale";
import { TENDON_SITES } from "@/lib/taxonomy";
import { shortDay, tickIndexes } from "@/lib/progress/axis";

/**
 * Tendon pain against high-impact contact volume, on one shared week axis.
 *
 * These are two measures on incompatible scales - a 0 to 10 rating and a count in
 * the hundreds - so they get two plots stacked over one x axis rather than one
 * plot with two y axes. A dual axis would let the crossing point be moved
 * anywhere by choosing the scales, which is exactly the claim this chart is
 * making: that pain follows load. Stacked plots let the eye read the lag off a
 * shared week position without the geometry asserting a correlation.
 *
 * The count is reps, not sets, because one contact is one landing.
 */
export function TendonChart({ weeks }: { weeks: TendonWeek[] }) {
  const present = TENDON_SITES.filter((site) =>
    weeks.some((week) => week.painBySite[site] !== undefined),
  );
  const anything = weeks.some(
    (week) => week.worstPain !== null || week.contacts > 0,
  );

  // Weeks are buckets, not instants, so each sits at the centre of its slot and
  // the columns below line up with the line points above by construction.
  const slot = 100 / Math.max(weeks.length, 1);
  const centre = (i: number) => (i + 0.5) * slot;

  const pain = { min: 0, max: 10 };
  const painTicks = [0, 5, 10];
  const { extent: contactExtent, ticks: contactTicks } = niceExtent(
    weeks.map((week) => week.contacts),
    { zero: true, ticks: 2 },
  );

  // Four or so labels across the window, rather than a solid gray band of dates.
  const xTicks: Tick[] = tickIndexes(weeks.length).map(
    (i): Tick => ({ pct: centre(i), label: shortDay(weeks[i].week) }),
  );

  const rowsFor = (week: TendonWeek): SliceRow[] => [
    ...present.flatMap((site, i) => {
      const value = week.painBySite[site];
      return value === undefined
        ? []
        : [
            {
              label: tendonSiteLabels.of(site),
              value: `${value}/10`,
              color: SERIES[i % SERIES.length],
            },
          ];
    }),
    { label: "Contacts", value: String(week.contacts) },
  ];

  const worstWeek = weeks.reduce<TendonWeek | null>(
    (worst, week) =>
      week.worstPain !== null && (!worst || week.worstPain > (worst.worstPain ?? 0))
        ? week
        : worst,
    null,
  );

  return (
    <ChartCard
      title="Tendon pain and contact volume"
      note="Pain follows load by a day or three, so the two are read off one shared week axis. Contacts are landings, counted in reps."
    >
      {!anything ? (
        <p className="text-xs text-ink-faint">
          Nothing logged yet. Once high-impact work is logged, the weeks that
          preceded a painful one become visible here.
        </p>
      ) : (
        <>
          <p className="mb-1.5 text-[11px] font-medium text-ink-muted">
            Worst pain in the week, 0 to 10
          </p>
          <Plot
            yTicks={painTicks.map((t) => ({ pct: yPct(t, pain), label: String(t) }))}
            xTicks={[]}
            height={112}
          >
            <Lines
              series={present.map((site, i) => ({
                color: SERIES[i % SERIES.length],
                path: linePath(
                  weeks.map((week, w) => {
                    const value = week.painBySite[site];
                    return value === undefined
                      ? null
                      : { x: centre(w), y: yPct(value, pain) };
                  }),
                ),
              }))}
            />

            {present.map((site, i) =>
              weeks.map((week, w) => {
                const value = week.painBySite[site];
                return value === undefined ? null : (
                  <Dot
                    key={`${site}-${week.week}`}
                    leftPct={centre(w)}
                    topPct={yPct(value, pain)}
                    color={SERIES[i % SERIES.length]}
                    small
                  />
                );
              }),
            )}

            {/* One label: the worst week, which is the one worth going back to. */}
            {worstWeek && worstWeek.worstPain !== null ? (
              <PointLabel
                leftPct={centre(weeks.indexOf(worstWeek))}
                topPct={yPct(worstWeek.worstPain, pain)}
                align={
                  centre(weeks.indexOf(worstWeek)) > 85 ? "left" : "above"
                }
              >
                {worstWeek.worstPain}/10
              </PointLabel>
            ) : null}

            <Slices
              slices={weeks.map((week, i) => ({
                leftPct: i * slot,
                widthPct: slot,
                title: `Week of ${shortDay(week.week)}`,
                rows: rowsFor(week),
              }))}
            />
          </Plot>

          <p className="mt-4 mb-1.5 text-[11px] font-medium text-ink-muted">
            High-impact contacts in the week
          </p>
          <Plot
            yTicks={contactTicks.map((t) => ({
              pct: yPct(t, contactExtent),
              label: String(t),
            }))}
            xTicks={xTicks}
            height={88}
          >
            {/*
              One series, so it takes a neutral fill rather than a series hue:
              the heading above the plot names it, and spending a categorical
              colour here would imply it belongs to the same set as the pain
              lines above, which are on a different scale entirely.
            */}
            <Columns
              color="var(--color-series-neutral)"
              bars={weeks.map((week, i) => ({
                leftPct: i * slot,
                widthPct: slot,
                // A week with a handful of contacts still gets a visible sliver,
                // because zero and nearly-zero are different weeks.
                heightPct: week.contacts
                  ? Math.max(1.5, 100 - yPct(week.contacts, contactExtent))
                  : 0,
                title: `${shortDay(week.week)}: ${week.contacts} contacts`,
              }))}
            />
            <Slices
              slices={weeks.map((week, i) => ({
                leftPct: i * slot,
                widthPct: slot,
                title: `Week of ${shortDay(week.week)}`,
                rows: rowsFor(week),
              }))}
            />
          </Plot>

          <Legend
            items={present.map((site, i) => ({
              label: tendonSiteLabels.of(site),
              color: SERIES[i % SERIES.length],
            }))}
          />

          <TableView
            caption="Weekly worst pain per site against high-impact contacts"
            columns={[
              "Week",
              ...present.map((site) => tendonSiteLabels.of(site)),
              "Contacts",
            ]}
            rows={weeks
              .slice()
              .reverse()
              .map((week) => [
                shortDay(week.week),
                ...present.map((site) => week.painBySite[site] ?? null),
                week.contacts,
              ])}
          />
        </>
      )}
    </ChartCard>
  );
}
