/**
 * THE CARD AND THE SHEET NAME THE RELEASE THE SAME WAY, AND NEITHER SAYS "PAY".
 *
 * Audit 2026-10-28 (part 4 final leg, F33; shot p4j-approve-dialog-375.png): the poster's job card
 * said "Approve & Pay — accept the work and release payment" and the sheet it opened said "Confirm
 * and release $40". The poster paid when they posted (or at hire under card hold), so "Pay" names a
 * charge that is not happening, and the two controls for one step used two different verbs.
 *
 * Now both read "Approve and release" (sentence case) from src/lib/releaseCopy.ts; the sheet adds
 * the job price when it is the whole release.
 *
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx | label={job.poster_completed_at ? "Approved" : RELEASE_ACTION} | label={job.poster_completed_at ? "Approved" : "Approve & Pay"}
 * @mutate src/pages/posts/CompletionChoiceSheet.tsx |                   {releaseActionLabel(jobPrice)} |                   {jobPrice ? `Confirm and release $${jobPrice}` : "Confirm and release"}
 * @mutate src/lib/releaseCopy.ts | export const RELEASE_ACTION = "Approve and release"; | export const RELEASE_ACTION = "Approve & Pay";
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { Job } from "@/components/job-card/activityConstants";
import type { PosterStepCtx } from "@/pages/posts/postedJobCard/steps/posterStepContract";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: () => null,
  PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  PhotoProofCaptureChip: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "insert", "update", "upsert", "delete", "gte", "lte", "is", "not", "filter"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
});

import { InProgressStep } from "@/pages/posts/postedJobCard/steps/InProgressStep";
import { CompletionChoiceSheet } from "@/pages/posts/CompletionChoiceSheet";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The poster's card once the Helpr has marked the job done (the approve step). */
function markedDoneCard() {
  const at = new Date(Date.now() - 2 * 3_600_000);
  const job = {
    id: "job-1", title: "Clean the kitchen", description: "", location: "Baton Rouge, LA",
    customer_id: "poster-1", helper_id: "helper-1", budget: 40, category: "cleaning", status: "in_progress",
    date_needed: at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
    start_time: at.toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" }),
    proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"],
    helper_confirmed_at: ago(48), helper_dayof_confirmed_at: ago(30), poster_confirmed_at: ago(47),
    helper_on_the_way_at: ago(3), helper_arrived_at: ago(2.5), poster_confirmed_arrival_at: ago(2.5),
    poster_confirmed_working_at: ago(2), helper_completed_at: ago(0.5),
  } as unknown as Job;
  const ctx: PosterStepCtx = {
    job, userId: "poster-1", helperNames: { "helper-1": "Hallie H." }, completedJobMeta: {},
    completingJobId: null, confirmingArrivalJobId: null,
    confirmingWorkingJobId: null, instantReleaseOn: false, navigate: vi.fn(),
    onBoost: vi.fn(), onEdit: vi.fn(), crewBooked: false, onCancel: vi.fn(), onComplete: vi.fn(),
    onNoShow: vi.fn(), onTip: vi.fn(), onReview: vi.fn(), onDispute: vi.fn(),
    onReport: vi.fn(), onViewDispute: vi.fn(), onConfirmArrival: vi.fn(),
    onConfirmWorking: vi.fn(), onActionComplete: vi.fn(),
    completionSheetOpen: false, setCompletionSheetOpen: vi.fn(),
    disputeActing: false, resolveConfirmOpen: false, setResolveConfirmOpen: vi.fn(),
    escalateConfirmOpen: false, setEscalateConfirmOpen: vi.fn(),
    escalateDispute: vi.fn(), resolveDisputeAndRelease: vi.fn(),
  };
  wrap(<InProgressStep {...ctx} />);
}

function sheet(jobPrice: number | null) {
  wrap(
    <CompletionChoiceSheet open jobId="j" jobTitle="Clean the kitchen" helperId="h" helperName="Hallie" userId="u"
      jobPrice={jobPrice} onClose={() => {}} onConfirm={vi.fn()} onRevisionSubmitted={() => {}} />,
  );
}

describe("the release is named one way on the card and the sheet (F33)", () => {
  it("the card's approve button says 'Approve and release', never 'Pay'", () => {
    markedDoneCard();
    const buttons = screen.getAllByRole("button").filter((b) => /approve|release|pay\b/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
    // Inventory floor: the card draws its approve control in this state.
    expect(buttons.length).toBeGreaterThan(0);
    const approve = screen.getByRole("button", { name: /^Approve and release/ });
    expect(approve.textContent).toContain("Approve and release");
    for (const b of buttons) {
      expect(b.getAttribute("aria-label") ?? "").not.toMatch(/\bpay\b/i);
      expect(b.textContent ?? "").not.toMatch(/\bpay\b/i);
    }
  });

  it("the sheet's commit button uses the same words, with the price when it is the whole release", () => {
    sheet(40);
    expect(screen.getByRole("button", { name: "Approve and release $40" })).toBeTruthy();
    cleanup();
    sheet(null);
    expect(screen.getByRole("button", { name: "Approve and release" })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Confirm and release|Approve & Pay/);
  });
});
