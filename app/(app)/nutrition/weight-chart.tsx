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
import type { WeightView } from "@/lib/nutrition/queries";
import { RATE_TOLERANCE_PCT, type RateVerdict } from "@/lib/nutrition/trend";
import { dayTicks, shortDay } from "@/lib/progress/axis";
import { dayNumber, linePath, niceExtent, xPct, yPct } from "@/lib/progress/scale";
import type { UnitSystem } from "@/lib/taxonomy";
import { displayUnit, round1, toDisplay } from "@/lib/units";

/**
 * Bodyweight against the rate the target asked for.
 *
 * Three marks with three jobs. The dots are the mornings, and they are noise: a kilo
 * of it, day to day, which is why nothing is read off them. The solid line is the
 * smoothed trend and is the only thing the measured rate is fitted to. The dashed
 * line is what the target implies, compounded weekly from the day it took effect, so
 * the gap between the two lines is the whole question this chart answers.
 *
 * The verdict is a tolerance rather than a comparison, because a quarter percent a
 * week is under 200 g on an 80 kg athlete and no bathroom scale resolves that inside
 * three weeks. `on-target` is the common case and is styled as one.
 */
const TREND_COLOR = SERIES[0];
const TARGET_COLOR = SERIES[2];
const READING_COLOR = "var(--color-series-neutral)";

export function WeightChart({
  weight,
  unitSystem,
  day,
}: {
  weight: WeightView;
  unitSystem: UnitSystem;
  day: string;
}) {
  const massUnit = displayUnit("mass", unitSystem);
  const show = (kg: number) => round1(toDisplay(kg, "mass", unitSystem));

  const { readings, trend, path } = weight;

  if (readings.length === 0) {
    return (
      <ChartCard
        title="Bodyweight against target"
        note="Relative strength is what predicts jumping, so bodyweight is half of the ratio the whole programme is aimed at."
      >
        <p className="text-xs text-ink-faint">
          No weigh-ins in the last ninety days. Log a morning weight and the trend,
          the target path and the rate between them all follow from it.
        </p>
      </ChartCard>
    );
  }

  const from = [readings[0].day, path[0]?.day ?? readings[0].day].sort()[0];
  const days = { min: dayNumber(from), max: dayNumber(day) };
  const { extent, ticks } = niceExtent([
    ...readings.map((point) => show(point.kg)),
    ...trend.map((point) => show(point.kg)),
    ...path.map((point) => show(point.kg)),
  ]);

  const xTicks: Tick[] = dayTicks(days).map((tick) => ({
    pct: xPct(tick, days),
    label: shortDay(tick),
  }));

  /**
   * The last value on a day. Readings and the trend run point for point, so both
   * have every day the slices are built from; the target path starts on the day the
   * target took effect and is absent before it, which is why this can be null.
   */
  const lastOn = (series: readonly { day: string; kg: number }[]) => {
    const byDay = new Map<string, number>();
    for (const point of series) byDay.set(point.day, point.kg);
    return byDay;
  };
  const morning = lastOn(readings);
  const smoothed = lastOn(trend);
  const goal = lastOn(path);

  const readingDays = [...morning.keys()].sort();
  const sliceWidth = Math.max(4, 100 / Math.max(readingDays.length, 1));
  const lastTrend = trend.at(-1);

  /**
   * A target set today is one point, and one point strokes nothing. Drawn and named
   * in the legend only once it is a line, so the legend never promises a mark that is
   * not on the chart; the readout above and the table below still carry the target.
   */
  const hasTargetLine = path.length > 1;

  return (
    <ChartCard
      title="Bodyweight against target"
      note={
        hasTargetLine
          ? "Dots are mornings, the solid line is the trend they smooth to, and the dashed line is what the target asked for."
          : "Dots are mornings and the solid line is the trend they smooth to. The target path appears once the target has been in force for more than a day."
      }
      aside={
        // `unknown` covers both halves being missing, and they read differently: no
        // target is a decision not yet made, too few weigh-ins is a measurement not
        // yet possible, and telling the owner the wrong one sends them to fix the
        // wrong thing.
        weight.targetPct === null && weight.measuredPct !== null ? (
          <Tag tone="warn">No target set</Tag>
        ) : (
          <Tag tone={verdictTone(weight.verdict)}>{verdictWords(weight.verdict)}</Tag>
        )
      }
    >
      {/*
        A sentence, so `tnum` goes on the figures rather than on the paragraph: the
        utility carries `white-space: nowrap`, which is right for a readout and turns
        a sentence into one long line that runs off the side of the card.
      */}
      <p className="mb-4 text-xs text-ink-muted">
        {weight.measuredPct === null ? (
          <>Needs four weigh-ins in three weeks before a rate means anything.</>
        ) : (
          <>
            Measured{" "}
            <span className="tnum font-medium text-ink">
              {signed(weight.measuredPct)}%
            </span>{" "}
            a week
            {weight.targetPct === null ? (
              <>, against no target.</>
            ) : (
              <>
                {" "}
                against a target of{" "}
                <span className="tnum font-medium text-ink">
                  {signed(weight.targetPct)}%
                </span>
                , within <span className="tnum">{RATE_TOLERANCE_PCT}%</span> either way
                counting as the same rate.
              </>
            )}
          </>
        )}
      </p>

      <Plot yTicks={ticks.map((t) => ({ pct: yPct(t, extent), label: String(t) }))} xTicks={xTicks} unit={massUnit}>
        <Lines
          series={[
            ...(hasTargetLine
              ? [
                  {
                    color: TARGET_COLOR,
                    dashed: true,
                    path: linePath(
                      path.map((point) => ({
                        x: xPct(point.day, days),
                        y: yPct(show(point.kg), extent),
                      })),
                    ),
                  },
                ]
              : []),
            {
              color: TREND_COLOR,
              path: linePath(
                trend.map((point) => ({
                  x: xPct(point.day, days),
                  y: yPct(show(point.kg), extent),
                })),
              ),
            },
          ]}
        />

        {readings.map((point, i) => (
          <Dot
            key={`${point.day}-${i}`}
            leftPct={xPct(point.day, days)}
            topPct={yPct(show(point.kg), extent)}
            color={READING_COLOR}
            small
          />
        ))}

        {lastTrend ? (
          <PointLabel
            leftPct={xPct(lastTrend.day, days)}
            topPct={yPct(show(lastTrend.kg), extent)}
            align={xPct(lastTrend.day, days) > 88 ? "above-left" : "above"}
          >
            {show(lastTrend.kg)} {massUnit}
          </PointLabel>
        ) : null}

        <Slices
          slices={readingDays.map((on) => ({
            leftPct: Math.max(0, xPct(on, days) - sliceWidth / 2),
            widthPct: sliceWidth,
            title: shortDay(on),
            rows: [
              ...cell("Morning", morning.get(on), READING_COLOR, show, massUnit),
              ...cell("Trend", smoothed.get(on), TREND_COLOR, show, massUnit),
              ...cell("Target", goal.get(on), TARGET_COLOR, show, massUnit),
            ],
          }))}
        />
      </Plot>

      <Legend
        items={[
          { label: "Morning reading", color: READING_COLOR, kind: "swatch" },
          { label: "Trend", color: TREND_COLOR, kind: "line" },
          ...(hasTargetLine
            ? [{ label: "Target path", color: TARGET_COLOR, kind: "dash" as const }]
            : []),
        ]}
      />

      <TableView
        caption="Morning bodyweight, the smoothed trend, and the weight the target implies"
        columns={["Date", `Morning (${massUnit})`, `Trend (${massUnit})`, `Target (${massUnit})`]}
        rows={readingDays
          .slice()
          .reverse()
          .map((on) => {
            const reading = morning.get(on);
            const smooth = smoothed.get(on);
            const target = goal.get(on);
            return [
              shortDay(on),
              reading === undefined ? null : show(reading),
              smooth === undefined ? null : show(smooth),
              target === undefined ? null : show(target),
            ];
          })}
      />
    </ChartCard>
  );
}

/** A readout row, or nothing at all when that series has no value on the day. */
function cell(
  label: string,
  kg: number | undefined,
  color: string,
  show: (kg: number) => number,
  massUnit: string,
) {
  if (kg === undefined) return [];
  return [{ label, value: `${show(kg)} ${massUnit}`, color }];
}

function signed(pct: number) {
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}`;
}

function verdictWords(verdict: RateVerdict) {
  return {
    "on-target": "On target",
    faster: "Faster than asked",
    slower: "Slower than asked",
    unknown: "Too few weigh-ins",
  }[verdict];
}

function verdictTone(verdict: RateVerdict) {
  if (verdict === "on-target") return "accent" as const;
  if (verdict === "unknown") return "neutral" as const;
  return "warn" as const;
}
