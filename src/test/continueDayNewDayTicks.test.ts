/**
 * Q2789 (ledger a0597e872e21, "job stalled — nobody marked it done", Yusef's job 7b1da54b): on a SET continue day the
 * job page still drew day 1's "On the way" and "Arrived" ticks, and the hired Helpr's face never offered "I'm on my way"
 * or "I've arrived" again, because the job row keeps day 1's stamps for good (the no-show rule reads them; the
 * check-in RPCs COALESCE them). The new day's check-ins live on the tracking row (continue_day_on_agreed puts it back to
 * 'job_confirmed', 20261108160000). jobOnContinueDay(job, row, trackingStatus) now drops a day-1 stamp until the
 * tracking row says the new day reached that step, and the job page passes its tracking row to both the tracker and the
 * Helpr's face.
 *
 * @mutate src/lib/continueDayWords.ts |   if (!ON_THE_WAY_OR_LATER.has(st) && "helper_on_the_way_at" in out) out.helper_on_the_way_at = null; |   if (false && "helper_on_the_way_at" in out) out.helper_on_the_way_at = null;
 * @mutate src/lib/continueDayWords.ts |   if (!ARRIVED_OR_LATER.has(st)) for (const k of ARRIVAL_STAMPS) if (k in out) out[k] = null; |   if (false) for (const k of ARRIVAL_STAMPS) if (k in out) out[k] = null;
 * @mutate src/lib/continueDayWords.ts |   return trackingStatus === undefined ? dated : withNewDayCheckIns(dated, trackingStatus); |   return dated;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const dayJob = jobOnContinueDay(job, continueDay.row, trackingStatus); |   const dayJob = jobOnContinueDay(job, continueDay.row);
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |     ? hiredHelprFace(dayJob, { userId, |     ? hiredHelprFace(job, { userId,
 * @mutate src/components/tracker/jobProgressState.ts |     const newDay = o.tracking === undefined ? undefined : o.tracking?.status ?? null; |     const newDay = undefined;
 *
 * Q2791 (owner screenshot of 7b1da54b): the same rule for every rail that is handed a continue day AND its tracking row
 * (the chat's job card, DealCard): jobProgress's continue-day branch passes the tracking status on.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobOnContinueDay, type ContinueDay } from "@/lib/continueDayWords";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { pinJobClock } from "@/test/helpers/pinJobClock";

pinJobClock();
const TODAY = jobLocalDateISO(0);
const DAY1 = jobLocalDateISO(-5);

// Yusef's job as prod held it on 11-10: in progress, day 1's on-the-way and arrival stamps, a set day today.
const job = {
  id: "7b1da54b", status: "in_progress", date_needed: DAY1, start_time: "09:00",
  helper_confirmed_at: "2026-10-30T04:11:58Z", poster_confirmed_at: "2026-10-31T15:31:41Z",
  helper_dayof_confirmed_at: "2026-11-01T00:08:11Z",
  helper_on_the_way_at: "2026-11-01T14:51:41Z", helper_arrived_at: "2026-11-01T15:29:38Z",
  helper_arrival_verified_at: "2026-11-01T15:29:38Z", poster_confirmed_arrival_at: "2026-11-01T15:34:59Z",
  helper_completed_at: null, payment_status: "escrow", customer_id: "lexi", helper_id: "yusef",
};
const setDay = (over: Partial<ContinueDay> = {}): ContinueDay => ({
  id: "de37688f", job_id: "7b1da54b", proposed_by: "yusef", new_date: TODAY, new_start_time: "13:00:00", note: null,
  status: "set", helper_confirmed_at: "t", ...over,
});

describe("Q2789: a continue day's tracker and Helpr face read the new day's check-ins, never day 1's", () => {
  it("no check-in on the new day: day 1's on-the-way and arrival stamps are dropped", () => {
    const j = jobOnContinueDay(job, setDay(), "job_confirmed");
    expect(j.date_needed).toBe(TODAY);
    expect(j.helper_on_the_way_at).toBeNull();
    expect(j.helper_arrived_at).toBeNull();
    expect(j.helper_arrival_verified_at).toBeNull();
    expect(j.poster_confirmed_arrival_at).toBeNull();
    // null (no tracking row yet) reads the same as no check-in.
    expect(jobOnContinueDay(job, setDay(), null).helper_arrived_at).toBeNull();
  });

  it("the new day's own check-ins bring each tick back", () => {
    const onWay = jobOnContinueDay(job, setDay(), "on_the_way");
    expect(onWay.helper_on_the_way_at).toBe(job.helper_on_the_way_at);
    expect(onWay.helper_arrived_at).toBeNull();
    for (const st of ["arrived", "working", "done"]) {
      const j = jobOnContinueDay(job, setDay(), st);
      expect(j.helper_on_the_way_at).toBe(job.helper_on_the_way_at);
      expect(j.helper_arrived_at).toBe(job.helper_arrived_at);
    }
  });

  it("unchanged without a SET day, or where the tracking row is not read (undefined)", () => {
    expect(jobOnContinueDay(job, setDay({ status: "proposed" }), "job_confirmed")).toBe(job);
    expect(jobOnContinueDay(job, null, "job_confirmed")).toBe(job);
    expect(jobOnContinueDay(job, setDay()).helper_arrived_at).toBe(job.helper_arrived_at);
  });

  it("the job page's tracker no longer ticks Arrived on the new day before the Helpr checks in", () => {
    const before = jobProgress(jobOnContinueDay(job, setDay()), { viewer: "poster", otherFirst: "Yusef", tracking: { status: "job_confirmed" } });
    const after = jobProgress(jobOnContinueDay(job, setDay(), "job_confirmed"), { viewer: "poster", otherFirst: "Yusef", tracking: { status: "job_confirmed" } });
    expect(before.stamps?.[5]).toBe(job.helper_arrived_at);
    expect(after.stamps?.[4]).toBeNull();
    expect(after.stamps?.[5]).toBeNull();
  });

  it("the Helpr's face offers I'm on my way, then I've arrived, on the new day", () => {
    expect(helperFaceNextStep(jobOnContinueDay(job, setDay(), "job_confirmed"), { status: "job_confirmed" } as never)?.key).toBe("on_the_way");
    expect(helperFaceNextStep(jobOnContinueDay(job, setDay(), "on_the_way"), { status: "on_the_way" } as never)?.key).toBe("arrived");
    // Day 1's stamps alone (the bug): no check-in step at all.
    expect(helperFaceNextStep(jobOnContinueDay(job, setDay()), { status: "job_confirmed" } as never)?.key).not.toBe("on_the_way");
  });

  it("the job page passes its tracking row to the tracker and to the Helpr's face", () => {
    const page = blankComments(readFileSync(join(__dirname, "..", "pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    // One computation (size ratchet), with the tracking row, feeding both the face and the tracker.
    const calls = page.match(/jobOnContinueDay\([^)]*\)/g) ?? [];
    expect(calls).toEqual(["jobOnContinueDay(job, continueDay.row, trackingStatus)"]);
    expect(page).toContain("const dayJob = jobOnContinueDay(job, continueDay.row, trackingStatus);");
    expect(page).toContain("hiredHelprFace(dayJob,");
    expect(page).toContain("<JobTracker job={dayJob}");
  });

  it("Q2791: a rail given a continue day and its tracking row (the chat's job card) drops day 1's ticks too", () => {
    const rail = (tracking: { status?: string | null } | null | undefined) =>
      jobProgress(job, { viewer: "poster", otherFirst: "Yusef", tracking, continueDay: setDay() }).stamps ?? [];
    for (const tracking of [{ status: "job_confirmed" }, null]) {
      expect(rail(tracking)[4]).toBeNull();
      expect(rail(tracking)[5]).toBeNull();
    }
    expect(rail({ status: "on_the_way" })[4]).toBe(job.helper_on_the_way_at);
    expect(rail({ status: "on_the_way" })[5]).toBeNull();
    expect(rail({ status: "arrived" })[5]).toBe(job.helper_arrived_at);
    // Home's next-up never reads the tracking row (undefined): unchanged.
    expect(rail(undefined)[5]).toBe(job.helper_arrived_at);
    const helpr = jobProgress(job, { viewer: "helpr", otherFirst: "Lexi", tracking: { status: "job_confirmed" }, continueDay: setDay() });
    expect(helpr.stamps?.[4]).toBeNull();
    expect(helpr.stamps?.[5]).toBeNull();
  });
});
