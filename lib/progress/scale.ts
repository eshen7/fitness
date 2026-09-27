import { quadraticFit } from "@/lib/analytics/stats";

/**
 * The chart math, kept pure and separate from anything that draws.
 *
 * Everything here maps a value to a percentage of the plot box, because the marks
 * are positioned in percentages rather than pixels. That is what lets a chart be
 * a server component with no measuring step: the browser resolves the geometry,
 * so there is no width to know and nothing to re-render when the viewport
 * changes. It also means these functions are testable without a DOM.
 *
 * Y percentages are already flipped, so 0 is the top of the box, matching CSS.
 */

/** Whole days since the epoch for a plain `YYYY-MM-DD` day, UTC to stay stable. */
export function dayNumber(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function addDays(day: string, days: number) {
  const date = new Date((dayNumber(day) + days) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week a day falls in. Weeks are the unit contacts are counted in. */
export function weekStart(day: string) {
  // 1970-01-01 was a Thursday, so day 0 is weekday 3 counting Monday as 0.
  const offset = (((dayNumber(day) + 3) % 7) + 7) % 7;
  return addDays(day, -offset);
}

export type Extent = { min: number; max: number };

/** Where a value sits across an extent, 0 to 1, clamped. */
function fraction(value: number, extent: Extent) {
  const span = extent.max - extent.min;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (value - extent.min) / span));
}

/** Horizontal position as a percentage of the plot box. */
export function xPct(day: string, days: Extent) {
  return fraction(dayNumber(day), days) * 100;
}

/** Vertical position as a percentage from the top, so it drops straight into CSS. */
export function yPct(value: number, extent: Extent) {
  return (1 - fraction(value, extent)) * 100;
}

/**
 * A value extent rounded out to a readable step, with the ticks that go with it.
 *
 * Jump height never starts at zero: an axis from zero compresses the whole season
 * into the top inch of the box and hides exactly the changes worth seeing. Counts
 * do start at zero, because the length of the bar is the quantity. So which one
 * it is has to be said rather than inferred, and `zero` says it.
 */
export function niceExtent(
  values: number[],
  { zero = false, ticks = 4 }: { zero?: boolean; ticks?: number } = {},
): { extent: Extent; ticks: number[] } {
  const present = values.filter((v) => Number.isFinite(v));
  if (!present.length) {
    return { extent: { min: 0, max: 1 }, ticks: [0, 1] };
  }

  let lo = zero ? 0 : Math.min(...present);
  let hi = Math.max(...present);
  if (hi === lo) {
    // A single distinct value still needs a box to sit in the middle of.
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.1 : 1;
    lo = zero ? 0 : lo - pad;
    hi = hi + pad;
  } else if (!zero) {
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
  }

  const step = niceStep((hi - lo) / ticks);

  // A zero axis is snapped to the step at both ends, because the length of a bar
  // is the quantity and a bar should be able to reach the top of the box. A value
  // axis instead stays tight to its padded data and takes whichever round ticks
  // fall inside it: snapping the ends there only buys empty plot, up to a whole
  // step of it at each edge.
  const min = zero ? 0 : lo;
  const max = zero ? Math.ceil(hi / step) * step : hi;

  const out: number[] = [];
  // Accumulating by index rather than by repeated addition, so a step of 0.1 does
  // not drift into 0.30000000000000004 and print that on an axis.
  const first = Math.ceil(min / step - 1e-9);
  for (let i = first; i * step <= max + step / 1000; i++) {
    out.push(round(i * step, step));
  }
  return { extent: { min, max }, ticks: out };
}

/**
 * 1, 2, 2.5, or 5 times a power of ten: the steps that read as round numbers.
 *
 * Nearest, not next-larger. Rounding a rough step of 6.5 up to 10 does not just
 * coarsen the ticks, it drags the axis minimum down to the next multiple of the
 * bigger step: box heights of 12 to 28 inches end up on an axis starting at zero,
 * with the data crammed into the right half of a plot that is mostly empty.
 */
function niceStep(rough: number) {
  if (!(rough > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / magnitude;
  const factor = [1, 2, 2.5, 5, 10].reduce((best, candidate) =>
    Math.abs(candidate - scaled) < Math.abs(best - scaled) ? candidate : best,
  );
  return factor * magnitude;
}

function round(value: number, step: number) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(value.toFixed(decimals));
}

export type Point = { x: number; y: number };

/**
 * An SVG path through points already in percentage space.
 *
 * A gap in the data breaks the path rather than being bridged, because a
 * straight line across three missing weeks asserts a measurement that was never
 * taken. `null` in the input is that gap.
 */
export function linePath(points: (Point | null)[]) {
  let path = "";
  let pendingMove = true;
  for (const point of points) {
    if (!point) {
      pendingMove = true;
      continue;
    }
    const pair = `${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
    path += pendingMove ? `M${pair}` : `L${pair}`;
    pendingMove = false;
  }
  return path;
}

export function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation. Null below two values, where it has no meaning. */
export function stdDev(values: number[]) {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * The smallest change that is not just measurement noise.
 *
 * Pooled within-sitting standard deviation times 1.96 times root two: the
 * classic minimal detectable change. Drawn as a band around the last value, it
 * is the difference between "the dip is real" and "you jumped twice and got two
 * numbers", which is the single most common way a training chart is misread.
 */
export function minimalDetectableChange(sittings: number[][]) {
  const spreads = sittings
    .map((attempts) => stdDev(attempts))
    .filter((sd): sd is number => sd !== null);
  if (!spreads.length) return null;
  const pooled = Math.sqrt(
    spreads.reduce((sum, sd) => sum + sd * sd, 0) / spreads.length,
  );
  return pooled * 1.96 * Math.SQRT2;
}

/**
 * The vertex of a quadratic through (box height, jump height).
 *
 * This is the ebook's depth jump protocol as arithmetic: jump height rises with
 * drop height and then falls once the landing can no longer be absorbed, so the
 * turning point is the height to train at. Needs a downward-opening fit and a
 * peak inside the tested range, or there is no peak to report yet: a vertex past
 * the highest or below the lowest box is a height nobody tested, and the curve
 * out there is extrapolation rather than data.
 *
 * The fit itself is `lib/analytics/stats.ts`, which is the same arithmetic the
 * depth-jump insight runs. Sharing it is not only about the duplicate solver: the
 * card and the insight are two renderings of one claim, and a chart marking 45 cm
 * beside a statement naming 47 cm is worse than either of them alone.
 */
export function quadraticVertex(points: Point[]) {
  const fit = quadraticFit(points);
  if (!fit || fit.vertexX === null) return null;

  // In-range only, which `quadraticFit` deliberately leaves to its callers: the
  // insight wants the vertex even when it falls outside so it can say why it is
  // withholding, and the chart has nowhere to draw it.
  const xs = points.map((p) => p.x);
  if (fit.vertexX < Math.min(...xs) || fit.vertexX > Math.max(...xs)) return null;
  return { boxHeightCm: fit.vertexX, jumpCm: fit.at(fit.vertexX) };
}
