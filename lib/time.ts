import { addDays } from "@/lib/days";
import { env } from "@/lib/env";

export { formatDay } from "@/lib/days";

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
  return addDays(from, -days);
}

/** `14:32`, in the app's zone. */
export function formatTime(instant: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: env().APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}
