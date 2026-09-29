import type { ReactNode } from "react";

/**
 * The chart primitives.
 *
 * Two decisions shape all of this. First, every mark is positioned as a
 * percentage of the plot box, so nothing needs to know how wide the chart is:
 * the browser resolves the geometry, which keeps these as server components with
 * no measuring pass, no layout shift, and no resize listener. Second, only the
 * data lines are SVG. Text, dots, bands and bars are ordinary elements, so text
 * is real pixels at every viewport instead of being scaled by a viewBox until it
 * is unreadable on a phone or oversized on a laptop.
 *
 * Hover is CSS, not state. A slice is a focusable element and its readout is a
 * child revealed on hover or focus, which makes the values reachable by keyboard
 * for free and keeps the whole page free of client JavaScript.
 */

export type Tick = { pct: number; label: string };

/** Series colours, in the fixed order the palette was validated in. */
export const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
] as const;

/**
 * The width of the y-axis gutter. Wide enough for four condensed digits at 12px and for
 * the widest unit label, which is `(× bw)`: a narrower gutter wraps that onto two
 * lines and pushes the first x tick off its own baseline.
 */
const GUTTER = "w-10";

/**
 * A tick label near the edge would hang off the plot, so the outermost ones are
 * pinned to the edge rather than centred on it. Near, not at: a week axis centres
 * its last label on the last bar, a few percent in, and a date is about a tenth of
 * a phone-width plot wide, so half of it still hangs over the card's padding.
 */
function edgeAlign(pct: number) {
  if (pct <= 6) return { left: "0%", transform: "none" };
  if (pct >= 94) return { left: "100%", transform: "translateX(-100%)" };
  return { left: `${pct}%`, transform: "translateX(-50%)" };
}

export function Plot({
  yTicks,
  xTicks,
  height = 176,
  children,
  unit,
  xLabel,
}: {
  yTicks: Tick[];
  xTicks: Tick[];
  /** Plot box height in pixels. The axis band is added below it, never inside. */
  height?: number;
  children: ReactNode;
  unit?: string;
  /**
   * What the x axis measures, for the chart whose x is not time. A date reads as
   * a date on its own; a bare 10, 15, 20 does not.
   */
  xLabel?: string;
}) {
  return (
    <div>
      <div className="flex">
        <div className={`${GUTTER} relative shrink-0`} style={{ height }}>
          {yTicks.map((tick) => (
            <span
              key={tick.pct}
              className="tnum absolute right-1.5 -translate-y-1/2 font-display text-[0.75rem] leading-none text-ink-faint"
              style={{ top: `${tick.pct}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {/* Hairline, solid, one step off the surface: present but recessive. */}
          {yTicks.map((tick) => (
            <div
              key={tick.pct}
              aria-hidden="true"
              className="absolute inset-x-0 h-px bg-line/70"
              style={{ top: `${tick.pct}%` }}
            />
          ))}
          {children}
        </div>
      </div>
      <div className="flex">
        <div className={`${GUTTER} shrink-0`}>
          {/*
            Parenthesised because it sits immediately left of the first x label,
            and "in 27 Apr" would otherwise read as one phrase rather than as a
            unit beside a date.
          */}
          {unit ? (
            <span className="block pt-1.5 pr-1.5 text-right font-display text-[0.75rem] leading-none whitespace-nowrap text-ink-faint">
              ({unit})
            </span>
          ) : null}
        </div>
        <div className="relative h-5 min-w-0 flex-1">
          {xTicks.map((tick) => (
            <span
              key={tick.label + tick.pct}
              className="absolute top-1.5 font-display text-[0.75rem] leading-none whitespace-nowrap text-ink-faint"
              style={edgeAlign(tick.pct)}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      {xLabel ? (
        <p className="mt-0.5 text-right font-display text-[0.75rem] leading-none text-ink-faint">
          {xLabel}
        </p>
      ) : null}
    </div>
  );
}

export type Band = {
  leftPct: number;
  widthPct: number;
  /** Always drawn: short enough to fit the narrowest band, so an ordinal. */
  label: string;
  /** Drawn instead of `label` when the band is wide enough for the words. */
  longLabel?: string;
  /** 1 to 3, the mesocycle's place in the accumulation to realization sequence. */
  step?: 1 | 2 | 3;
};

/**
 * The shaded, labelled blocks behind a performance line.
 *
 * This is the whole reason this chart exists rather than a plain line. Vertical
 * jump is expected to drop inside a hard accumulation block, so a line with no
 * blocks behind it invites exactly the wrong reaction to the most normal thing in
 * the training model. The shading is a neutral wash rather than a colour, both
 * because it is annotation and not data and because block type is a sequence, so
 * three steps of one gray say "more specific" where three hues would say
 * "unrelated".
 */
export function Bands({ bands }: { bands: Band[] }) {
  return (
    <>
      {bands.map((band, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`@container absolute inset-y-0 overflow-hidden border-l border-line/70 ${WASH[band.step ?? 1]}`}
          style={{ left: `${band.leftPct}%`, width: `${band.widthPct}%` }}
        >
          {/*
            Positioned inside the band and clipped by it, so a label can never
            spill across the boundary into its neighbour and read as belonging to
            the wrong block. Words only when the band is wide enough to hold them,
            which is a container query on the band itself rather than a guess from
            its percentage: at phone width a five-month season leaves about sixty
            pixels per block, which fits an ordinal and not "accumulation", while
            the same block on a laptop has room to spare. Where the words do not
            fit, the shading key under the chart says what each wash means.
          */}
          <span className="absolute top-1 left-1.5 font-display text-[0.75rem] leading-none whitespace-nowrap text-ink-faint">
            {band.longLabel ? (
              <>
                <span className="@[6.5rem]:hidden">{band.label}</span>
                <span className="hidden @[6.5rem]:inline">{band.longLabel}</span>
              </>
            ) : (
              band.label
            )}
          </span>
        </div>
      ))}
    </>
  );
}

/** The band washes, one gray stepped darker per step of the sequence. */
const WASH = { 1: "bg-ink/[0.035]", 2: "bg-ink/[0.06]", 3: "bg-ink/[0.09]" };

/**
 * What each band wash means, for the widths where a band only has room for its
 * ordinal. Drawn as the wash itself with the band's own boundary, so the key is
 * matched to the plot by eye rather than by a colour name.
 */
export function BandKey({
  items,
}: {
  items: { label: string; step: 1 | 2 | 3 }[];
}) {
  if (!items.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-1.5 text-xs text-ink-muted"
        >
          <span
            aria-hidden="true"
            className={`h-2.5 w-4 shrink-0 border-l border-line ${WASH[item.step]}`}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** The data lines. The only SVG here, so strokes stay 2px under any distortion. */
export function Lines({
  series,
}: {
  series: { path: string; color: string; dashed?: boolean }[];
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full overflow-visible"
    >
      {series.map((line, i) => (
        <path
          key={i}
          d={line.path}
          fill="none"
          stroke={line.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={line.dashed ? "4 4" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * A horizontal wash between two values, for the noise floor around a reading.
 *
 * Anything inside this band is not a change, it is two measurements of the same
 * number. Drawing it is what stops a two-centimetre wobble reading as progress
 * or as loss.
 */
export function Band({
  topPct,
  bottomPct,
  color,
  label,
}: {
  topPct: number;
  bottomPct: number;
  color: string;
  label?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0"
      style={{
        top: `${topPct}%`,
        height: `${Math.max(0, bottomPct - topPct)}%`,
        // 10% is the skill's area-fill wash: present, never a saturated block.
        backgroundColor: color,
        opacity: 0.1,
      }}
    >
      {label ? (
        <span className="absolute top-0.5 right-1.5 font-display text-[0.75rem] leading-none text-ink-faint opacity-100">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A data point, ringed in the surface colour so it survives an overlap.
 *
 * `small` is for a dense series, where a full-size ringed dot every thirty pixels
 * eats most of the line between them and several series read as dashed strokes.
 */
export function Dot({
  leftPct,
  topPct,
  color,
  small = false,
}: {
  leftPct: number;
  topPct: number;
  color: string;
  small?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-surface ${small ? "h-1.5 w-1.5 ring-1" : "h-2 w-2 ring-2"}`}
      style={{ left: `${leftPct}%`, top: `${topPct}%`, backgroundColor: color }}
    />
  );
}

/**
 * A value written on the chart next to the mark it belongs to.
 *
 * Selective by construction: this takes one point, not a series, so labelling
 * every dot would mean writing it out every time and it never happens by
 * accident.
 */
export function PointLabel({
  leftPct,
  topPct,
  children,
  align = "above",
}: {
  leftPct: number;
  topPct: number;
  children: ReactNode;
  /**
   * `above`, `below` and `left` centre on the mark. `above-left` is for the last
   * point of a line at the right edge: `left` would sit on the segment running
   * into the mark and be struck through by it, so it rises clear of it instead.
   * The `-start` pair hangs off a `leftPct` of 0, for a full-width reference line,
   * whose label has to clear the line rather than sit centred on it.
   */
  align?:
    | "above"
    | "below"
    | "left"
    | "above-left"
    | "above-start"
    | "below-start";
}) {
  const offset = {
    above: "-translate-x-1/2 -translate-y-full -mt-2.5",
    below: "-translate-x-1/2 mt-2.5",
    left: "-translate-x-full -translate-y-1/2 -ml-2.5",
    "above-left": "-translate-x-full -translate-y-full -mt-2 ml-1",
    "above-start": "-translate-y-full -mt-1.5",
    "below-start": "mt-1.5",
  }[align];
  return (
    <span
      /*
        A label sits on top of the lines it describes, so it carries a halo of the
        surface colour rather than a filled chip: it stays legible where it crosses
        a stroke without boxing off the part of the plot underneath it.
      */
      className={`tnum absolute font-display text-[0.75rem] leading-none font-medium whitespace-nowrap text-ink-muted [text-shadow:0_0_3px_var(--color-surface),0_0_3px_var(--color-surface),0_0_3px_var(--color-surface)] ${offset}`}
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
    >
      {children}
    </span>
  );
}

/**
 * An annotated point: a leader from the mark down to the plot floor, labelled
 * there.
 *
 * A label floated beside its own mark is legible only until another series happens
 * to run through the space it chose, and on a four-series chart something usually
 * does. Dropping it to the floor puts every annotation in the one strip of the plot
 * that holds no data, so the label is always readable and the leader is what says
 * which point it belongs to.
 */
export function Annotation({
  leftPct,
  topPct,
  children,
}: {
  leftPct: number;
  topPct: number;
  children: ReactNode;
}) {
  const place =
    leftPct <= 12
      ? "left-0"
      : leftPct >= 88
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  return (
    <div
      className="absolute bottom-0"
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0 border-l border-dashed border-ink-faint/60"
      />
      <span
        className={`tnum absolute bottom-0 mb-1 w-max font-display text-[0.75rem] leading-none font-medium whitespace-nowrap ${place}`}
      >
        {children}
      </span>
    </div>
  );
}

/** A column, capped in width and rounded only at the data end. */
export function Columns({
  bars,
  color,
}: {
  bars: { leftPct: number; widthPct: number; heightPct: number; title: string }[];
  color: string;
}) {
  return (
    <>
      {bars.map((bar, i) => (
        <div
          key={i}
          /*
            Full height, bottom-aligned, rather than a zero-height box pinned to
            the baseline: a percentage height resolves against the parent, so a
            wrapper with no height of its own collapses every bar to nothing.
          */
          className="absolute inset-y-0 flex flex-col justify-end"
          style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
        >
          {/*
            The gap between neighbours is a share of the slot rather than a fixed
            margin, and is the surface showing through rather than a stroke drawn
            around each bar. A fixed 2px each side leaves a two-pixel hairline
            once fifty sessions share a phone-width plot; a quarter of the slot
            keeps the bar the dominant mark at any density. The 1.5rem cap keeps a
            sparse chart airy instead of slabbed.
          */}
          <div
            title={bar.title}
            className="self-center rounded-t-[4px]"
            style={{
              width: "min(1.5rem, 76%)",
              height: `${bar.heightPct}%`,
              backgroundColor: color,
            }}
          />
        </div>
      ))}
    </>
  );
}

export type SliceRow = { label: string; value: string; color?: string };

/**
 * The hover layer: one full-height slice per x position, each with a readout.
 *
 * Slices tile the plot, so the hit target is the whole column rather than the
 * 8px dot, which is the difference between a chart you can read with a thumb and
 * one you cannot. Each slice is focusable, so the same readout appears on tab.
 */
export function Slices({
  slices,
}: {
  slices: { leftPct: number; widthPct: number; title: string; rows: SliceRow[] }[];
}) {
  return (
    <>
      {slices.map((slice, i) => {
        const centre = slice.leftPct + slice.widthPct / 2;
        // Pinned to whichever edge is nearer, so a readout never leaves the card.
        const place =
          centre < 30
            ? "left-0"
            : centre > 70
              ? "right-0"
              : "left-1/2 -translate-x-1/2";
        return (
          <div
            key={i}
            tabIndex={0}
            aria-label={`${slice.title}. ${slice.rows.map((r) => `${r.label} ${r.value}`).join(", ")}`}
            className="group absolute inset-y-0 cursor-default focus:outline-none"
            style={{ left: `${slice.leftPct}%`, width: `${slice.widthPct}%` }}
          >
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink-faint opacity-0 transition-opacity group-hover:opacity-60 group-focus:opacity-60"
            />
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-field border border-line bg-surface-raised px-2 py-1.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 ${place}`}
            >
              <p className="font-display text-[0.75rem] leading-none font-medium text-ink">
                {slice.title}
              </p>
              {slice.rows.map((row) => (
                <p
                  key={row.label}
                  className="mt-1 flex items-center gap-1.5 font-display text-[0.75rem] leading-none whitespace-nowrap text-ink-muted"
                >
                  {row.color ? (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                  ) : null}
                  {row.label}
                  <span className="tnum ml-auto pl-2 font-medium text-ink">
                    {row.value}
                  </span>
                </p>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * The legend. Present whenever there are two or more series, because colour
 * matching alone is not an identity channel. One series gets none: the heading
 * already says what is drawn, and a box with a single swatch just repeats it.
 */
export function Legend({
  items,
}: {
  items: { label: string; color: string; kind?: "line" | "dash" | "swatch" }[];
}) {
  if (items.length < 2) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-1.5 text-xs text-ink-muted"
        >
          {item.kind === "swatch" ? (
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
          ) : (
            <span
              className="h-0.5 w-4 shrink-0 rounded-full"
              style={
                item.kind === "dash"
                  ? {
                      backgroundImage: `repeating-linear-gradient(to right, ${item.color} 0 4px, transparent 4px 8px)`,
                    }
                  : { backgroundColor: item.color }
              }
            />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The table twin.
 *
 * Collapsed, but present on every chart: it is the version that survives a
 * screen reader, a printout and forced colours, and it is the reason a tooltip
 * is allowed to be the fastest way to read a value rather than the only way.
 */
export function TableView({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: (string | number | null)[][];
  caption: string;
}) {
  if (!rows.length) return null;
  return (
    <details className="group mt-3">
      {/*
        A 44px target in both directions. The word is only 37px wide, so the width
        comes from `min-w-11` rather than padding, which would push the caret out
        of line with the chart's left edge; the negative margin keeps the height
        off the layout.
      */}
      <summary className="-my-2 inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-1 text-xs text-ink-faint hover:text-ink-muted">
        <span className="transition-transform group-open:rotate-90">›</span>
        Table
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-field border border-line">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface-raised text-ink-muted">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-2.5 py-1.5 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-ink-muted">
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-line/70">
                {row.map((cell, j) => (
                  <td key={j} className={`px-2.5 py-1.5 ${j ? "tnum" : ""}`}>
                    {cell ?? "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** A chart's card: heading, one line of what to read from it, then the plot. */
export function ChartCard({
  title,
  note,
  aside,
  children,
}: {
  title: string;
  note?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-box bg-surface p-4 shadow-[inset_0_1px_0_oklch(100%_0_0/0.045)] sm:p-5">
      {/*
        Wrapping, and the aside kept whole. `Tag` is `whitespace-nowrap`, so as a
        shrinkable flex item it does not wrap or ellipsise when the row is tight - it
        clips its last letter against the card border, which is how a verdict like
        "Moving slower than asked" lost its "d" on a phone. `shrink-0` makes it
        break to its own line instead, and `ml-auto` keeps it right-aligned there.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h2 className="min-w-0 font-display text-xl leading-tight font-bold text-ink">{title}</h2>
        {aside ? <div className="ml-auto shrink-0">{aside}</div> : null}
      </div>
      {note ? <p className="mt-1.5 mb-5 max-w-prose text-sm text-ink-muted">{note}</p> : null}
      {children}
    </section>
  );
}
