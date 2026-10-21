/**
 * THE HELPER'S DAY-OF ANSWER, in one place.
 *
 * `helper_confirmed_at` is stamped at ACCEPT time — possibly days early — so it
 * cannot answer "are you still on today?". `helper_dayof_confirmed_at`
 * (migration 20260824213000) is the day-before tap. An accept that itself
 * happened inside the 24h window IS a day-of answer, so it counts.
 *
 * Exported because the merged tracker panel on the helper's card
 * (appliedJobCard/HelperTrackerPanel) gates "I'm on my way" on exactly this
 * value, and a second hand-rolled copy of the rule is how the card and the card
 * it sits inside end up disagreeing about whether the helper has confirmed.
 *
 * Returns the effective STAMP (so callers can print it), or null.
 */

export function helperDayOfConfirmation({
  helperDayofConfirmedAt,
}: {
  helperConfirmedAt: string | null;
  helperDayofConfirmedAt?: string | null;
  dateNeeded: string;
  /** The job's start. Unused since Q1570 (only the Helpr's own day-before
   *  stamp counts); kept so callers need not change. An accept 24h37m before a
   *  2 PM start once read "Helpr: Confirmed" here while the tracker left
   *  Confirmed unchecked (owner, 2026-10-08, job 5b68bccb). */
  startTime?: string | null;
}): string | null {
  // ACCEPTING NEVER COUNTS (owner, 2026-10-08, Q1570: "both must tap
  // confirm"): an accept inside the window used to stand in for this tap, so
  // a same-day job reached On My Way with nobody confirming anything.
  return helperDayofConfirmedAt ?? null;
}
