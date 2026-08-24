import { jobLocalMidnightMs } from "../../supabase/functions/_shared/cancellationFee";

/**
 * ONE way to read `jobs.date_needed`.
 *
 * It is a bare `YYYY-MM-DD` with no zone, and it was being parsed FOUR
 * different ways across the codebase — each of which lands on a different
 * instant:
 *
 *   new Date(d)                  UTC midnight        adminJobsHelpers,
 *                                                    applyConfirmDialogHelpers:108,
 *                                                    useDashboardFilters:279,
 *                                                    useOpenJobsFeed
 *   new Date(d + "T00:00:00")    the RUNTIME's zone  applyConfirmDialogHelpers:57,
 *                                                    fetchAnalytics, useUserProfileData
 *   new Date(d + "T12:00:00")    runtime zone, noon  smartSort, useDashboardFilters:233
 *   jobLocalMidnightMs(d)        the PLATFORM's zone CancellationDialog only
 *
 * `applyConfirmDialogHelpers` used two of them, fifty lines apart, in one file.
 *
 * The one that was actually wrong rather than merely inconsistent is the admin
 * jobs queue: it compared `new Date(date_needed)` (UTC midnight) against
 * `new Date(new Date().toDateString())` (LOCAL midnight). In Central those are
 * 00:00Z and 05:00Z, so a job dated today always sorted as earlier than "today"
 * and the moderation queue flagged "Date needed is in the past" on every
 * same-day job. Eight active jobs dated today, zero of them actually past.
 *
 * This wraps `jobLocalMidnightMs` — the helper the money paths already use,
 * which resolves midnight in the PLATFORM's zone (America/Chicago) rather than
 * whatever zone the browser or the edge runtime happens to be in. A Louisiana
 * marketplace has exactly one answer to "what day is this job on", and it is
 * not the reader's timezone.
 */
export function jobDateMs(dateNeeded: string | null | undefined): number | null {
  if (!dateNeeded) return null;
  return jobLocalMidnightMs(dateNeeded);
}

/** Midnight TODAY in the platform's zone — the correct thing to compare
 *  `jobDateMs` against. Both sides resolve in the same zone, which is the bug
 *  the admin queue had. */
export function todayMs(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // en-CA yields YYYY-MM-DD
  return jobLocalMidnightMs(parts);
}

/** Is this job's day strictly before today, in the platform's zone? */
export function isPastDue(dateNeeded: string | null | undefined): boolean {
  const ms = jobDateMs(dateNeeded);
  return ms !== null && ms < todayMs();
}
