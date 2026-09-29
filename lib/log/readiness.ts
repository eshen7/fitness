/**
 * What the check-in's "Prior session RPE" field starts from.
 *
 * A saved check-in keeps what was saved, blank included, since a blank there was
 * an answer. Only a check-in not yet made starts from the RPE given when the last
 * session was finished, so the owner does not type the same number twice.
 */
export function priorRpePrefill(
  saved: { priorSessionRpe: string | null } | null,
  lastReported: number | null,
): { value: string; filled: boolean } {
  if (saved) {
    return {
      value: saved.priorSessionRpe === null ? "" : String(Number(saved.priorSessionRpe)),
      filled: false,
    };
  }
  return lastReported === null
    ? { value: "", filled: false }
    : { value: String(lastReported), filled: true };
}
