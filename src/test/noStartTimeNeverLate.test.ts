/**
 * Jobs audit 1102b row 2 (Q2588): a job with no start time was called late from midnight. At 3:00 AM the poster read
 * "your Helpr is 3 h 2 min late and hasn't set out" and the Helpr "It's time — tap I'm on my way", because every
 * clock read jobStartDateTime(date, null) = 12:00 AM. 368 of the 535 jobs posted in the 60 days to 2026-11-02 have no start
 * time. The rule (src/lib/anyTimeThatDay.ts): no start time is "any time that day", the Post a job form's own words;
 * never late and never "It's time" on its day; the face's I'm on my way from 8:00 AM, never the night before.
 *
 * @mutate src/components/tracker/jobProgressState.ts |   if (!hasStartTime(job)) return null; |   if (false) return null;
 * @mutate src/components/tracker/jobProgressState.ts |   const helprLine = !hasStartTime(job) ? (started ? TODAY_ANY_TIME_LINE : "Tap I'm on my way when you leave") : started | const helprLine = started
 * @mutate src/components/job-card/jobStatusLine.ts |         if (!hasStartTime(job)) return "confirmed"; |         if (false) return "confirmed";
 * @mutate src/components/job-card/jobStatusLine.ts | id === "today" && app.job && !hasStartTime(app.job) ? TODAY_ANY_TIME_LINE : | false ? TODAY_ANY_TIME_LINE :
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |       if (from && Date.now() < from.getTime()) return null; |       if (false) return null;
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |     if (!job.start_time) { |     if (false) {
 * @mutate src/components/job-card/collapsedClocks.ts |   if (job.helper_on_the_way_at) return []; |   if (false) return [];
 * @mutate src/components/job-card/collapsedClocks.ts |   if (!job.start_time && Date.now() >= jobDayStart(job.date_needed).getTime()) return []; |   if (false) return [];
 * @mutate src/components/job-card/jobStatusLine.ts | id === "today" && app.job?.is_group_job === true ? CREW_TODAY_LINE : | false ? CREW_TODAY_LINE :
 * @mutate src/lib/anyTimeThatDay.ts | const ANY_TIME_FACE_FROM = "08:00"; | const ANY_TIME_FACE_FROM = "00:00";
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { helperStatusLine, posterStatusLine } from "@/components/job-card/jobStatusLine";
import { helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import { collapsedClocks } from "@/components/job-card/collapsedClocks";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

const DAY = "2026-11-10";
// Central Standard Time (UTC-6) on 2026-11-10.
const AT_3AM = new Date("2026-11-10T09:00:00Z");
const AT_9AM = new Date("2026-11-10T15:00:00Z");
const NIGHT_BEFORE_9PM = new Date("2026-11-10T03:00:00Z");
const T = "2026-11-09T18:00:00Z";
const confirmed: ProgressJob = {
  id: "j1", status: "accepted", customer_id: "p", helper_id: "h", helper_confirmed_at: T, helper_dayof_confirmed_at: T, poster_confirmed_at: T,
  payment_status: "escrow", date_needed: DAY, start_time: null, is_group_job: false,
} as unknown as ProgressJob;
const at = (d: Date) => { vi.useFakeTimers(); vi.setSystemTime(d); };
afterEach(() => vi.useRealTimers());

describe("a job with no start time is any time that day: never late, never 'It's time' (Q2588)", () => {
  it("a timed job past its start still reads late to the poster (the control)", () => {
    at(AT_3AM);
    expect(jobProgress({ ...confirmed, start_time: "02:00" }, { viewer: "poster", otherFirst: "Eli", now: AT_3AM }).next).toMatch(/Eli is 1 h late/);
  });

  it("at 3 AM on its day the poster reads no late count and the Helpr no 'It's time'", () => {
    at(AT_3AM);
    const poster = jobProgress(confirmed, { viewer: "poster", otherFirst: "Eli", now: AT_3AM }).next;
    expect(poster).not.toMatch(/late/i);
    const helpr = jobProgress(confirmed, { viewer: "helpr", otherFirst: "Lexi", threadHelprId: "h", now: AT_3AM }).next;
    expect(helpr).not.toMatch(/it's time/i);
    // Set out at 2:49 AM: "on the way", never "on the way, 3 h late".
    expect(jobProgress({ ...confirmed, helper_on_the_way_at: "2026-11-10T08:49:00Z" }, { viewer: "poster", otherFirst: "Eli", now: AT_3AM }).next).toBe("Eli is on the way");
  });

  it("auto-started at midnight (in_progress, nobody checked in): no 'Start time passed', no 'It's time'", () => {
    at(AT_3AM);
    const job = { ...confirmed, status: "in_progress" } as unknown as Job;
    expect(posterStatusLine(job, 0, AT_3AM).id).not.toBe("started_no_checkin");
    const line = helperStatusLine({ id: "a", job, job_id: "j1", helper_id: "h", status: "accepted", closed_reason: null, posterName: "Lexi" } as unknown as AppliedApp);
    expect(line.detail).not.toMatch(/it's time/i);
    expect(line.detail).toMatch(/any time/i);
    // A timed job auto-started at its start keeps "It's time" (the control).
    const timed = { ...job, start_time: "02:00" } as Job;
    expect(helperStatusLine({ id: "a", job: timed, job_id: "j1", helper_id: "h", status: "accepted", closed_reason: null, posterName: "Lexi" } as unknown as AppliedApp).detail).toMatch(/It's time/);
  });

  it("the face's I'm on my way: not the night before, not at 3 AM, yes from 8 AM", () => {
    const j = { id: "j1", status: "accepted", date_needed: DAY, start_time: null, helper_dayof_confirmed_at: T };
    at(NIGHT_BEFORE_9PM);
    expect(helperFaceNextStep(j, null)).toBeNull();
    at(AT_3AM);
    expect(helperFaceNextStep(j, null)).toBeNull();
    at(AT_9AM);
    expect(helperFaceNextStep(j, null)?.key).toBe("on_the_way");
  });

  it("the start countdown: none on a no-start-time job's day, none once the Helpr set out (Q2589)", () => {
    const j = { date_needed: DAY, start_time: null, status: "accepted", helper_confirmed_at: T };
    at(AT_3AM);
    expect(collapsedClocks(j, true)).toEqual([]);
    // The day before, the job still counts down to its day (the control).
    at(NIGHT_BEFORE_9PM);
    expect(collapsedClocks(j, true).map((c) => c.id)).toContain("start");
    // A timed job, 2 PM: counts down at 3 AM, and stops once the Helpr is on the way.
    at(AT_3AM);
    expect(collapsedClocks({ ...j, start_time: "14:00" }, true).map((c) => c.id)).toContain("start");
    expect(collapsedClocks({ ...j, start_time: "14:00", helper_on_the_way_at: "2026-11-10T08:49:00Z" }, true)).toEqual([]);
  });

  // Q2602 (Jobs audit 1102b row 16, A3-33): the crew member read "It's time — tap I'm on my way" with no such button.
  it("a crew member's line names See your crew steps, never a missing I'm on my way", () => {
    at(AT_3AM);
    const crew = { ...confirmed, is_group_job: true, helper_id: null, status: "in_progress", start_time: "02:00" } as unknown as ProgressJob;
    const line = jobProgress(crew, { viewer: "helpr", otherFirst: "Lexi", now: AT_3AM }).next;
    expect(line).not.toMatch(/I'm on my way/);
    const card = helperStatusLine({ id: "a", job: { ...crew, status: "accepted" } as unknown as Job, job_id: "j1", helper_id: "h", status: "accepted", closed_reason: null, posterName: "Lexi" } as unknown as AppliedApp).detail;
    expect(card).not.toMatch(/I'm on my way/);
  });
});
