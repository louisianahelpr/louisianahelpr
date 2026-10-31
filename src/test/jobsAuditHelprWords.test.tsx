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
 *
 * @mutate src/pages/jobs/appliedJobCard/helperCancelCopy.ts |   if (action === "none") return "Job cancelled. No strike: it was more than 24 hours before the start."; |
 * @mutate src/pages/jobs/appliedJobCard/helperCancelCopy.ts |   if (start && start.getTime() - nowMs >= DAY_MS) { |   if (false) {
 * @mutate src/components/tracker/jobProgressState.ts | const HELPR_NOT_STARTED = new Set<string>(["start_working", "before_photo"]); | const HELPR_NOT_STARTED = new Set<string>([]);
 * @mutate src/pages/posts/PostedJobCard.tsx | , pendingApplicants: pendingApplicantCounts ? pendingApplicantCounts[job.id] ?? 0 : undefined }) | })
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx |         aria-label={`Hire ${helperName}`} |         aria-label={`Select ${helperName}`}
 * @mutate src/components/ResponseDeadlineDialog.tsx |                   {/^couldn't send/i.test(errorMessage) ? errorMessage : "Couldn't send:"} |                   Couldn't send:
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { helperCancelCallout, helperCancelToast } from "@/pages/jobs/appliedJobCard/helperCancelCopy";
import { jobProgress } from "@/components/tracker/jobProgressState";

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
      id: "j", status: "in_progress", helper_id: "h", date_needed: "2026-10-30", start_time: "09:00",
      helper_confirmed_at: "2026-10-20T00:00:00Z", helper_dayof_confirmed_at: "2026-10-29T00:00:00Z", poster_confirmed_at: "2026-10-29T00:00:00Z",
      helper_on_the_way_at: "2026-10-30T14:00:00Z", helper_arrived_at: "2026-10-30T14:30:00Z", helper_arrival_verified_at: "2026-10-30T14:30:00Z",
    };
    const line = { id: "start_working", detail: "Tap Start working" };
    const p = jobProgress(job as never, { viewer: "helpr", now: NOW, card: { line, face: { tone: "primary", step: "working" } } as never });
    expect(p.next).toBe("Tap Start working");
  });
});

describe("source-level words", () => {
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
