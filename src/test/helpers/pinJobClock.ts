import { vi } from "vitest";

/**
 * Pin Date to noon in the job's zone (America/Chicago) for a file whose
 * fixtures date a job TODAY with a literal start time.
 *
 * WHY. On the real clock such a fixture is hour-dependent. "Start today at
 * 23:59" means "later today" for 1,439 minutes a day and NOW for the last one:
 * from 23:59 to midnight Central the start has arrived, Cancel Job is no
 * longer offered, and a card that should show four controls shows three. It
 * went red twice at exactly 04:59Z (23:59 CDT): jobRowControlSameness on PR
 * #1996 (run 36817413591), which pinned its own clock, and then its sibling
 * jobStepOneRow on PR #2178 (run 37098219105), which had not.
 *
 * Only Date is faked, and it keeps advancing (shouldAdvanceTime), so findBy*
 * and waitFor behave as before. Call it after the imports and before the
 * first Date.now(); the clock constants (NOW, TODAY, YESTERDAY) must be
 * computed after it. src/test/jobDayFixtureTimezone.test.ts holds the rule.
 */
export function pinJobClock(at = "2026-06-15T17:00:00Z"): void {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(at));
}
