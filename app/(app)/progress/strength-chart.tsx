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
import type { StrengthPoint } from "@/lib/progress/queries";
import { dayNumber, linePath, niceExtent, xPct, yPct } from "@/lib/progress/scale";
import type { UnitSystem } from "@/lib/taxonomy";
import { today } from "@/lib/time";
import { displayUnit, round1, toDisplay } from "@/lib/units";
import { dayTicks, shortDay } from "@/lib/progress/axis";

/**
 * Relative strength: 1RM over trend bodyweight, per lift.
 *
 * The ebook is explicit that relative strength predicts jumping and absolute
 * strength does not, so the ratio is what gets the axis and the kilograms live in
 * the hover readout. Which means a bulk that adds load and bodyweight in equal
 * proportion draws a flat line here, and that flat line is the honest answer.
 *
 * At most four lifts are drawn, because a fifth would need either a fifth hue or a
 * recycled one, and a recycled hue makes two different lifts look like one series.
 * The rest are still in the table.
 */
const MAX_LIFTS = 4;

export function StrengthChart({
  points,
  unitSystem,
}: {
  points: StrengthPoint[];
  unitSystem: UnitSystem;
}) {
  const massUnit = displayUnit("mass", unitSystem);
  const showMass = (kg: number) => round1(toDisplay(kg, "mass", unitSystem));

  const usable = points.filter(
    (point): point is StrengthPoint & { relative: number } =>
      point.relative !== null,
  );

  // Ranked by how many readings each lift has, so the lifts that are actually
  // tracked get the four slots rather than whichever was tested first.
  const counts = new Map<number, { name: string; count: number }>();
  for (const point of usable) {
    const entry = counts.get(point.exerciseId);
    if (entry) entry.count += 1;
    else counts.set(point.exerciseId, { name: point.exerciseName, count: 1 });
  }
  const drawn = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name))
    .slice(0, MAX_LIFTS)
    .map(([id, entry]) => ({ id, name: entry.name }));

  const inChart = usable.filter((point) =>
    drawn.some((lift) => lift.id === point.exerciseId),
  );

  const days = {
    min: dayNumber(inChart[0]?.day ?? today()),
    max: dayNumber(today()),
  };
  const { extent, ticks } = niceExtent(inChart.map((point) => point.relative));

  const xTicks: Tick[] = dayTicks(days).map((day) => ({
    pct: xPct(day, days),
    label: shortDay(day),
  }));

  const byDay = new Map<string, typeof inChart>();
  for (const point of inChart) {
    byDay.set(point.day, [...(byDay.get(point.day) ?? []), point]);
  }
  const sliceDays = [...byDay.keys()].sort();
  const sliceWidth = Math.max(6, 100 / Math.max(sliceDays.length, 1));

  const seriesOf = (id: number) => inChart.filter((point) => point.exerciseId === id);
  const leader = drawn[0] ? seriesOf(drawn[0].id).at(-1) : undefined;

  return (
    <ChartCard
      title="Relative strength"
      note="1RM over smoothed bodyweight, estimated from heavy sets or tested. This is the ratio that predicts jumping, so a lift that grew only as fast as bodyweight reads flat here on purpose."
    >
      {inChart.length === 0 ? (
        <p className="text-xs text-ink-faint">
          Needs a 1RM and a bodyweight. Log a heavy set of a strength lift, 1 to
          10 reps with a load, or enter a tested max on its library page, then a
          morning weight, and both halves of the ratio exist.
        </p>
      ) : (
        <>
          <Plot
            yTicks={ticks.map((t) => ({ pct: yPct(t, extent), label: t.toFixed(1) }))}
            xTicks={xTicks}
            unit="× bw"
            height={176}
          >
            <Lines
              series={drawn.map((lift, i) => ({
                color: SERIES[i],
                path: linePath(
                  seriesOf(lift.id).map((point) => ({
                    x: xPct(point.day, days),
                    y: yPct(point.relative, extent),
                  })),
                ),
              }))}
            />

            {drawn.map((lift, i) =>
              seriesOf(lift.id).map((point) => (
                <Dot
                  key={`${lift.id}-${point.day}`}
                  leftPct={xPct(point.day, days)}
                  topPct={yPct(point.relative, extent)}
                  color={SERIES[i]}
                />
              )),
            )}

            {leader ? (
              <PointLabel
                leftPct={xPct(leader.day, days)}
                topPct={yPct(leader.relative, extent)}
                align={xPct(leader.day, days) > 88 ? "above-left" : "above"}
              >
                {leader.relative.toFixed(2)}×
              </PointLabel>
            ) : null}

            <Slices
              slices={sliceDays.map((day) => ({
                leftPct: Math.max(0, xPct(day, days) - sliceWidth / 2),
                widthPct: sliceWidth,
                title: shortDay(day),
                rows: (byDay.get(day) ?? []).map((point) => ({
                  label: point.exerciseName,
                  value: `${point.relative.toFixed(2)}× · ${showMass(point.oneRmKg)} ${massUnit}${point.source === "tested" ? ", tested" : ""}`,
                  color: SERIES[drawn.findIndex((lift) => lift.id === point.exerciseId)],
                })),
              }))}
            />
          </Plot>

          <Legend
            items={drawn.map((lift, i) => ({ label: lift.name, color: SERIES[i] }))}
          />

          {counts.size > drawn.length ? (
            <p className="mt-3 text-xs text-ink-faint">
              {counts.size - drawn.length} other{" "}
              {counts.size - drawn.length === 1 ? "lift is" : "lifts are"} in the
              table below but not drawn, so no two lines share a colour.
            </p>
          ) : null}

          <TableView
            caption="1RM and the ratio to trend bodyweight, per lift"
            columns={["Date", "Lift", `1RM (${massUnit})`, "× bodyweight"]}
            rows={usable
              .slice()
              .reverse()
              .map((point) => [
                shortDay(point.day),
                point.exerciseName,
                `${showMass(point.oneRmKg)}${point.source === "tested" ? " tested" : ""}`,
                point.relative.toFixed(2),
              ])}
          />
        </>
      )}
    </ChartCard>
  );
}
