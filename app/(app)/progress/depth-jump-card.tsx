import {
  ChartCard,
  Dot,
  Legend,
  Lines,
  Plot,
  PointLabel,
  SERIES,
  Slices,
  TableView,
  type Tick,
} from "@/components/chart";
import { Tag } from "@/components/ui";
import { niceExtent, quadraticVertex, yPct } from "@/lib/progress/scale";
import type { UnitSystem } from "@/lib/taxonomy";
import { displayUnit, round1, toDisplay } from "@/lib/units";
import { shortDay } from "@/lib/progress/axis";

type Reading = { boxHeightCm: number; jumpCm: number; day: string };

/**
 * Depth jump calibration: box height against the vertical it produced.
 *
 * The ebook's protocol as a chart. Start low, raise the box, and the height to
 * train at is where the measured vertical still matches the standing jump; go
 * higher and the landing can no longer be absorbed, so the jump falls and the drill
 * stops being a drill. The standing vertical is therefore drawn as the reference
 * line, because without it a rising curve says nothing about which height to use.
 *
 * The x axis is box height, not time. This is the one chart here that is not a time
 * series, which is why it does not share the others' axis helpers.
 */
export function DepthJumpCard({
  standingCm,
  points,
  unitSystem,
}: {
  standingCm: number | null;
  points: Reading[];
  unitSystem: UnitSystem;
}) {
  const unit = displayUnit("length", unitSystem);
  const show = (cm: number) => round1(toDisplay(cm, "length", unitSystem));

  const heights = points.map((point) => show(point.boxHeightCm));
  const jumps = points.map((point) => show(point.jumpCm));
  const xExtent = niceExtent(heights, { ticks: 3 });
  const { extent, ticks } = niceExtent(
    standingCm === null ? jumps : [...jumps, show(standingCm)],
  );

  const xPos = (heightCm: number) => {
    const span = xExtent.extent.max - xExtent.extent.min;
    if (span <= 0) return 50;
    return ((show(heightCm) - xExtent.extent.min) / span) * 100;
  };

  // Fitted in display units so the reported height is the one that gets written on
  // a box, rather than a centimetre value converted after the fact.
  const vertex = quadraticVertex(
    points.map((point) => ({ x: show(point.boxHeightCm), y: show(point.jumpCm) })),
  );

  // The protocol's actual answer: the highest box that still matches the standing
  // jump. The fitted vertex is the smooth version of the same question and is shown
  // beside it, but the measured height is what gets trained at.
  const matched =
    standingCm === null
      ? null
      : points
          .filter((point) => point.jumpCm >= standingCm)
          .sort((a, b) => b.boxHeightCm - a.boxHeightCm)[0] ?? null;

  const xTicks: Tick[] = xExtent.ticks.map((height) => ({
    pct: ((height - xExtent.extent.min) / Math.max(1e-9, xExtent.extent.max - xExtent.extent.min)) * 100,
    label: String(height),
  }));

  const sliceWidth = Math.max(8, 100 / Math.max(points.length, 1));

  return (
    <ChartCard
      title="Depth jump calibration"
      note="Raise the box until the measured vertical drops below the standing jump. The height to train at is the last one that still matched it."
      aside={
        matched ? (
          <Tag tone="accent">Train at {show(matched.boxHeightCm)} {unit}</Tag>
        ) : points.length ? (
          <Tag>Not calibrated</Tag>
        ) : null
      }
    >
      {points.length < 2 ? (
        <p className="text-xs text-ink-faint">
          {points.length === 0
            ? "No depth jumps recorded. Test a standing vertical first, then drop from a low box and measure again."
            : "One height recorded. The protocol needs a few, raised progressively, before there is a curve to read."}
        </p>
      ) : (
        <>
          <Plot
            yTicks={ticks.map((t) => ({ pct: yPct(t, extent), label: String(t) }))}
            xTicks={xTicks}
            unit={unit}
            xLabel={`box height (${unit})`}
            height={168}
          >
            {/*
              The standing vertical, dashed and full width: it is a reference rather
              than a series measured at each box height, and dashing is what says so.
            */}
            {standingCm === null ? null : (
              <>
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 h-0 border-t-2 border-dashed border-cool/70"
                  style={{ top: `${yPct(show(standingCm), extent)}%` }}
                />
                {/*
                  Off the left edge and clear of the line, not centred on it: a
                  dashed rule drawn through the middle of its own label is the one
                  place on this chart where two marks are guaranteed to collide.
                  Below the line when the reference sits near the top of the plot,
                  which is where a well-calibrated set of readings puts it.
                */}
                <PointLabel
                  leftPct={0}
                  topPct={yPct(show(standingCm), extent)}
                  align={
                    yPct(show(standingCm), extent) < 25
                      ? "below-start"
                      : "above-start"
                  }
                >
                  standing {show(standingCm)} {unit}
                </PointLabel>
              </>
            )}

            <Lines
              series={[
                {
                  color: SERIES[0],
                  path: points
                    .map(
                      (point, i) =>
                        `${i ? "L" : "M"}${xPos(point.boxHeightCm).toFixed(3)} ${yPct(show(point.jumpCm), extent).toFixed(3)}`,
                    )
                    .join(""),
                },
              ]}
            />

            {points.map((point) => (
              <Dot
                key={point.boxHeightCm}
                leftPct={xPos(point.boxHeightCm)}
                topPct={yPct(show(point.jumpCm), extent)}
                color={SERIES[0]}
              />
            ))}

            {matched ? (
              <PointLabel
                leftPct={xPos(matched.boxHeightCm)}
                topPct={yPct(show(matched.jumpCm), extent)}
                align={xPos(matched.boxHeightCm) > 85 ? "left" : "above"}
              >
                <span className="text-accent">
                  {show(matched.boxHeightCm)} {unit} box
                </span>
              </PointLabel>
            ) : null}

            <Slices
              slices={points.map((point) => ({
                leftPct: Math.max(0, xPos(point.boxHeightCm) - sliceWidth / 2),
                widthPct: sliceWidth,
                title: `${show(point.boxHeightCm)} ${unit} box`,
                rows: [
                  {
                    label: "Vertical",
                    value: `${show(point.jumpCm)} ${unit}`,
                    color: SERIES[0],
                  },
                  { label: "Tested", value: shortDay(point.day) },
                ],
              }))}
            />
          </Plot>

          <Legend
            items={[
              { label: "Depth jump vertical", color: SERIES[0] },
              ...(standingCm === null
                ? []
                : [
                    {
                      label: "Standing vertical",
                      color: "var(--color-cool)",
                      kind: "dash" as const,
                    },
                  ]),
            ]}
          />

          <p className="mt-3 text-xs text-ink-muted">
            {standingCm === null
              ? "Without a standing vertical there is nothing to compare these against, so the protocol cannot name a height yet."
              : matched
                ? `${show(matched.boxHeightCm)} ${unit} is the highest box that still produced a vertical at or above the standing jump, so that is the working height.`
                : `Every box tested produced a lower vertical than the standing jump, which means the lowest of them is already too high. Drop back below ${show(points[0].boxHeightCm)} ${unit}.`}
            {vertex
              ? ` A quadratic through the readings peaks at ${round1(vertex.boxHeightCm)} ${unit}, which is the same question asked smoothly.`
              : ""}
          </p>

          <TableView
            caption="Best depth jump vertical at each box height"
            columns={[`Box (${unit})`, `Vertical (${unit})`, "Tested"]}
            rows={points.map((point) => [
              show(point.boxHeightCm),
              show(point.jumpCm),
              shortDay(point.day),
            ])}
          />
        </>
      )}
    </ChartCard>
  );
}
