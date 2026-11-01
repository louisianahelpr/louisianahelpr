/**
 * A CREW HAS NO JOB-LEVEL NO-SHOW (Jobs audit 10-30, JOBS-4).
 *
 * helper_id is null on a crew, so report_helper_no_show always raises no_helper_assigned. The card still read "Your
 * Helpr never arrived — No-Show?", the tracker put "No-show?" in its second slot, and the face and the chip offered a
 * report the server refuses. A one-Helpr job keeps its no-show.
 *
 * @mutate src/components/job-card/jobStatusLine.ts |       if (job.is_group_job && (job.status === "in_progress" \|\| jobIsOverdue(job))) { |       if (false) {
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx |     !job.is_group_job && // report_helper_no_show refuses a crew: no one helper_id (JOBS-4). |     // removed
 * @mutate src/components/tracker/jobStepFromWait.ts |   crew_overdue: OVERDUE_AT(6), |   crew_overdue: NO_SHOW,
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { POSTER_WAIT, posterStatusLine } from "@/components/job-card/jobStatusLine";
import { POSTER_STEP } from "@/components/tracker/jobStepFromWait";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import type { Job } from "@/components/job-card/activityConstants";

const NOW = new Date("2032-10-30T18:00:00Z");
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });
const crew = (over: Partial<Job>) =>
  ({ id: "j", title: "Move a sectional", status: "in_progress", is_group_job: true, helper_id: null, payment_status: "escrow", start_time: "09:00", ...over }) as Job;
const h = { noShow: vi.fn(), manage: vi.fn(), message: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), review: vi.fn(), tip: vi.fn(), viewDispute: vi.fn(), postAgain: vi.fn(), helperName: "Hallie" };

describe("a crew never gets the job-level no-show", () => {
  it.each([
    ["on its day", "2032-10-30", "crew_underway"],
    ["past its day", "2032-10-25", "crew_overdue"],
  ])("%s the line and the tracker name the crew", (_w, date_needed, id) => {
    const line = posterStatusLine(crew({ date_needed }), 0, NOW);
    expect(line.id).toBe(id);
    expect(POSTER_WAIT[line.id as keyof typeof POSTER_WAIT].detail).toMatch(/crew/);
    expect(line.detail).not.toMatch(/No-Show|Your Helpr/);
    const step = POSTER_STEP[line.id as keyof typeof POSTER_STEP];
    const drawn = typeof step === "function" ? step(crew({ date_needed }) as never, NOW.getTime()) : step;
    expect(drawn.label ?? "").not.toMatch(/No-show/);
    const face = posterFaceAction(line.id as never, crew({ date_needed }), h as never);
    expect(face?.label).toBe("More options");
  });

  it("a one-Helpr job past its day keeps the no-show", () => {
    const line = posterStatusLine(crew({ is_group_job: false, helper_id: "h", helper_confirmed_at: "2032-10-20T00:00:00Z", date_needed: "2032-10-25" }), 0, NOW);
    expect(line.id).toBe("overdue_no_show");
  });

  it("the card's No-Show chip stands down on a crew", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../..", "src/pages/posts/postedJobCard/steps/InProgressStep.tsx"), "utf8"));
    expect(src.length).toBeGreaterThan(500);
    expect(src).toMatch(/const showNoShow =\s*!job\.is_group_job &&/);
  });
});
