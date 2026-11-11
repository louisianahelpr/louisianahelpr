import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Job } from "@/components/job-card/activityConstants";
import type { PosterStepCtx } from "./posterStepContract";
import { openMore } from "@/test/helpers/openMore";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/**
 * F278 (audit 11-10): on a paid, reviewed job the poster's More options showed a DISABLED "Reviewed" chip, a status
 * with nothing behind it, and the poster could not see the review they left. Now it is "See your review", a working
 * control that opens their own review read-only (stars, words, and whether the Helpr can see it yet).
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |                 onClick={() => setReviewOpen(true)} |                 onClick={() => {}}
 */

vi.mock("@/hooks/useHelprTakesTips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useHelprTakesTips")>()),
  useHelprTakesTips: () => null,
}));

const POSTER = "00000000-0000-4000-8000-000000000002";
const HELPR = "00000000-0000-4000-8000-000000000003";
const filters: Array<[string, unknown]> = [];
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => { filters.push([col, val]); return chain; },
    order: async () => ({
      data: [{ id: "r1", rating: 4, feedback: "Shelves are level", tags: ["On time"], reviewee_id: HELPR, feedback_visible_at: null }],
      error: null,
    }),
  };
  return { supabase: { from: () => chain } };
});

const { CompletedStep } = await import("./CompletedStep");

function ctx(job: Job): PosterStepCtx {
  return {
    job, userId: POSTER, helperNames: { [HELPR]: "Hallie" }, completedJobMeta: { [job.id]: { tipped: true, reviewed: true } },
    completingJobId: null, confirmingArrivalJobId: null, confirmingWorkingJobId: null, instantReleaseOn: false,
    navigate: vi.fn(), onBoost: vi.fn(), onEdit: vi.fn(), crewBooked: false, onCancel: vi.fn(), onComplete: vi.fn(),
    onNoShow: vi.fn(), onTip: vi.fn(), onReview: vi.fn(), onDispute: vi.fn(), onReport: vi.fn(), onViewDispute: vi.fn(),
    onConfirmArrival: vi.fn(), onConfirmWorking: vi.fn(), onActionComplete: vi.fn(), completionSheetOpen: false,
    setCompletionSheetOpen: vi.fn(), disputeActing: false, resolveConfirmOpen: false, setResolveConfirmOpen: vi.fn(),
    escalateConfirmOpen: false, setEscalateConfirmOpen: vi.fn(), escalateDispute: vi.fn(), resolveDisputeAndRelease: vi.fn(),
  };
}

const job = {
  id: "job-1", title: "Hang three shelves", customer_id: POSTER, helper_id: HELPR, is_group_job: false,
  status: "completed", payment_status: "released", proof_before_urls: [], proof_after_urls: [], date_needed: jobLocalDateISO(-9),
} as unknown as Job;

describe("F278: the poster sees the review they left", () => {
  it("More options offers 'See your review' (not a disabled 'Reviewed'), and it opens the review read-only", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><CompletedStep {...ctx(job)} /></MemoryRouter>
      </QueryClientProvider>,
    );
    await openMore();
    expect(screen.queryByRole("button", { name: /^Reviewed\b/ })).toBeNull();
    const see = screen.getByRole("button", { name: /^See your review — read the review you left for Hallie/ });
    expect(see).not.toBeDisabled();
    await act(async () => { fireEvent.click(see); });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Your review");
    expect(await screen.findByText("Shelves are level, On time")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "4 out of 5 stars" })).toBeInTheDocument();
    expect(screen.getByText("For Hallie")).toBeInTheDocument();
    expect(screen.getByText("Not shown to Hallie yet.")).toBeInTheDocument();
    // Read-only: nothing in it edits or resubmits the review.
    expect(screen.queryByRole("textbox")).toBeNull();
    // It reads only the signed-in member's own review on this job.
    expect(filters).toContainEqual(["job_id", "job-1"]);
    expect(filters).toContainEqual(["reviewer_id", POSTER]);
  });
});
