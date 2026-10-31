/**
 * AUD31-77: after the Helpr marked the job done, the poster's job page said "Check the work and approve" but its
 * only button was "Manage job" (the approve lived on the Posted card). The page's button is now "Approve and
 * release": it asks for the approve (faceActionRequest) and opens the Posted card, whose actions open the approve
 * sheet once on arrival. This file proves the card half; src/pages/jobs/jobPage/JobPage.test.tsx the page half.
 *
 * @mutate src/pages/posts/postedJobCard/PostedJobActions.tsx |     if (!job.poster_completed_at && takeFaceAction(job.id, "approve")) setCompletionSheetOpen(true); |     if (false) setCompletionSheetOpen(true);
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => {
  const build = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "in", "order", "limit", "is", "or", "neq", "gte", "lte", "maybeSingle", "single"]) b[m] = () => b;
    b.then = (res: (v: unknown) => void) => res({ data: [], error: null });
    return b;
  };
  return {
    supabase: {
      from: () => build(),
      auth: { getUser: async () => ({ data: { user: { id: "poster-1" } } }) },
      rpc: () => new Promise(() => {}),
      functions: { invoke: () => new Promise(() => {}) },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null, PhotoProofDialog: () => null, PhotoProofRequirementNote: () => null }));

import { PostedJobActions } from "@/pages/posts/postedJobCard/PostedJobActions";
import { requestFaceAction } from "@/components/job-card/faceActionRequest";

const job = (id: string) => ({
  id, title: "Fence", budget: 100, status: "in_progress", payment_status: "escrow",
  customer_id: "poster-1", helper_id: "helper-1",
  helper_confirmed_at: "2026-10-27T12:00:00Z", poster_confirmed_arrival_at: "2026-10-28T12:30:00Z",
  helper_arrived_at: "2026-10-28T12:30:00Z", helper_completed_at: "2026-10-28T15:00:00Z", poster_completed_at: null,
  proof_before_urls: [], proof_after_urls: [],
}) as never;

function mount(id: string) {
  const noop = vi.fn();
  return render(
    <MemoryRouter>
      <PostedJobActions
        job={job(id)} userId="poster-1" helperNames={{ "helper-1": "Hallie H." }} completedJobMeta={{}}
        onBoost={noop} onEdit={noop} onCancel={noop} onComplete={noop} completingJobId={null}
        onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop} onReport={noop}
        onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
        onConfirmWorking={noop} confirmingWorkingJobId={null} onActionComplete={noop}
      />
    </MemoryRouter>,
  );
}

const sheetOpen = () => screen.queryAllByRole("dialog").length > 0;

beforeEach(cleanup);

describe("the job page's Approve and release opens the Posted card's approve sheet", () => {
  it("a fresh request from the job page opens the sheet on arrival", async () => {
    requestFaceAction("job-a", "approve");
    mount("job-a");
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("no request: the card opens closed (expanding a card never approves by itself)", () => {
    mount("job-b");
    expect(sheetOpen()).toBe(false);
  });

  it("a request for another job does not open this one", () => {
    requestFaceAction("job-c", "approve");
    mount("job-d");
    expect(sheetOpen()).toBe(false);
  });
});
