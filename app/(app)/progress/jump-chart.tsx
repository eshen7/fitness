import {
  Annotation,
  Band,
  BandKey,
  Bands,
  ChartCard,
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
import { Tag } from "@/components/ui";
import { measurementKindLabels, mesocycleTypeLabels } from "@/lib/labels";
import {
  blockAt,
  deepestDip,
  type BlockSpan,
  type Reading,
} from "@/lib/progress/annotate";
import type { BlockBand, JumpSitting } from "@/lib/progress/queries";
import {
  dayNumber,
  linePath,
  minimalDetectableChange,
  niceExtent,
  xPct,
  yPct,
} from "@/lib/progress/scale";
import { MESOCYCLE_TYPES, type TestKind, type UnitSystem } from "@/lib/taxonomy";
import { today } from "@/lib/time";
import { displayUnit, round1, toDisplay } from "@/lib/units";
import { dayTicks, shortDay } from "@/lib/progress/axis";

/**
 * The four vertical jump measurements, on shaded mesocycle blocks.
 *
 * Broad jump and depth jump are deliberately not here. Broad jump is two
 * hundred and fifty centimetres against a vertical's sixty, so putting them on one
 * axis would flatten the vertical line into a straight edge; depth jump has its
 * own card, because the question it answers is about drop height rather than about
 * progress over time.
 *
 * The series order is fixed, not derived from what happens to be in the data, so
 * the two-foot approach is the same colour in January as in June.
 */
const KINDS: TestKind[] = [
  "two_foot_approach_vertical",
  "standing_vertical",
  "one_foot_approach_left",
  "one_foot_approach_right",
];

export function JumpChart({
  sittings,
  blocks,
  unitSystem,
}: {
  sittings: JumpSitting[];
  blocks: BlockBand[];
  unitSystem: UnitSystem;
}) {
  const unit = displayUnit("length", unitSystem);
  const show = (cm: number) => round1(toDisplay(cm, "length", unitSystem));

  const relevant = sittings.filter((sitting) =>
    (KINDS as string[]).includes(sitting.kind),
  );
  const present = KINDS.filter((kind) =>
    relevant.some((sitting) => sitting.kind === kind),
  );

  const firstDay = relevant[0]?.day ?? blocks[0]?.startDay ?? today();
  const days = {
    min: dayNumber(blocks[0] && blocks[0].startDay < firstDay ? blocks[0].startDay : firstDay),
    max: dayNumber(today()),
  };
  const { extent, ticks } = niceExtent(relevant.map((s) => show(s.best)));

  // The primary series carries the annotations: it is the one the training is
  // for, and four sets of labels would be four times the ink for no more meaning.
  const primaryKind = present[0];
  const primary = relevant
    .filter((sitting) => sitting.kind === primaryKind)
    .map((sitting): Reading => ({ day: sitting.day, value: show(sitting.best) }));

  const spans: BlockSpan[] = blocks.map((block) => ({
    type: block.type,
    startDay: block.startDay,
    endDay: block.endDay,
    label: `Block ${block.ordinal} · ${mesocycleTypeLabels.of(block.type).toLowerCase()}`,
  }));

  const noiseFloor = minimalDetectableChange(
    relevant
      .filter((sitting) => sitting.kind === primaryKind)
      .map((sitting) => sitting.attempts.map(show)),
  );
  const dip = deepestDip(primary, spans, noiseFloor);
  const last = primary.at(-1) ?? null;

  const step = { accumulation: 1, transmutation: 2, realization: 3 } as const;

  // One slice per day that has a test, so hovering anywhere in the column reads
  // out every jump measured that day rather than needing the dot itself.
  const byDay = new Map<string, JumpSitting[]>();
  for (const sitting of relevant) {
    byDay.set(sitting.day, [...(byDay.get(sitting.day) ?? []), sitting]);
  }
  const sliceDays = [...byDay.keys()].sort();
  const sliceWidth = Math.max(6, 100 / Math.max(sliceDays.length, 1));

  const sliceRows = (day: string): SliceRow[] => {
    const block = blockAt(spans, day);
    return [
      ...(byDay.get(day) ?? []).map((sitting) => ({
        label: measurementKindLabels.of(sitting.kind),
        value: `${show(sitting.best)} ${unit}`,
        color: SERIES[KINDS.indexOf(sitting.kind)],
      })),
      // Which band the test fell in, so the ordinal drawn on the band has
      // somewhere to resolve to at a width that has no room for the words.
      ...(block ? [{ label: "Block", value: block.label }] : []),
    ];
  };

  const xTicks: Tick[] = dayTicks(days).map((day) => ({
    pct: xPct(day, days),
    label: shortDay(day),
  }));

  return (
    <ChartCard
      title="Vertical jump"
      note="Blocks are shaded and named. Jump height is expected to fall inside a hard block and to come back above it after the back-off, so a dip mid-block is the plan working rather than failing."
      aside={
        noiseFloor === null ? null : (
          <Tag>±{round1(noiseFloor)} {unit} noise</Tag>
        )
      }
    >
      {relevant.length === 0 ? (
        <p className="text-xs text-ink-faint">
          No jumps tested yet. A standing vertical is the reference every other
          number here is read against.
        </p>
      ) : (
        <>
          <Plot yTicks={ticks.map((t) => ({ pct: yPct(t, extent), label: String(t) }))} xTicks={xTicks} unit={unit} height={200}>
            <Bands
              bands={blocks.map((block) => ({
                leftPct: xPct(block.startDay, days),
                widthPct:
                  xPct(block.endDay, days) - xPct(block.startDay, days),
                label: String(block.ordinal),
                longLabel: `${block.ordinal} · ${mesocycleTypeLabels.of(block.type).toLowerCase()}`,
                step: step[block.type],
              }))}
            />

            {/*
              The noise floor around the latest reading. Anything inside this band
              is the same jump measured twice, which is most of what a week to week
              wobble is.
            */}
            {last && noiseFloor !== null ? (
              <Band
                topPct={yPct(last.value + noiseFloor, extent)}
                bottomPct={yPct(last.value - noiseFloor, extent)}
                color={SERIES[KINDS.indexOf(primaryKind)]}
              />
            ) : null}

            <Lines
              series={present.map((kind) => ({
                color: SERIES[KINDS.indexOf(kind)],
                path: linePath(
                  relevant
                    .filter((sitting) => sitting.kind === kind)
                    .map((sitting) => ({
                      x: xPct(sitting.day, days),
                      y: yPct(show(sitting.best), extent),
                    })),
                ),
              }))}
            />

            {present.map((kind) =>
              relevant
                .filter((sitting) => sitting.kind === kind)
                .map((sitting) => (
                  <Dot
                    key={`${kind}-${sitting.testGroup}`}
                    leftPct={xPct(sitting.day, days)}
                    topPct={yPct(show(sitting.best), extent)}
                    color={SERIES[KINDS.indexOf(kind)]}
                  />
                )),
            )}

            {/*
              Two labels, no more: where the primary series is now, and the dip
              worth explaining. A number on every dot would be unreadable and the
              tooltip and the table already carry the rest.
            */}
            {last ? (
              <PointLabel
                leftPct={xPct(last.day, days)}
                topPct={yPct(last.value, extent)}
                align={xPct(last.day, days) > 88 ? "left" : "above"}
              >
                {last.value} {unit}
              </PointLabel>
            ) : null}

            {dip && dip.reading !== last ? (
              <Annotation
                leftPct={xPct(dip.reading.day, days)}
                topPct={yPct(dip.reading.value, extent)}
              >
                {/*
                  Short, because the sentence under the chart carries the whole
                  explanation. Faint when the dip landed where the plan puts one,
                  because then it is a caption and not a warning.
                */}
                <span className={dip.expected ? "text-ink-faint" : "text-warn"}>
                  -{round1(dip.drop)} {unit}
                  {dip.expected ? ", expected" : ", unexpected"}
                </span>
              </Annotation>
            ) : null}

            <Slices
              slices={sliceDays.map((day) => ({
                leftPct: Math.max(0, xPct(day, days) - sliceWidth / 2),
                widthPct: sliceWidth,
                title: shortDay(day),
                rows: sliceRows(day),
              }))}
            />
          </Plot>

          <Legend
            items={present.map((kind) => ({
              label: measurementKindLabels.of(kind),
              color: SERIES[KINDS.indexOf(kind)],
            }))}
          />

          <BandKey
            items={MESOCYCLE_TYPES.filter((type) =>
              blocks.some((block) => block.type === type),
            ).map((type) => ({
              label: mesocycleTypeLabels.of(type),
              step: step[type],
            }))}
          />

          {dip ? (
            <p className="mt-3 text-xs text-ink-muted">
              {dip.expected
                ? `The ${round1(dip.drop)} ${unit} drop on ${shortDay(dip.reading.day)} landed inside ${dip.block.label.toLowerCase()}, where it is the expected outcome of the load rather than a loss of ability. Judge the block by where the jump sits after the back-off.`
                : `The ${round1(dip.drop)} ${unit} drop on ${shortDay(dip.reading.day)} landed inside ${dip.block.label.toLowerCase()}, which is a block meant to realize form rather than build it. That one is worth a look at contacts and recovery.`}
            </p>
          ) : null}

          <TableView
            caption="Every jump test, best attempt, with the block it fell in"
            columns={["Date", "Test", `Best (${unit})`, "Attempts", "Block"]}
            rows={relevant
              .slice()
              .reverse()
              .map((sitting) => [
                shortDay(sitting.day),
                measurementKindLabels.of(sitting.kind),
                show(sitting.best),
                sitting.attempts.map(show).join(", "),
                blockAt(spans, sitting.day)?.label ?? null,
              ])}
          />
        </>
      )}
    </ChartCard>
  );
}
