/**
 * Pure arithmetic on `YYYY-MM-DD` day keys.
 *
 * Split from `lib/time.ts`, which reads the environment for the app's zone, so
 * that pure modules such as the rule engine can reason about training days
 * without importing configuration. A day key is already a calendar day, so none
 * of this needs a zone: every instant is anchored at UTC noon, which keeps the
 * arithmetic clear of any DST boundary.
 */

function noon(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

/** Human day label: `Sun 13 Sept`. Weekday first, because that is what is scanned. */
export function formatDay(day: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(noon(day)));
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: string, to: string) {
  return Math.round((noon(to) - noon(from)) / 86_400_000);
}

/** The day key `days` after `day`. Negative counts back. */
export function addDays(day: string, days: number) {
  const at = new Date(noon(day));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
