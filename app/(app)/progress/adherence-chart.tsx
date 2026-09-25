import {
  ChartCard,
  Columns,
  Dot,
  Legend,
  Lines,
  Plot,
  SERIES,
  Slices,
  TableView,
  type SliceRow,
  type Tick,
} from "@/components/chart";
import { Tag } from "@/components/ui";
import { sessionKindLabels } from "@/lib/labels";
import type { SessionOutcome } from "@/lib/progress/queries";
import { linePath, mean, yPct } from "@/lib/progress/scale";
import type { SessionKind } from "@/lib/taxonomy";
import { shortDay, tickIndexes } from "@/lib/progress/axis";

/**
 * Adherence and RPE against what was prescribed.
 *
 * This is the chart that judges the generator rather than the athlete. Sets
 * completed over sets prescribed is adherence; reported RPE sitting above target
 * RPE means the prescription was too hard, which is a correction factor and not a
 * discipline problem.
 *
 * Two plots over one shared session axis rather than one plot with two scales: a
 * percentage and a 0 to 10 rating have no common axis, and putting them on one
 * would let the apparent relationship be set by the choice of scales.
 *
 * Sessions are the x unit, evenly spaced, because the question here is "per
 * session" and a calendar axis would bunch a heavy week into a smear and leave a
 * deload week as empty space.
 */
export function AdherenceChart({ sessions }: { sessions: SessionOutcome[] }) {
  const planned = sessions.filter((session) => session.prescribedSets > 0);
  const slot = 100 / Math.max(planned.length, 1);
  const centre = (i: number) => (i + 0.5) * slot;

  const adherence = (session: SessionOutcome) =>
    Math.min(1.2, session.loggedSets / session.prescribedSets);

  const pct = { min: 0, max: 120 };
  const pctTicks = [0, 50, 100];
  const rpe = { min: 0, max: 10 };
  const rpeTicks = [0, 5, 10];

  const xTicks: Tick[] = tickIndexes(planned.length).map(
    (i): Tick => ({ pct: centre(i), label: shortDay(planned[i].day) }),
  );

  const skipped = planned.filter((session) => session.skipped).length;
  const gap = mean(
    planned.flatMap((session) =>
      session.reportedRpe !== null && session.targetRpe !== null
        ? [session.reportedRpe - session.targetRpe]
        : [],
    ),
  );

  const rowsFor = (session: SessionOutcome): SliceRow[] => [
    {
      label: "Sets",
      value: `${session.loggedSets} of ${session.prescribedSets}`,
    },
    ...(session.targetRpe === null
      ? []
      : [
          {
            label: "Target RPE",
            value: session.targetRpe.toFixed(1),
            color: SERIES[1],
          },
        ]),
    ...(session.reportedRpe === null
      ? []
      : [
          {
            label: "Reported RPE",
            value: session.reportedRpe.toFixed(1),
            color: SERIES[0],
          },
        ]),
  ];

  return (
    <ChartCard
      title="Adherence and effort"
      note="Sets completed against sets prescribed, and how hard the session actually felt against how hard it was meant to feel."
      aside={
        gap === null ? null : (
          <Tag tone={Math.abs(gap) >= 1 ? "warn" : "neutral"}>
            RPE {gap >= 0 ? "+" : ""}
            {gap.toFixed(1)} vs target
          </Tag>
        )
      }
    >
      {planned.length === 0 ? (
        <p className="text-xs text-ink-faint">
          Nothing prescribed yet. Once sessions are generated, this is where you
          find out whether they were calibrated to you.
        </p>
      ) : (
        <>
          <p className="mb-1.5 text-[11px] font-medium text-ink-muted">
            Sets completed, percent of prescribed
          </p>
          <Plot
            yTicks={pctTicks.map((t) => ({ pct: yPct(t, pct), label: `${t}` }))}
            xTicks={[]}
            height={96}
          >
            {/*
              A single series, so a neutral fill rather than a categorical hue,
              which is reserved for the two RPE lines below.
            */}
            <Columns
              color="var(--color-series-neutral)"
              bars={planned.map((session, i) => ({
                leftPct: i * slot,
                widthPct: slot,
                heightPct: (adherence(session) / 1.2) * 100,
                title: `${shortDay(session.day)}: ${session.loggedSets} of ${session.prescribedSets} sets`,
              }))}
            />
            <Slices
              slices={planned.map((session, i) => ({
                leftPct: i * slot,
                widthPct: slot,
                title: `${shortDay(session.day)} · ${sessionKindLabels.of(session.kind as SessionKind)}`,
                rows: rowsFor(session),
              }))}
            />
          </Plot>

          <p className="mt-4 mb-1.5 text-[11px] font-medium text-ink-muted">
            RPE, reported against target
          </p>
          <Plot
            yTicks={rpeTicks.map((t) => ({ pct: yPct(t, rpe), label: `${t}` }))}
            xTicks={xTicks}
            height={96}
          >
            <Lines
              series={[
                {
                  color: SERIES[1],
                  dashed: true,
                  path: linePath(
                    planned.map((session, i) =>
                      session.targetRpe === null
                        ? null
                        : { x: centre(i), y: yPct(session.targetRpe, rpe) },
                    ),
                  ),
                },
                {
                  color: SERIES[0],
                  path: linePath(
                    planned.map((session, i) =>
                      session.reportedRpe === null
                        ? null
                        : { x: centre(i), y: yPct(session.reportedRpe, rpe) },
                    ),
                  ),
                },
              ]}
            />

            {/*
              Markers only while they still mark something. A quarter's worth of
              sessions puts them closer together than the 8px dot is wide, so they
              merge into a caterpillar that hides the line they sit on; past that
              the line alone carries the shape and the hover readout carries the
              values.
            */}
            {planned.length > 30
              ? null
              : planned.map((session, i) =>
                  session.reportedRpe === null ? null : (
                    <Dot
                      key={session.id}
                      leftPct={centre(i)}
                      topPct={yPct(session.reportedRpe, rpe)}
                      color={SERIES[0]}
                    />
                  ),
                )}

            <Slices
              slices={planned.map((session, i) => ({
                leftPct: i * slot,
                widthPct: slot,
                title: `${shortDay(session.day)} · ${sessionKindLabels.of(session.kind as SessionKind)}`,
                rows: rowsFor(session),
              }))}
            />
          </Plot>

          <Legend
            items={[
              { label: "Reported RPE", color: SERIES[0] },
              { label: "Target RPE", color: SERIES[1], kind: "dash" },
            ]}
          />

          <p className="mt-3 text-xs text-ink-muted">
            {gap === null
              ? "No session has both a target and a reported RPE yet, so there is nothing to correct against."
              : Math.abs(gap) < 1
                ? `Sessions land ${Math.abs(gap).toFixed(1)} of an RPE point from target on average, which is within the noise of a self-reported rating.`
                : gap > 0
                  ? `Sessions run ${gap.toFixed(1)} RPE points harder than prescribed on average. That is the prescription being too heavy, not the training being done badly.`
                  : `Sessions run ${Math.abs(gap).toFixed(1)} RPE points easier than prescribed on average, so there is room to load them heavier.`}
            {skipped > 0
              ? ` ${skipped} of ${planned.length} were skipped outright.`
              : ""}
          </p>

          <TableView
            caption="Prescribed against completed sets, with target and reported RPE"
            columns={["Date", "Session", "Sets", "Target RPE", "Reported RPE"]}
            rows={planned
              .slice()
              .reverse()
              .map((session) => [
                shortDay(session.day),
                sessionKindLabels.of(session.kind as SessionKind) +
                  (session.skipped ? " (skipped)" : ""),
                `${session.loggedSets} / ${session.prescribedSets}`,
                session.targetRpe === null ? null : session.targetRpe.toFixed(1),
                session.reportedRpe === null ? null : session.reportedRpe.toFixed(1),
              ])}
          />
        </>
      )}
    </ChartCard>
  );
}
