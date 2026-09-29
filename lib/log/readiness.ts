/** The fields of a readiness row only the owner fills in, never the WHOOP sync. */
type SelfReported = {
  priorSessionRpe: string | null;
  motivation: number | null;
  notes: string | null;
  sorenessByRegion: unknown;
};

/** Whether the owner has answered any part of the day's check-in. */
function checkedIn(saved: SelfReported): boolean {
  const soreness = saved.sorenessByRegion;
  return (
    saved.priorSessionRpe !== null ||
    saved.motivation !== null ||
    (saved.notes ?? "").trim() !== "" ||
    (typeof soreness === "object" && soreness !== null && Object.keys(soreness).length > 0)
  );
}

/**
 * What the check-in's "Prior session RPE" field starts from.
 *
 * A saved check-in keeps what was saved, blank included, since a blank there was
 * an answer. Only a check-in not yet made starts from the RPE given when the last
 * session was finished, so the owner does not type the same number twice. A row
 * holding nothing the owner answered is not a check-in: the nightly WHOOP sync
 * creates the day's row with only device numbers before the morning check-in.
 */
export function priorRpePrefill(
  saved: SelfReported | null,
  lastReported: number | null,
): { value: string; filled: boolean } {
  if (saved && checkedIn(saved)) {
    return {
      value: saved.priorSessionRpe === null ? "" : String(Number(saved.priorSessionRpe)),
      filled: false,
    };
  }
  return lastReported === null
    ? { value: "", filled: false }
    : { value: String(lastReported), filled: true };
}
