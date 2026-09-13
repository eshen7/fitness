import { env } from "@/lib/env";

/**
 * Dates in the training day's own zone.
 *
 * A `date` column here means a training day, not a UTC instant. Deriving it from
 * the server's clock would put an 11pm session on tomorrow whenever the app runs
 * anywhere east of the owner, and Vercel runs in UTC, so the zone is explicit.
 *
 * This module reads the environment, which makes it server-only.
 */

/** `2026-09-13` for the given instant, in the app's zone. */
export function dayOf(instant: Date = new Date()) {
  // `en-CA` formats as ISO, which avoids assembling the string from parts.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env().APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Today as a `YYYY-MM-DD` day key. */
export function today() {
  return dayOf();
}

/** `days` before the given day, as a day key. Negative counts forward. */
export function dayMinus(days: number, from = today()) {
  const [y, m, d] = from.split("-").map(Number);
  // Anchored at UTC noon so the arithmetic cannot cross a boundary on a DST day.
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
}

/** Human day label: `Sun 13 Sep`. Weekday first, because that is what is scanned. */
export function formatDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** `14:32`, in the app's zone. */
export function formatTime(instant: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: env().APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}
