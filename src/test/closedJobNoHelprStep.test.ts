/**
 * Jobs audit 1102b row 1 (Q2587): a Helpr reported as a no-show, or whose job was cancelled on its day after they
 * confirmed, saw a primary "I'm on my way" under "This job was cancelled". hiredHelprFace built the status line with
 * the application hard-coded accepted and never looked at the job's status, so the day-of confirm alone yielded the
 * On my way step. An ended job or a closed application has no step: at most Message.
 *
 * @mutate src/pages/jobs/jobPage/hiredHelprFace.ts |   const step = job.is_group_job \|\| ended ? null : |   const step = job.is_group_job ? null :
 * @mutate src/pages/jobs/jobPage/hiredHelprFace.ts | const ENDED_JOB_STATUSES = new Set(["cancelled", "expired"]); | const ENDED_JOB_STATUSES = new Set(["expired"]);
 * @mutate src/pages/jobs/jobPage/hiredHelprFace.ts |   const ended = ENDED_JOB_STATUSES.has(job.status ?? "") \|\| !!app?.closed_reason \|\| | const ended = ENDED_JOB_STATUSES.has(job.status ?? "") \|\|
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | review: () => setReviewOpen(true), application: myApplication.data }) | review: () => setReviewOpen(true) })
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hiredHelprFace } from "@/pages/jobs/jobPage/hiredHelprFace";
import { blankComments } from "@/test/helpers/blankNonCode";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";

const ME = "11111111-1111-4111-8111-111111111111";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const T = new Date(Date.now() - 3_600_000).toISOString();
const job = (over: Partial<JobPageRow> = {}) => ({
  id: "22222222-2222-4222-8222-222222222222", title: "Rake the yard", status: "accepted", helper_id: ME, customer_id: "33333333-3333-4333-8333-333333333333",
  date_needed: today, start_time: null, is_group_job: false, helper_confirmed_at: T, helper_dayof_confirmed_at: T,
  helper_on_the_way_at: null, helper_arrived_at: null, helper_completed_at: null, payment_status: "held", budget: 120,
  ...over,
}) as unknown as JobPageRow;
const noop = () => {};
const face = (j: JobPageRow, application?: { status: string; closed_reason: string | null } | null) =>
  hiredHelprFace(j, { userId: ME, posterFirst: "Lexi", trackingStatus: null, open: noop, message: noop, application });

describe("an ended job or a closed application offers the Helpr no tracker step (Q2587)", () => {
  it("a live confirmed job on its day still offers I'm on my way (the control)", () => {
    expect(face(job(), { status: "accepted", closed_reason: null })?.step).toBe("on_the_way");
  });

  it("a job cancelled on its day after the Helpr confirmed: no step, never On my way", () => {
    const f = face(job({ status: "cancelled", cancelled_by: "33333333-3333-4333-8333-333333333333" } as Partial<JobPageRow>), { status: "accepted", closed_reason: null });
    expect(f?.step).toBeUndefined();
    expect(f?.label).not.toMatch(/on my way/i);
  });

  it("a no-show report (the application closed no_show), whatever the job row says: no step", () => {
    for (const status of ["cancelled", "accepted", "open"]) {
      const f = face(job({ status } as Partial<JobPageRow>), { status: "rejected", closed_reason: "no_show" });
      expect(f?.step, status).toBeUndefined();
      expect(f?.label ?? "", status).not.toMatch(/on my way/i);
    }
  });

  it("the page passes the Helpr's own application row in", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    expect(src).toMatch(/hiredHelprFace\(job, \{[^}]*application: myApplication\.data/);
  });
});
