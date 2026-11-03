/**
 * Lead 11-03 (no item number): on the job page, after a job's day-before confirm deadline (2 hours before the start,
 * confirmDeadlineMs) had passed, the next-step line still said "Confirm you'll be at the job by Fri 8:00 AM" /
 * "Waiting on Jolie to confirm by Fri 8:00 AM". It now says the window passed, in the app's past-due wording
 * ("Confirm window passed", the confirm_day clock's own expiredText), and what the app already promises happens next:
 * "or it's reposted to other Helprs" (JobConfirmation), which sweep_confirm_reminders_and_repost keeps. That sweep
 * never reposts a crew job or a series visit (parent_job_id set), so their lines only say the window passed; and a row
 * that never selected parent_job_id makes no repost claim (lead 11-03: never show a promise the code doesn't keep).
 *
 * @mutate src/components/tracker/jobProgressState.ts | const helprLate = !helprIn && !Number.isNaN(due) && now >= due; | const helprLate = false;
 * @mutate src/components/job-card/jobStatusLine.ts |     if (Date.now() >= due) return confirmWindowPassedLine(f, job); |     if (false) return confirmWindowPassedLine(f, job);
 * @mutate src/components/job-card/jobStatusLine.ts |   const reposted = job.is_group_job !== true && job.parent_job_id === null; |   const reposted = job.is_group_job !== true;
 * @mutate src/components/job-card/jobStatusLine.ts |   const reposted = job.is_group_job !== true && job.parent_job_id === null; |   const reposted = job.parent_job_id === null;
 * @mutate src/components/job-card/jobStatusLine.ts |   const reposted = job.is_group_job !== true && job.parent_job_id === null; |   const reposted = job.is_group_job !== true && job.parent_job_id == null;
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { confirmWindowPassedLine, posterStatusLine } from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";

// Wed 2037-10-21 10:00 AM in Louisiana (CDT). A job starting at 11:00 had its confirm deadline at 9:00.
const NOW = new Date("2037-10-21T15:00:00Z");
const base: ProgressJob = { status: "accepted", helper_id: "jolie", helper_confirmed_at: "t", payment_status: "escrow", date_needed: "2037-10-21", parent_job_id: null };
const poster = (j: Partial<ProgressJob>) => jobProgress({ ...base, ...j }, { viewer: "poster", otherFirst: "Jolie", threadHelprId: "jolie", now: NOW }).next;
const helpr = (j: Partial<ProgressJob>) => jobProgress({ ...base, helper_id: "me", ...j }, { viewer: "helpr", otherFirst: "Jolie", threadHelprId: "me", now: NOW }).next;
const card = (over: Record<string, unknown>) =>
  posterStatusLine({ id: "j", title: "t", customer_id: "p", ...base, ...over } as unknown as Job, 0, NOW, undefined, false, "Jolie Jones").detail;

describe("past the Helpr's confirm deadline, no line says 'by' a time already gone (lead 11-03)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it("the job page's next step, both sides", () => {
    // Deadline 9:00 AM, now 10:00 AM, start 11:00 AM.
    expect(helpr({ start_time: "11:00" })).toBe("Confirm window passed. It's being reposted to other Helprs");
    expect(poster({ start_time: "11:00", poster_confirmed_at: "t" })).toBe("Confirm window passed. Jolie didn't confirm, so it's being reposted");
    // Vacuity floor: deadline 11:00 AM is still ahead, so the line still names it.
    expect(helpr({ start_time: "13:00" })).toBe("Confirm you'll be at the job by Wed 11:00 AM");
    expect(poster({ start_time: "13:00", poster_confirmed_at: "t" })).toBe("Waiting on Jolie to confirm by Wed 11:00 AM");
    // The Helpr confirmed: nothing passed for them; the poster's own confirm runs to the start (unchanged).
    expect(helpr({ start_time: "11:00", helper_dayof_confirmed_at: "t" })).toBe("Waiting on Jolie to confirm by Wed 11:00 AM");
  });

  it("the poster's card line", () => {
    expect(card({ start_time: "11:00:00", poster_confirmed_at: "t" })).toBe("Confirm window passed. Jolie didn't confirm, so it's being reposted");
    expect(card({ start_time: "13:00:00", poster_confirmed_at: "t" })).toBe("Waiting on Jolie to confirm by Wed 11:00 AM");
  });

  it("a crew job or a series visit is never reposted by the sweep, so its line says only that the window passed", () => {
    expect(confirmWindowPassedLine(null, { is_group_job: true, parent_job_id: null })).toBe("Confirm window passed");
    expect(confirmWindowPassedLine("Jolie", { is_group_job: true, parent_job_id: null })).toBe("Confirm window passed. Jolie hasn't confirmed");
    // A series visit, on the job page's own line (useJobPage selects parent_job_id).
    expect(helpr({ start_time: "11:00", parent_job_id: "series-parent" })).toBe("Confirm window passed");
    expect(poster({ start_time: "11:00", poster_confirmed_at: "t", parent_job_id: "series-parent" })).toBe("Confirm window passed. Jolie hasn't confirmed");
    expect(card({ start_time: "11:00:00", poster_confirmed_at: "t", parent_job_id: "series-parent" })).toBe("Confirm window passed. Jolie hasn't confirmed");
    // A row that never selected parent_job_id (JobTracking's own pick, DealCard) cannot know: no repost claim.
    expect(confirmWindowPassedLine(null, {})).toBe("Confirm window passed");
    // The one case the sweep reposts.
    expect(confirmWindowPassedLine("Jolie", { is_group_job: false, parent_job_id: null })).toMatch(/reposted/);
  });
});
