/**
 * A3-8 (audit 11-01): AT DONE, THE POSTER'S "NOT RIGHT" IS NOT HIDDEN BEHIND APPROVE.
 *
 * The job page row read "Message | Approve" and the Posted card "Approve and release"; "Something's not right" was
 * only inside the approve sheet, so an unhappy poster had to tap Approve to complain. Lead 11-01 (option b): the pair
 * stays Message | Approve (owner 12:49 PM), and "Something's not right" is a visible text button under it, on the job
 * page (JobPage.test.tsx "A3-8") and under the Posted card's Approve (here), opening the same sheet at the fix form.
 *
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts |         ...(h.notRight ? { under: { label: NOT_RIGHT_LABEL, onClick: h.notRight } } : {}), |
 * @mutate src/components/job-card/MineJobFace.tsx |             action.under?.onClick(); |
 * @mutate src/components/job-card/MineJobFace.tsx |       {action?.under && ( |       {false && action?.under && (
 * @mutate src/pages/posts/CompletionChoiceSheet.tsx |     if (open) setMode(startMode); |     if (open) setMode("choice");
 * @mutate src/pages/posts/postedJobCard/PostedJobActions.tsx |     if (revisionRequest > 0 && !job.poster_completed_at) { setCompletionStartMode("revision"); setSheetOpen(true); } |     if (revisionRequest > 0 && !job.poster_completed_at) { setSheetOpen(true); }
 * @mutate src/pages/posts/postedJobCard/PostedJobActions.tsx |     if (!o) setCompletionStartMode("choice"); |
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts |       setRevisionRequest((n) => n + 1); |       setCompletionRequest((n) => n + 1);
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyJobParty: vi.fn() }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn() }));
vi.mock("@/hooks/useHelprTakesTips", () => ({ useHelprTakesTips: () => true }));

import { CompletionChoiceSheet } from "@/pages/posts/CompletionChoiceSheet";
import { posterFaceAction, usePosterFaceAction, type PosterFaceHandlers } from "@/pages/posts/postedJobCard/posterFaceAction";
import { MineJobFace } from "@/components/job-card/MineJobFace";
import { NOT_RIGHT_LABEL } from "@/lib/releaseCopy";
import type { Job } from "@/components/job-card/activityConstants";

afterEach(cleanup);

const job = { id: "j", status: "in_progress", helper_id: "h", customer_id: "p", helper_completed_at: "2037-10-21T15:00:00Z" } as unknown as Job;
const noop = () => {};
const handlers = (over: Partial<PosterFaceHandlers> = {}): PosterFaceHandlers => ({
  pendingApplicants: 0, helperName: "Yusef H.", confirmingArrival: false, completing: false, openApplicants: noop, confirmArrival: noop,
  approve: noop, review: noop, tip: noop, postAgain: noop, message: noop, manage: noop, confirm: noop, noShow: noop, cancel: noop, viewDispute: noop,
  ...over,
});

const sheet = (startMode?: "choice" | "revision") => (
  <CompletionChoiceSheet open jobId="j" jobTitle="Mow two lawns" helperId="h" helperName="Yusef" userId="p"
    onClose={noop} onConfirm={noop} onRevisionSubmitted={noop} startMode={startMode} />
);

describe("A3-8: Something's not right beside Approve", () => {
  it("the Posted card's Approve carries the complaint as its own visible text button", () => {
    const notRight = vi.fn();
    const a = posterFaceAction("approve", job, handlers({ notRight }));
    expect(a).toMatchObject({ label: "Approve and release", tone: "primary", under: { label: NOT_RIGHT_LABEL } });
    a.under!.onClick();
    expect(notRight).toHaveBeenCalledTimes(1);
    // Only at the approve step: a waiting card has no complaint button.
    expect(posterFaceAction("on_the_way", job, handlers({ notRight })).under).toBeUndefined();
  });

  it("the card face draws it under the button, and a tap runs it (not the face's open)", () => {
    const notRight = vi.fn();
    const onOpen = vi.fn();
    render(
      <MemoryRouter>
        <MineJobFace jobId="j" title="Mow two lawns" onOpen={onOpen}
          action={{ label: "Approve and release", onClick: noop, tone: "primary", under: { label: NOT_RIGHT_LABEL, onClick: notRight } }} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: NOT_RIGHT_LABEL }));
    expect(notRight).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("the face's tap asks the card for the sheet at the fix form (revisionRequest), never the Approve request", () => {
    const toggle = vi.fn();
    const { result } = renderHook(() => usePosterFaceAction({
      job, wait: "approve", isExpanded: false, helperName: "Yusef H.", pendingApplicants: 0, confirmingArrival: false, completing: false,
      toggle, navigate: noop, onLoadApplications: noop, onConfirmArrival: noop, onReview: noop, onTip: noop, onNoShow: noop, onCancel: noop, onViewDispute: noop,
    }));
    act(() => result.current.faceAction.under!.onClick());
    expect(result.current).toMatchObject({ revisionRequest: 1, completionRequest: 0 });
    expect(toggle).toHaveBeenCalledWith("j");
  });

  it("the approve sheet opens at the fix form when asked, and at the choice otherwise", async () => {
    render(sheet("revision"));
    await waitFor(() => expect(screen.getByText("What needs to be fixed?")).toBeTruthy());
    expect(screen.queryByText("Yusef says it's done")).toBeNull();
    cleanup();
    render(sheet());
    expect(screen.getByText("Yusef says it's done")).toBeTruthy();
    expect(screen.queryByText("What needs to be fixed?")).toBeNull();
  });

  it("the card's actions route the two requests to the two openings, and a close resets to the choice", () => {
    const src = readFileSync(resolve(__dirname, "../pages/posts/postedJobCard/PostedJobActions.tsx"), "utf8");
    expect(src).toMatch(/revisionRequest > 0 && !job\.poster_completed_at\) \{ setCompletionStartMode\("revision"\); setSheetOpen\(true\); \}/);
    expect(src).toMatch(/completionRequest > 0 && !job\.poster_completed_at\) \{ setCompletionStartMode\("choice"\); setSheetOpen\(true\); \}/);
    expect(src).toMatch(/if \(!o\) setCompletionStartMode\("choice"\);/);
    const flows = readFileSync(resolve(__dirname, "../pages/jobs/jobPage/usePosterPageFlows.tsx"), "utf8");
    expect(flows).toMatch(/revisionRequest=\{revisionRequest\}/);
    expect(flows).toMatch(/notRight: \(\) => setRevisionRequest\(\(n\) => n \+ 1\)/);
  });
});
