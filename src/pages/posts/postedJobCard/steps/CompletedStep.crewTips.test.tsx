import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { Job } from "@/components/job-card/activityConstants";
import { CompletedStep } from "./CompletedStep";
import type { PosterStepCtx } from "./posterStepContract";

// Q709(c), owner 2026-10-05: on a completed crew card, ONE Tip per member row,
// each showing "Tipped" once that member has been tipped; the tip names the
// member (create-payment refuses a crew tip without one).
// @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |                   onClick={() => onTip(job.id, m.name, m.id)} |                   onClick={() => onTip(job.id, m.name)}
// @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |               {m.tipped ? ( |               {false ? (

const POSTER = "00000000-0000-4000-8000-000000000002";
const A = "00000000-0000-4000-8000-000000000003";
const B = "00000000-0000-4000-8000-000000000004";

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function ctx(job: Job, meta: PosterStepCtx["completedJobMeta"], onTip = vi.fn()): PosterStepCtx {
  return {
    job, userId: POSTER, helperNames: {}, completedJobMeta: meta, completingJobId: null,
    confirmingArrivalJobId: null, confirmingWorkingJobId: null, instantReleaseOn: false, navigate: vi.fn(),
    onBoost: vi.fn(), onEdit: vi.fn(), crewBooked: false, onCancel: vi.fn(), onComplete: vi.fn(), onNoShow: vi.fn(),
    onTip, onReview: vi.fn(), onDispute: vi.fn(), onReport: vi.fn(), onViewDispute: vi.fn(), onConfirmArrival: vi.fn(),
    onConfirmWorking: vi.fn(), onActionComplete: vi.fn(), completionSheetOpen: false, setCompletionSheetOpen: vi.fn(),
    disputeActing: false, resolveConfirmOpen: false, setResolveConfirmOpen: vi.fn(), escalateConfirmOpen: false,
    setEscalateConfirmOpen: vi.fn(), escalateDispute: vi.fn(), resolveDisputeAndRelease: vi.fn(),
  };
}

const crewJob = {
  id: "job-crew", title: "Move a piano", customer_id: POSTER, helper_id: null, is_group_job: true, helpers_needed: 2,
  status: "completed", payment_status: "released", proof_before_urls: [], proof_after_urls: [], date_needed: "2026-10-01",
} as unknown as Job;

describe("CompletedStep: one Tip per crew member", () => {
  it("draws a row per member: Tip for one not yet tipped (naming them), Tipped for one already tipped", () => {
    const onTip = vi.fn();
    wrap(<CompletedStep {...ctx(crewJob, {
      "job-crew": {
        tipped: true, reviewed: false, crewToReview: [],
        crewTips: [{ id: A, name: "Ana B.", tipped: true }, { id: B, name: "Ben C.", tipped: false }],
      },
    }, onTip)} />);
    const list = screen.getByRole("list", { name: "Tip your crew" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const tipped = within(rows[0]).getByRole("button", { name: /Tipped/ });
    expect(tipped).toBeDisabled();
    fireEvent.click(within(rows[1]).getByRole("button", { name: /Tip Ben C\./ }));
    expect(onTip).toHaveBeenCalledWith("job-crew", "Ben C.", B);
  });

  it("a single-Helpr job keeps its one job-level Tip and no member list", () => {
    const single = { ...crewJob, is_group_job: false, helper_id: A } as unknown as Job;
    wrap(<CompletedStep {...ctx(single, { "job-crew": { tipped: false, reviewed: false } })} />);
    expect(screen.queryByRole("list", { name: "Tip your crew" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Tip/ }).length).toBeGreaterThan(0);
  });
});
