/**
 * ONE JOB, START TO FINISH (owner, 2026-10-08, Q1572: "you need to go through
 * all these steps thoroughly like start to finish. if poster does this helpr
 * does this and so on until you get to done"). The contract is
 * docs/JOB-LIFECYCLE.md; this walks it step by step on BOTH sides and fails on
 * the first step where a tab, a sentence or the poster's next button disagrees
 * with it. The server half of each step's order is proven by the PGlite files
 * named in the steps (jobStepOrder, confirmRepost, backoutNotices,
 * jobTwoHoursNotice).
 *
 * @mutate src/components/job-card/jobStatusLine.ts |   on_the_way: (n) => `${firstName(n)} is on the way`, |   on_the_way: (n) => `${firstName(n)} is coming`,
 */
import { describe, expect, it } from "vitest";
import { appliedActivityBucket, postedActivityBucket } from "@/components/job-card/activityFilters";
import { helperStatusLine, posterStatusLine } from "@/components/job-card/jobStatusLine";
import { posterConfirmationRung } from "@/pages/posts/postedJobCard/steps/posterStepContract";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

// Thursday 2032-10-14, 2:00 PM Central (19:00Z). Confirm window opens Wed 05:00Z.
const DAY = "2032-10-14";
const T = (iso: string) => new Date(iso);
const base = { id: "j", title: "Mow the yard", customer_id: "sam", date_needed: DAY, start_time: "14:00:00", expires_at: "2032-10-14T19:00:00Z", is_group_job: false, payment_status: "escrow" };
const job = (over: Record<string, unknown>) => ({ ...base, ...over }) as unknown as Job;
const app = (j: Job, status = "accepted") =>
  ({ id: "a", job_id: "j", helper_id: "lexi", status, posterName: "Sam Smith", job: j }) as unknown as AppliedApp;
const poster = (j: Job, now: Date, pending = 0) => ({
  tab: postedActivityBucket(j, pending, now),
  line: posterStatusLine(j, pending, now, undefined, false, j.helper_id ? "Lexi Lombas" : null).detail,
});

describe("one job, start to finish, both sides", () => {
  it("1 Posted: poster Waiting, 'No applicants yet'", () => {
    const j = job({ status: "open", helper_id: null });
    expect(poster(j, T("2032-10-09T12:00:00Z"))).toEqual({ tab: "waiting", line: "No applicants yet" });
  });

  it("2 Applied: poster Needs You (applicants); Helpr Waiting, names the poster", () => {
    // The Helpr's bucket reads the real clock, so this listing stays open forever.
    const j = job({ status: "open", helper_id: null, expires_at: "2099-01-01T00:00:00Z" });
    expect(poster(j, T("2032-10-09T12:00:00Z"), 1).tab).toBe("needs_you");
    expect(helperStatusLine(app(j, "pending")).detail).toBe("Sam hasn't replied yet");
    expect(appliedActivityBucket(app(j, "pending"))).toBe("waiting");
  });

  it("3 Offered: poster Waiting on the named Helpr", () => {
    const j = job({ status: "accepted", helper_id: "lexi", helper_confirmed_at: null, response_deadline: "2032-10-10T12:00:00Z" });
    const p = poster(j, T("2032-10-09T12:00:00Z"));
    expect(p.line).toMatch(/Lexi hasn't accepted yet/);
  });

  const accepted = { status: "accepted", helper_id: "lexi", helper_confirmed_at: "2032-10-09T13:00:00Z" };
  it("4 Accepted (window not open): both Scheduled; 'Lexi accepted'; no poster arrival button yet", () => {
    const j = job(accepted);
    const now = T("2032-10-11T12:00:00Z");
    expect(poster(j, now)).toEqual({ tab: "scheduled", line: "Lexi accepted" });
    expect(posterConfirmationRung(j, "scheduled", now)).toBeNull();
  });

  it("5 Confirm window open: each unconfirmed side is Needs You, with its own sentence", () => {
    const j = job(accepted);
    const now = T("2032-10-13T12:00:00Z");
    expect(poster(j, now)).toEqual({ tab: "needs_you", line: "Lexi accepted · confirm the job is still on" });
  });

  it("6 Confirmed (both tapped): poster back in Scheduled, 'Lexi confirmed'", () => {
    const j = job({ ...accepted, helper_dayof_confirmed_at: "2032-10-13T13:00:00Z", poster_confirmed_at: "2032-10-13T14:00:00Z" });
    expect(poster(j, T("2032-10-14T10:00:00Z"))).toEqual({ tab: "scheduled", line: "Lexi confirmed" });
  });

  const confirmed = { ...accepted, helper_dayof_confirmed_at: "2032-10-13T13:00:00Z", poster_confirmed_at: "2032-10-13T14:00:00Z" };
  it("7 On the way: started -> Needs You; 'Lexi is on the way'; poster's Confirm They Arrived greyed, saying when", () => {
    const j = job({ ...confirmed, status: "in_progress", helper_on_the_way_at: "2032-10-14T17:30:00Z" });
    const now = T("2032-10-14T17:40:00Z");
    expect(poster(j, now)).toEqual({ tab: "needs_you", line: "Lexi is on the way" });
    const r = posterConfirmationRung(j, "in_progress", now)!;
    expect([r.label, r.enabled]).toEqual(["Confirm They Arrived", false]);
    expect(r.reason).toMatch(/turns on once your Helpr says they've arrived/);
  });

  it("8 Arrived: the poster's Confirm They Arrived turns on", () => {
    const j = job({ ...confirmed, status: "in_progress", helper_on_the_way_at: "2032-10-14T17:30:00Z", helper_arrived_at: "2032-10-14T18:55:00Z" });
    expect(posterConfirmationRung(j, "in_progress", T("2032-10-14T18:56:00Z"))!.enabled).toBe(true);
  });

  it("9 Working: the poster's Confirm They're Working is greyed until the Helpr starts, then live", () => {
    const j = job({ ...confirmed, status: "in_progress", helper_on_the_way_at: "x", helper_arrived_at: "y", poster_confirmed_arrival_at: "z" });
    const now = T("2032-10-14T19:05:00Z");
    expect(posterConfirmationRung(j, "in_progress", now, false)!.enabled).toBe(false);
    expect(posterConfirmationRung(j, "in_progress", now, true)!.enabled).toBe(true);
  });

  it("10 Marked done: poster Needs You to approve, named", () => {
    const j = job({ ...confirmed, status: "in_progress", helper_on_the_way_at: "x", helper_arrived_at: "y", helper_completed_at: "2032-10-14T21:00:00Z" });
    const p = poster(j, T("2032-10-14T21:05:00Z"));
    expect(p.tab).toBe("needs_you");
    expect(p.line).toBe("Lexi marked it done — approve & release pay");
  });

  it("11 Done: both Done", () => {
    const j = job({ ...confirmed, status: "completed", helper_completed_at: "a", poster_completed_at: "b", payment_status: "released" });
    expect(postedActivityBucket(j, 0, T("2032-10-15T12:00:00Z"))).toBe("done");
    expect(appliedActivityBucket(app(j))).toBe("done");
  });

  it("off the path: a back-out keeps the other person's card in Needs You", () => {
    const j = job({ status: "open", helper_id: null, backout_notice: { id: "n", job_id: "j", backout_kind: "helper_cancelled", actor_name: "Lexi" } });
    expect(postedActivityBucket(j, 0, T("2032-10-13T12:00:00Z"))).toBe("needs_you");
  });
});
