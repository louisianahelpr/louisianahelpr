/**
 * AUD31-76 (audit 10-31, Jobs arrival): auto_start_due_jobs (20261029160717) moves every booked job to in_progress at its
 * start time. A hired Helpr who had not tapped On my way was then told "Finish and mark it done" (and, past the day,
 * "Day passed — finish and mark it done"), as if mid-job. With no stamp that says they set out or arrived, a one-Helpr
 * job's line is still the On my way step; any such stamp, or a crew job (its steps are per member), reads as before.
 *
 * @mutate src/components/job-card/jobStatusLine.ts |       if (!job.is_group_job && !setOutOrArrived(job)) return "today"; |
 * @mutate src/components/job-card/jobStatusLine.ts | job.status === "in_progress" && (job.is_group_job \|\| setOutOrArrived(job)) ? "overdue_unfinished" | job.status === "in_progress" ? "overdue_unfinished"
 * @mutate src/components/job-card/jobStatusLine.ts |   return !!(job.helper_on_the_way_at \|\| job.helper_arrived_at \|\| job.helper_arrival_verified_at | return !!(job.helper_arrived_at \|\| job.helper_arrival_verified_at
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveHelperWait, helperStatusLine } from "./jobStatusLine";
import type { AppliedApp } from "./activityConstants";

const ME = "11111111-1111-1111-1111-111111111111";
// 2024-10-30 is a CDT day (UTC-5). The job starts at 2:00 PM Central (19:00Z).
const job = (over: Record<string, unknown> = {}) => ({
  id: "j1", status: "in_progress", date_needed: "2024-10-30", start_time: "14:00", helper_id: ME,
  helper_confirmed_at: "2024-10-25T12:00:00Z", helper_dayof_confirmed_at: "2024-10-29T12:00:00Z", poster_confirmed_at: "2024-10-29T13:00:00Z",
  ...over,
});
const app = (over: Record<string, unknown> = {}) =>
  ({ id: "a1", job_id: "j1", helper_id: ME, status: "accepted", closed_reason: null, job: job(over) }) as unknown as AppliedApp;

describe("AUD31-76: an auto-started job the Helpr has not set out for", () => {
  afterEach(() => vi.useRealTimers());

  it("50 minutes after the start, with no On my way: the On my way step, never Finish and mark it done", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-30T19:50:00Z"));
    expect(deriveHelperWait(app())).toBe("today");
    expect(helperStatusLine(app()).detail).toBe("It's time — tap I'm on my way");
  });

  it("past the day, with no On my way: On My Way or cancel, never finish and mark it done", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-31T15:00:00Z"));
    expect(deriveHelperWait(app())).toBe("overdue_not_started");
  });

  it("any stamp that says they set out or arrived, or a crew job, reads as before", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-30T19:50:00Z"));
    expect(deriveHelperWait(app({ helper_on_the_way_at: "2024-10-30T19:10:00Z" }))).toBe("on_the_way");
    // Arrived (by their tap or the GPS check): the arrived steps (before photo, Start working, ...), never On my way.
    expect(deriveHelperWait(app({ helper_on_the_way_at: "2024-10-30T19:10:00Z", helper_arrived_at: "2024-10-30T19:30:00Z" }))).not.toBe("today");
    expect(deriveHelperWait(app({ helper_arrival_verified_at: "2024-10-30T19:30:00Z" }))).not.toBe("today");
    expect(deriveHelperWait(app({ is_group_job: true }))).not.toBe("today");
    vi.setSystemTime(new Date("2024-10-31T15:00:00Z"));
    expect(deriveHelperWait(app({ helper_on_the_way_at: "2024-10-30T19:10:00Z", helper_arrived_at: "2024-10-30T19:30:00Z" }))).not.toBe("overdue_not_started");
    expect(deriveHelperWait(app({ helper_arrival_verified_at: "2024-10-30T19:30:00Z" }))).toBe("overdue_unfinished");
    expect(deriveHelperWait(app({ is_group_job: true }))).toBe("overdue_unfinished");
  });
});
