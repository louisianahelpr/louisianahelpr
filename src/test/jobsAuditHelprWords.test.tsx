/**
 * Jobs audit 10-30, the small words and states that told a member something untrue.
 *
 * JOBS-13: a Helpr cancelling more than 24 hours ahead was told it was a strike; helper_cancel_booking returns
 * { action: "none" } there.
 * JOBS3-48: arrived and not started, the open card said "Mark it done when you finish" above Start working.
 * JOBS-22: the Posted card's bar said "Pick your Helpr" over "No applicants yet".
 * JOBS3-49: "Couldn't send: Couldn't send the offer".
 * JOBS3-51: Hire's spoken name was "Select Hallie H. — payout setup not finished yet".
 * JOBS-17: the job page's Apply skipped the under-18 grey-out (the page's own test presses it: JobPage.test.tsx).
 * JOBS2-40: "You've crossed $1,000" counted money still "Coming to you".
 * JOBS-20: a restored draft silently lost its photos. JOBS-10: a copied job said nothing. JOBS3-52: the before photo
 * sheet said nothing. JOBS-27: crew lines still said every spot had to be filled.
 *
 * @mutate src/pages/jobs/appliedJobCard/helperCancelCopy.ts |   if (action === "none") return "Job cancelled. No strike: the start was more than 24 hours away."; |
 * @mutate src/pages/jobs/appliedJobCard/helperCancelCopy.ts |   if (start && start.getTime() - nowMs >= DAY_MS) { |   if (false) {
 * @mutate src/components/tracker/workHasBegun.ts | export const HELPR_NOT_STARTED: ReadonlySet<string> = new Set<string>(["start_working", "before_photo"]); | export const HELPR_NOT_STARTED: ReadonlySet<string> = new Set<string>([]);
 * @mutate src/pages/posts/PostedJobCard.tsx | , pendingApplicants: pendingApplicantCounts ? pendingApplicantCounts[job.id] ?? 0 : undefined }) | })
 * @mutate src/components/profile/EarningsTab.tsx |     totalEarningsDollars: paidOutDollars(payoutLedger), |     totalEarningsDollars: 5000,
 * @mutate src/pages/post-job/EntryChoice.tsx | A draft keeps your words, so add your photos and video again. |
 * @mutate src/pages/post-job/FormStep.tsx | We copied your last job. Add your photos again, and check the crew size, start time and repeat days. |
 * @mutate src/components/PhotoProof.tsx | Show the job as you found it, before you start. These are your proof if there's ever a question. |
 * @mutate src/pages/jobs/appliedJobCard/crewAcceptCopy.ts | You can head out once the job is booked. At the start time | You can head out once every spot on the crew is filled. At the start time
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx |         aria-label={`Hire ${helperName}`} |         aria-label={`Select ${helperName}`}
 * @mutate src/components/ResponseDeadlineDialog.tsx |                   {/^couldn't send/i.test(errorMessage) ? errorMessage : "Couldn't send:"} |                   Couldn't send:
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { helperCancelCallout, helperCancelToast } from "@/pages/jobs/appliedJobCard/helperCancelCopy";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { paidOutDollars } from "@/components/profile/earningsTab/earningsTabHelpers";
import { CREW_ACCEPT_COPY } from "@/pages/jobs/appliedJobCard/crewAcceptCopy";

const code = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));
const NOW = new Date("2026-10-30T18:00:00Z");

describe("a Helpr's cancel says what it costs (JOBS-13)", () => {
  it("more than 24 hours ahead: no strike, before and after the tap", () => {
    const text = helperCancelCallout("2026-11-05", "09:00", NOW.getTime());
    expect(text).toMatch(/isn't a strike/);
    expect(helperCancelToast("none")).toMatch(/No strike/);
  });
  it("inside 24 hours, or with no date to measure from: the strike and the ladder", () => {
    expect(helperCancelCallout("2026-10-31", "09:00", NOW.getTime())).toMatch(/counts as a reliability strike/);
    expect(helperCancelCallout(null, null, NOW.getTime())).toMatch(/counts as a reliability strike/);
    expect(helperCancelToast("warning")).toMatch(/final warning/);
    expect(helperCancelToast(undefined)).toMatch(/reliability strike/);
  });
});

describe("the open card's tracker line (JOBS3-48)", () => {
  it("arrived, not started: the Helpr's line is the card's, not Mark it done", () => {
    const job = {
      id: "j", status: "in_progress", helper_id: "h", date_needed: "2032-10-30", start_time: "09:00",
      helper_confirmed_at: "2032-10-20T00:00:00Z", helper_dayof_confirmed_at: "2032-10-29T00:00:00Z", poster_confirmed_at: "2032-10-29T00:00:00Z",
      helper_on_the_way_at: "2032-10-30T14:00:00Z", helper_arrived_at: "2032-10-30T14:30:00Z", helper_arrival_verified_at: "2032-10-30T14:30:00Z",
    };
    const line = { id: "start_working", detail: "Tap Start working" };
    const p = jobProgress(job as never, { viewer: "helpr", now: new Date("2032-10-30T18:00:00Z"), card: { line, face: { tone: "primary", step: "working" } } as never });
    expect(p.next).toBe("Tap Start working");
  });
});

describe("the earnings milestone counts money that went out (JOBS2-40)", () => {
  it("transfers count, failed ones do not, and a reversal keeps only what was not taken back", () => {
    expect(paidOutDollars([])).toBe(0);
    expect(paidOutDollars([
      { job_id: "a", amount_cents: 90000, status: "paid" },
      { job_id: "b", amount_cents: 5000, status: "failed" },
      { job_id: "c", amount_cents: 10000, status: "reversed", metadata: { amount_reversed_cents: 4000 } },
    ] as never)).toBe(960);
    expect(code("src/components/profile/EarningsTab.tsx")).toContain("totalEarningsDollars: paidOutDollars(payoutLedger)");
  });
});

describe("source-level words", () => {
  it("say what was not kept, and a crew goes ahead with who's on (JOBS-10, 20, 27, 52)", () => {
    expect(code("src/pages/post-job/EntryChoice.tsx")).toContain("add your photos and video again");
    expect(code("src/pages/post-job/FormStep.tsx")).toContain("We copied your last job.");
    expect(code("src/components/PhotoProof.tsx")).toContain("Show the job as you found it");
    expect(CREW_ACCEPT_COPY.onCrewWaiting).not.toMatch(/every spot/);
    expect(code("src/lib/lifecycleErrors.ts")).not.toMatch(/once every spot on the crew is filled/);
  });
  it("the Posted card's bar knows how many applicants wait (JOBS-22)", () => {
    expect(code("src/pages/posts/PostedJobCard.tsx")).toContain("pendingApplicants: pendingApplicantCounts ? pendingApplicantCounts[job.id] ?? 0 : undefined");
  });
  it("Hire's spoken name starts with Hire (JOBS3-51)", () => {
    expect(code("src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx")).toContain("aria-label={`Hire ${helperName}`}");
  });
  it("a failed send says Couldn't send once (JOBS3-49)", () => {
    expect(code("src/components/ResponseDeadlineDialog.tsx")).toMatch(/\^couldn't send\/i\.test\(errorMessage\) \? errorMessage/);
  });
});
