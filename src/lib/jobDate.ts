import { jobLocalMidnightMs } from "../../supabase/functions/_shared/cancellationFee";

/**
 * A bare `YYYY-MM-DD`, which is the only shape `jobs.date_needed` (a Postgres
 * `date`) can arrive in. Anchored at both ends on purpose: an ISO TIMESTAMP
 * must NOT slip through by prefix match, because its first ten characters are
 * the UTC day, and the whole point of this module is that the UTC day and the
 * platform-zone day are not the same day.
 */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ONE way to read `jobs.date_needed`.
 *
 * It is a bare `YYYY-MM-DD` with no zone, so `new Date(d)` lands on UTC
 * midnight, `new Date(d + "T00:00:00")` lands on the RUNTIME's midnight, and
 * the two are five or six hours apart in Central. Four different spellings
 * were in use across the codebase, comparisons were being made between them,
 * and this module exists so the question has one answer.
 *
 * The one that was actually wrong rather than merely inconsistent was the
 * admin jobs queue: it compared `new Date(date_needed)` (UTC midnight) against
 * `new Date(new Date().toDateString())` (LOCAL midnight). In Central those are
 * 00:00Z and 05:00Z, so a job dated today always sorted as earlier than
 * "today" and the moderation queue flagged "Date needed is in the past" on
 * every same-day job. Eight active jobs dated today, zero of them actually
 * past.
 *
 * This wraps `jobLocalMidnightMs` — the helper the money paths already use,
 * which resolves midnight in the PLATFORM's zone (America/Chicago) rather than
 * whatever zone the browser or the edge runtime happens to be in. A Louisiana
 * marketplace has exactly one answer to "what day is this job on", and it is
 * not the reader's timezone.
 *
 * WHERE THE DIVERGENCE STANDS (re-derived 2026-08-31)
 * --------------------------------------------------
 * It is resolved. Every place that compares a job's day against ANOTHER
 * instant now resolves both sides in the platform's zone — `adminJobsHelpers`
 * and `activityFilters` through `isPastDue`, `ApplicantsStates` through
 * `jobDateMs`/`daysPastDue`, and `CancellationDialog`/`BlockUserDialog`
 * through `jobLocalMidnightMs` directly. Three raw parses survive, and none of
 * them is a cross-zone comparison:
 *
 *   - `useDashboardFilters` drops stale posts by LEXICOGRAPHIC compare of two
 *     `YYYY-MM-DD` strings, which needs no parsing at all, and separately
 *     builds `new Date(d + "T12:00:00")` purely to read `.getDay()` for a
 *     day-of-week availability match. Noon is the point: no zone on earth is
 *     twelve hours off, so the weekday cannot slip.
 *   - `smartSort` and `useOpenJobsFeed` sort by
 *     `new Date(a.date_needed) - new Date(b.date_needed)`. Both operands take
 *     the same offset, so it cancels; the ORDER is correct in every zone, and
 *     order is all a comparator claims.
 *
 * This comment previously cited `applyConfirmDialogHelpers:108` and `:57` as
 * two divergent parses fifty lines apart in one file. Both lines still exist
 * and still disagree — but they sit in `getApplyTips` and
 * `buildStarterSentences`, and BOTH of those exports now have zero importers
 * (`ApplyBody.tsx` takes only the draft-key constants from that module). They
 * are dead code, not a live inconsistency. `fetchAnalytics`, also cited, no
 * longer exists under that name anywhere in `src/`.
 *
 * Functions are named rather than line numbers cited, deliberately. Two of the
 * old citations had already rotted onto code that no longer says what they
 * claimed — `useDashboardFilters:279` is the lexicographic compare described
 * above, not a `new Date(d)`, and `useUserProfileData` parses
 * `date_needed`+`start_time` as a scheduled START TIME, a different question
 * from "which day". A line number that still resolves is worse than a missing
 * one, because it reads as verified.
 */
export function jobDateMs(dateNeeded: string | null | undefined): number | null {
  if (!dateNeeded) return null;
  // `jobLocalMidnightMs` splits on "-" and feeds the parts to `Date.UTC`, so
  // anything that is not a bare date yields NaN, and `Intl.DateTimeFormat`
  // THROWS `RangeError: Invalid time value` on `new Date(NaN)` rather than
  // returning a bad answer. That throw escapes whatever is calling — and the
  // busiest caller is the `useMemo` in `activityFilters` that buckets the
  // Activity list, so one malformed row took /my-posts and /my-jobs to the
  // error boundary ("This page hit a problem.") with every job on them gone.
  // An unreadable date is not a reason to lose the page: return null, which
  // every consumer here already handles as "no opinion" (`isPastDue` → false,
  // `daysPastDue` → 0), i.e. the card renders without the overdue treatment
  // instead of not rendering at all.
  //
  // This guards the CLIENT read only. `jobLocalMidnightMs` itself still throws,
  // deliberately — its other callers are the cancellation-fee money paths,
  // where a silently-null date would mis-price a refund and failing loudly is
  // the correct behaviour.
  if (!BARE_DATE.test(dateNeeded)) return null;
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

/**
 * How many whole days ago was this job's day? 0 for today or any future date.
 *
 * Both operands come from `jobLocalMidnightMs`, so the subtraction is between
 * two platform-zone midnights and the DST-shifted day is rounded rather than
 * floored — a 23- or 25-hour day must still count as one day, not zero or one
 * plus a remainder.
 */
export function daysPastDue(dateNeeded: string | null | undefined): number {
  const ms = jobDateMs(dateNeeded);
  if (ms === null) return 0;
  const diff = todayMs() - ms;
  return diff <= 0 ? 0 : Math.round(diff / 86_400_000);
}
