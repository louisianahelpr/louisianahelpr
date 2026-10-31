/**
 * NIGHT-JOBSLO6-1 (night audit 10-30, part 4b): a job that started 11:06 PM went "Late" at 12:06 AM ("Day passed —
 * finish and mark it done") while the Helpr was on time, because overdue was the calendar day passing. With a start
 * time, a job is now overdue only once LATE_AFTER_START_HOURS from its start have passed as well (so only a start after
 * 9 PM changes); with no start time (or Flexible), the day passing, as before. The Helpr's and the poster's card words
 * and the tracker's Late step all come from jobIsOverdue (deriveHelperWait / derivePosterWait, jobStepFromWait).
 *
 * @mutate src/components/job-card/activityFilters.ts |   if (!start) return true; |   return true;
 * @mutate src/components/job-card/activityFilters.ts | start.getTime() + LATE_AFTER_START_HOURS * 3_600_000; | start.getTime();
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobIsOverdue, LATE_AFTER_START_HOURS } from "./activityFilters";
import { deriveHelperWait } from "./jobStatusLine";
import type { AppliedApp } from "./activityConstants";

// 2024-10-30 is a CDT day (UTC-5): 23:06 Central is 04:06Z on the 31st.
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const job = (over: Record<string, unknown> = {}) => ({ status: "in_progress", date_needed: "2024-10-30", start_time: "23:06", ...over });

describe("A late-evening job is not Late at midnight (NIGHT-JOBSLO6-1)", () => {
  afterEach(() => vi.useRealTimers());

  it("with a start time: late only LATE_AFTER_START_HOURS after the start, once the day has passed", () => {
    vi.useFakeTimers();
    expect(LATE_AFTER_START_HOURS).toBe(3);
    const cases: [string, Record<string, unknown>, boolean][] = [
      ["2024-10-31T05:06:00Z", {}, false], // 12:06 AM: the audit's moment
      ["2024-10-31T07:05:00Z", {}, false], // 2:05 AM: 23:06 + 3 h is 2:06 AM
      ["2024-10-31T07:07:00Z", {}, true],
      ["2024-10-31T05:06:00Z", { start_time: "20:00" }, true], // 8 PM + 3 h is 11 PM: Late from midnight, as before
      ["2024-10-31T05:06:00Z", { start_time: "21:30" }, false], // 9:30 PM + 3 h is 12:30 AM
      ["2024-10-31T05:06:00Z", { start_time: null }, true], // no start time: the day, as before
      ["2024-10-31T05:06:00Z", { start_time: "flexible" }, true],
      ["2024-10-31T05:06:00Z", { start_time: "09:00", date_needed: "2024-10-29" }, true], // a morning job two days ago
      ["2024-10-30T23:00:00Z", {}, false], // the day itself: never overdue
      ["2024-10-31T09:07:00Z", { status: "completed" }, false],
    ];
    for (const [now, over, want] of cases) {
      at(now);
      expect([now, over, jobIsOverdue(job(over))]).toEqual([now, over, want]);
    }
    expect(cases.length).toBeGreaterThan(8);
  });

  it("the Helpr's card at 12:06 AM: not a Day passed line", () => {
    vi.useFakeTimers();
    at("2024-10-31T05:06:00Z");
    const app = { id: "a1", status: "accepted", helper_id: "h1", job: { ...job(), id: "j1", helper_on_the_way_at: "2024-10-31T03:50:00Z",
      helper_arrived_at: "2024-10-31T03:56:00Z", helper_confirmed_at: "2024-10-30T12:00:00Z" } } as unknown as AppliedApp;
    expect(deriveHelperWait(app)).not.toMatch(/^overdue/);
    at("2024-10-31T09:07:00Z");
    expect(deriveHelperWait(app)).toMatch(/^overdue/);
  });
});
