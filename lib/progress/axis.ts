/**
 * Axis label formatting.
 *
 * Separate from `lib/time` because that module reads the environment and is
 * therefore server-only, while these are pure string formatters over a day key.
 * Axis labels are also deliberately shorter than the labels used in prose: a tick
 * is read in a glance next to four others, so the weekday is dropped and the year
 * only appears when the window actually crosses one.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `13 Sep`, from a `YYYY-MM-DD` day key. */
export function shortDay(day: string) {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** `wk 13 Sep`, for a week bucket keyed by its Monday. */
export function shortWeek(week: string) {
  return `wk ${shortDay(week)}`;
}

/**
 * Which of `count` evenly spaced buckets get a label, always including the last.
 *
 * The last bucket is the one being read, so it is always labelled. Stepping from
 * the front and then adding it is what puts two dates on top of each other at the
 * right edge whenever the count does not divide evenly, so a label that the final
 * one would crowd is dropped rather than drawn under it.
 */
export function tickIndexes(count: number, wanted = 4) {
  if (count <= 1) return count ? [0] : [];
  const every = Math.max(1, Math.ceil(count / wanted));
  const out: number[] = [];
  for (let i = 0; i < count; i += every) out.push(i);
  const last = count - 1;
  if (out.at(-1) !== last) {
    if (last - out[out.length - 1] < every / 2) out.pop();
    out.push(last);
  }
  return out;
}

/**
 * Three to five evenly spaced days across a window, as day keys.
 *
 * Dates are wide, so a label per reading would overlap into a gray smear at phone
 * width. The hover readout carries the exact day for any point, which is what
 * makes it safe for the axis to be this sparse.
 */
export function dayTicks({ min, max }: { min: number; max: number }) {
  const span = max - min;
  const count = span > 120 ? 5 : span > 40 ? 4 : 3;
  return Array.from({ length: count }, (_, i) =>
    new Date(Math.round(min + (span * i) / (count - 1)) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
}
