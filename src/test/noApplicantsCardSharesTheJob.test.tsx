/**
 * F265 (whole-app audit 11-10): "I posted a job and nobody applied. The only button is More options; I expected help
 * getting applicants." The Posted card face with no applicants now shares the job (the same words and link as
 * ShareJobButton, jobShareContent), with "More options" kept as the small link beside it (card critique item 13).
 * Inventory: every no-applicant shape of the card (single job, crew), and the hook's real share wiring.
 *
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts |       return h.share |       return false && h.share
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts |     share: () => void shareNative(jobShareContent(job)), |     share: () => {},
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { shareNative } = vi.hoisted(() => ({ shareNative: vi.fn(async (_c: unknown) => "copied") }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: (c: unknown) => shareNative(c) }));
vi.mock("@/hooks/useHelprTakesTips", () => ({ useHelprTakesTips: () => true }));

import { posterFaceAction, usePosterFaceAction, type PosterFaceHandlers } from "@/pages/posts/postedJobCard/posterFaceAction";
import type { Job } from "@/components/job-card/activityConstants";

const noop = () => {};
const handlers = (share?: () => void): PosterFaceHandlers => ({
  pendingApplicants: 0, helperName: "", confirmingArrival: false, completing: false,
  openApplicants: noop, confirmArrival: noop, approve: noop, review: noop, tip: noop, postAgain: noop, message: noop,
  manage: noop, confirm: noop, noShow: noop, cancel: noop, viewDispute: noop, share, shareLabel: "Share job",
});

describe("F265: a Posted card nobody has applied to offers to share the job", () => {
  beforeEach(() => shareNative.mockClear());

  const shapes = [{ is_group_job: false, helper_id: null }, { is_group_job: true, helper_id: null }];
  it("covers the single and crew shapes", () => {
    expect(shapes.length).toBeGreaterThan(1);
  });

  for (const job of shapes) {
    it(`${job.is_group_job ? "crew" : "single"}: Share job, with More options as the small link`, () => {
      const share = vi.fn();
      const a = posterFaceAction("no_applicants", job, handlers(share));
      expect(a).toMatchObject({ label: "Share job", tone: "secondary", also: { label: "More options" } });
      a.onClick();
      expect(share).toHaveBeenCalledTimes(1);
    });
  }

  it("the card's hook shares this job's public link", () => {
    const job = { id: "job-265", title: "Hang two shelves", budget: 60, category: "handyman", is_group_job: false, helper_id: null, helper_fee_flat_cents: null, helper_fee_percent: null } as unknown as Job;
    const toggle = vi.fn();
    const { result } = renderHook(() => usePosterFaceAction({
      job, wait: "no_applicants", isExpanded: false, helperName: "", pendingApplicants: 0, confirmingArrival: false, completing: false,
      toggle, navigate: noop, onLoadApplications: noop, onConfirmArrival: noop, onReview: noop, onTip: noop, onNoShow: noop, onCancel: noop, onViewDispute: noop,
    }));
    expect(result.current.faceAction.label).toMatch(/^(Share job|Copy job link)$/);
    act(() => result.current.faceAction.onClick());
    expect(shareNative).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://www.louisianahelpr.com/jobs/job-265?ref=share",
      text: expect.stringContaining("Hang two shelves · $60"),
    }));
    expect(toggle).not.toHaveBeenCalled();
    act(() => result.current.faceAction.also!.onClick());
    expect(toggle).toHaveBeenCalledWith("job-265");
  });
});
