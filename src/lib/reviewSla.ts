/**
 * reviewSla — the one place the account-review turnaround is written down.
 *
 * Why this exists: /account-pending stated the SLA TWICE, with two different
 * numbers. The hero said "24–48 hours" and the banner directly beneath it said
 * "under 2 hours"; the banner had been written to replace the hero line and the
 * hero line was never deleted, so both shipped and both always rendered (the
 * "Final admin review" step is never marked done, so that screen's progress can
 * never reach 100% and the banner's `progressPct < 100` guard is always true).
 * A third hardcoded "24–48 hours" sat in the dashboard's pending-review banner.
 * Someone waiting on approval read all three and had no idea which was true.
 *
 * "Under 2 hours" is the surviving number — it is the newer, business-hours-
 * calibrated copy the banner comment describes. Import it; never re-type it.
 */

/** Typical review turnaround, phrased to drop straight into a sentence. */
export const REVIEW_SLA = "under 2 hours";

/** The window that turnaround assumes — reviewers are human and local. */
export const REVIEW_SLA_HOURS = "8a–6p CT";
