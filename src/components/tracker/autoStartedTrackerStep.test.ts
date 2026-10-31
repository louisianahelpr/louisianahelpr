/**
 * AUD31-76, the tracker half (audit 10-31, Jobs arrival): a hired Helpr who had not set out, 50 minutes after the
 * start, on a job auto_start_due_jobs (20261029160717) moved to in_progress. The job page's tracker ticked On the way
 * and Arrived and put the Helpr on Working with "Finish and mark it done" (seen on screen in a headless render of
 * JobTracker with the audit's row, ~/.lh-shots/b28-1031/aud76-before-375.png, on 98047286fb). The card's line fix
 * (6d8a991f65) moved the bar to On the way (the bar is read from the card's line id); this pins that, and the line
 * under the bar now says what the card says once the start has passed, "It's time — tap I'm on my way", instead of
 * "Tap I'm on my way when you leave".
 *
 * @mutate src/components/tracker/jobProgressState.ts | const started = status === "in_progress" \|\| | const started = false &&
 * @mutate src/components/job-card/jobStatusLine.ts |       if (!job.is_group_job && !setOutOrArrived(job)) return "today"; |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobProgress, type ProgressJob } from "./jobProgressState";
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import type { Job } from "@/components/job-card/activityConstants";

const ME = "11111111-1111-1111-1111-111111111111";
// 2024-10-30 is a CDT day (UTC-5). The job starts at 2:00 PM Central (19:00Z).
const row = (over: Partial<ProgressJob> = {}): ProgressJob => ({
  id: "j1", status: "in_progress", helper_id: ME, payment_status: "escrow", date_needed: "2024-10-30", start_time: "14:00:00",
  helper_confirmed_at: "2024-10-25T12:00:00Z", helper_dayof_confirmed_at: "2024-10-29T12:00:00Z", poster_confirmed_at: "2024-10-29T13:00:00Z",
  ...over,
});
// The job page's own call (JobPageParts JobTracker): workUnderway from the tracking row (none here).
const page = (j: ProgressJob) =>
  jobProgress(j, { viewer: "helpr", workUnderway: helperProgress(j as unknown as Job, null).workUnderway, tracking: null });

describe("AUD31-76: the tracker for an auto-started job the Helpr has not set out for", () => {
  afterEach(() => vi.useRealTimers());

  it("50 minutes after the start: On the way is the current step (your move), never Working, and the line says it's time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-30T19:50:00Z"));
    const p = page(row());
    expect(p.stage).toBe(4);
    expect(p.waitingOnYou).toBe(true);
    expect(p.word).toBe("On the way");
    expect(p.next).toBe("It's time — tap I'm on my way");
  });

  it("before the start (still accepted): the same step, 'when you leave'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-30T17:00:00Z"));
    const p = page(row({ status: "accepted" }));
    expect(p.stage).toBe(4);
    expect(p.next).toBe("Tap I'm on my way when you leave");
  });

  it("once they set out the bar is still On the way, and arrived moves it on", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-10-30T19:50:00Z"));
    expect(page(row({ helper_on_the_way_at: "2024-10-30T19:10:00Z" })).next).toBe("You're on the way");
    expect(page(row({ helper_on_the_way_at: "2024-10-30T19:10:00Z", helper_arrived_at: "2024-10-30T19:40:00Z" })).stage).toBeGreaterThan(4);
  });
});
