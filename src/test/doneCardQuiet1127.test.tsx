/**
 * Polish audit 11-27 #111 (~/.lh-shots/polish-audit-1127/jobs/combo-map-done.png): every card in Posted > Done drew
 * the full, all-green tracker under "Finished Fri, Nov 27 at 9:22 AM" plus a filled green "Leave a review", so a list
 * of finished jobs read like a list of jobs that need you. Now a finished card (every step done, stage 8) draws no
 * bar, as a cancelled one already does not (A2-L19), and "Leave a review" is an outline button, still shown only
 * until the review is left (owesReview / done_review_open, unchanged).
 *
 * The progress states come from the real jobProgress(), so a change to what a finished job's stage is shows here.
 *
 * @mutate src/components/job-card/MineJobFace.tsx | progress.tone !== "cancelled" && progress.stage < 8 && ( | progress.tone !== "cancelled" && (
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts | return { label: "Leave a review", onClick: h.review, tone: "secondary" }; | return { label: "Leave a review", onClick: h.review, tone: "primary" };
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts | return { label: "Leave a review", onClick: () => s.review(posterId), tone: "secondary" }; | return { label: "Leave a review", onClick: () => s.review(posterId), tone: "primary" };
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MineJobFace } from "@/components/job-card/MineJobFace";
import { jobProgress, type JobProgressState, type ProgressJob } from "@/components/tracker/jobProgressState";
import { posterFaceAction, type PosterFaceHandlers } from "@/pages/posts/postedJobCard/posterFaceAction";
import { helperFaceAction } from "@/pages/jobs/appliedJobCard/helperFaceAction";

const NOW = new Date("2037-10-21T15:00:00Z");
const base: ProgressJob = { status: "open", helper_id: null, payment_status: "unpaid" };
const poster = (j: Partial<ProgressJob>) => jobProgress({ ...base, ...j }, { viewer: "poster", otherFirst: "Jolie", now: NOW });

const FINISHED: Partial<ProgressJob> = {
  status: "completed",
  helper_id: "h1",
  payment_status: "released",
  poster_completed_at: "2037-10-20T15:22:00Z",
  completed_at: "2037-10-20T15:22:00Z",
} as Partial<ProgressJob>;

const face = (progress: JobProgressState) =>
  render(
    <MemoryRouter>
      <MineJobFace jobId="j1" title="Mow two lawns" category="yard_work" photo={null} when="Fri, Oct 30" status={<span>Finished</span>} money="$25" action={null} progress={progress} />
    </MemoryRouter>,
  );

const handlers = (): PosterFaceHandlers => {
  const f = vi.fn();
  return { pendingApplicants: 0, helperName: "Hallie H.", confirmingArrival: false, completing: false, openApplicants: f, confirmArrival: f, approve: f, review: f, tip: f, postAgain: f, message: f, manage: f, confirm: f, noShow: f, cancel: f, viewDispute: f } as unknown as PosterFaceHandlers;
};

describe("a finished card is quiet: no full bar, the review an outline button", () => {
  it("inventory: a finished job is stage 8 (every step done) on the path, the state that drew the full bar", () => {
    const p = poster(FINISHED);
    expect({ stage: p.stage, tone: p.tone }).toEqual({ stage: 8, tone: "progress" });
  });

  it("a finished card draws no tracker", () => {
    const { container } = face(poster(FINISHED));
    expect(container.querySelector("[data-mine-face-progress]")).toBeNull();
  });

  it("a job still on the path keeps its bar (the fix is not 'never draw it')", () => {
    const p = poster({ status: "open" });
    expect(p.stage).not.toBeNull();
    expect(p.stage).toBeLessThan(8);
    const { container } = face(p);
    expect(container.querySelector("[data-mine-face-progress]")).not.toBeNull();
  });

  it("poster: Leave a review is the outline (secondary) button, on both review-open waits", () => {
    const waits = ["done_review_open", "done_both_open"] as const;
    expect(waits.length).toBeGreaterThan(1);
    for (const w of waits) {
      const a = posterFaceAction(w, { is_group_job: false, helper_id: "h1" }, handlers());
      expect({ w, label: a?.label, tone: a?.tone }).toEqual({ w, label: "Leave a review", tone: "secondary" });
    }
  });

  it("Helpr: Leave a review is the outline (secondary) button, only while a review is owed", () => {
    const s = { review: vi.fn(), manage: vi.fn(), isMinimalCard: false, isOffered: false, posterId: "p1" };
    const owed = helperFaceAction({ ...s, owesReview: true });
    expect({ label: owed?.label, tone: owed?.tone }).toEqual({ label: "Leave a review", tone: "secondary" });
    expect(helperFaceAction({ ...s, owesReview: false })?.label).not.toBe("Leave a review");
  });
});
