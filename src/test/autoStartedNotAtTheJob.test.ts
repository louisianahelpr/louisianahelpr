/**
 * A JOB THE CLOCK STARTED NEVER SAYS THE HELPR IS THERE (audit 2026-10-29 A2-B12).
 *
 * The bug, on prod (AA9 chunk 1a, aa9-ns-*): auto-start-due-jobs (every 15 min, live body read 2026-10-29) sets
 * status = 'in_progress' on every booked job whose start has passed, whether or not the Helpr confirmed the day, set
 * out or arrived. The poster's card then said "Eli is at the job" with Confirmed / On the way / Arrived lit, the job
 * page said "Work is underway", and No-Show sat under More.
 *
 * The fix: an in_progress job with no arrival anyone recorded (no helper_arrived_at, no poster_confirmed_arrival_at,
 * no poster_confirmed_working_at) is "started_no_checkin": eyebrow "Start time passed", line "Eli hasn't checked in",
 * the tracker lit from the stamps (stuck(): the first step that never happened, in the No-show? colour), and
 * "Report no-show" on the face.
 *
 * @mutate src/components/job-card/jobStatusLine.ts |       if (job.status === "in_progress" && !job.helper_arrived_at && !job.poster_confirmed_arrival_at && !job.poster_confirmed_working_at) { |       if (false) {
 * @mutate src/components/job-card/jobStatusLine.ts |         return start && start.getTime() > now.getTime() ? "confirmed" : "started_no_checkin"; |         return "started_no_checkin";
 * @mutate src/components/tracker/jobStepFromWait.ts |   started_no_checkin: NO_SHOW, |   started_no_checkin: at(6),
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts |     case "started_no_checkin":\n      // started_no_checkin: |       // started_no_checkin:
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { posterStatusLine, POSTER_WAIT } from "@/components/job-card/jobStatusLine";
import { POSTER_STEP } from "@/components/tracker/jobStepFromWait";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import type { Job } from "@/components/job-card/activityConstants";
import { jobLocalDateISO } from "./helpers/jobLocalDate";

const NOW = new Date("2026-10-29T15:40:00Z"); // 10:40 CT, 25 minutes after a 10:15 start
const base = {
  id: "job-1", customer_id: "poster-1", helper_id: "eli-1", title: "Mow", status: "in_progress",
  payment_status: "held", date_needed: jobLocalDateISO(0, NOW), start_time: "10:15:00", is_flexible_schedule: false,
  helper_confirmed_at: "2026-10-27T12:00:00Z", helper_dayof_confirmed_at: null, poster_confirmed_at: null,
  helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_arrival_at: null, poster_confirmed_working_at: null,
  helper_completed_at: null, is_group_job: false,
} as unknown as Job;

describe("a job the clock started never says the Helpr is there (A2-B12)", () => {
  // jobIsOverdue (activityFilters.ts) reads the real clock, not the `now` passed to posterStatusLine. Pin the
  // clock to NOW so the 2026-10-29 fixture is "today" on any run date (it went red as overdue_no_show on 10-30).
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("in progress with no check-in: the start passed, the Helpr hasn't checked in, and it is the poster's move", () => {
    const line = posterStatusLine(base, 0, NOW);
    expect(line.id).toBe("started_no_checkin");
    expect(POSTER_WAIT.started_no_checkin.detail).toBe("Your Helpr hasn't checked in");
    expect(line.eyebrow).toBe("Start time passed");
    expect(POSTER_WAIT.started_no_checkin.tone).toBe("you");
    expect(JSON.stringify(line)).not.toMatch(/at the job|underway|started working/i);
  });

  it("the tracker lights only what happened: Hired, stuck before Confirmed in the No-show? colour", () => {
    const step = POSTER_STEP.started_no_checkin;
    const s = typeof step === "function" ? step(base as never, NOW.getTime()) : step;
    expect(s).toMatchObject({ stage: 3, tone: "problem", label: "No-show?" });
    const confirmed = { ...base, helper_dayof_confirmed_at: "2026-10-28T15:00:00Z", poster_confirmed_at: "2026-10-28T16:00:00Z" } as Job;
    const s2 = (POSTER_STEP.started_no_checkin as (j: never, n: number) => { stage: number })(confirmed as never, NOW.getTime());
    expect(s2.stage).toBe(4);
  });

  it("the face offers Report no-show", () => {
    const noShow = vi.fn();
    const h = { noShow, message: vi.fn(), manage: vi.fn(), cancel: vi.fn(), helperName: "Eli H." } as never;
    const a = posterFaceAction("started_no_checkin", base, h);
    expect(a).toMatchObject({ label: "Report no-show", onClick: noShow });
  });

  it("a recorded arrival (GPS or the poster's word) still reads as at the job", () => {
    for (const stamp of ["helper_arrived_at", "poster_confirmed_arrival_at", "poster_confirmed_working_at"]) {
      const j = { ...base, [stamp]: "2026-10-29T15:20:00Z" } as Job;
      expect(posterStatusLine(j, 0, NOW).id, stamp).not.toBe("started_no_checkin");
    }
  });

  it("a start still ahead has not passed: no 'Start time passed', no Report no-show (T12-B)", () => {
    const ahead = { ...base, start_time: "23:00:00" } as Job;
    expect(posterStatusLine(ahead, 0, NOW).id).toBe("confirmed");
    expect(posterStatusLine(ahead, 0, NOW).eyebrow).not.toBe("Start time passed");
  });

  it("the named line says who", () => {
    expect(posterStatusLine(base, 0, NOW, undefined, false, "Eli H.").detail).toBe("Eli hasn't checked in");
  });
});
