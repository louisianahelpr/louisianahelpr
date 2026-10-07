// Q997 (owner, 2026-10-07): "when the poster sends the offer, and when the
// Helpr accepts, a pop-up says the payment is held by Louisiana Helpr until the
// job is done." Not on the cards. The Helpr's half is pinned in
// useActivityActions.inFlight.test.tsx; this file pins the pop-up itself and
// the poster's half (a sent offer opens it).
//
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts |     window.setTimeout(() => setPaymentHeldSide("poster"), SUCCESS_MOMENT_LIFETIME_MS + 250); |
// @mutate src/components/job-card/PaymentHeldDialog.tsx | export const PAYMENT_HELD_SENTENCE = "The payment is held by Louisiana Helpr until the job is done."; | export const PAYMENT_HELD_SENTENCE = "";
import { describe, it, expect, vi } from "vitest";
import { render, screen, renderHook, act, waitFor } from "@testing-library/react";

const rpcMock = vi.hoisted(() => vi.fn());
const JOB = vi.hoisted(() => ({
  id: "job-1",
  title: "Hang shelves",
  status: "open",
  date_needed: "2099-01-10",
  start_time: null,
  is_group_job: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "in", "neq", "not", "order", "limit", "maybeSingle", "single", "update"]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 2 });
  return {
    supabase: {
      from: () => chain,
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      rpc: async (name: string, args: unknown) => {
        rpcMock(name, args);
        return { data: null, error: null };
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: vi.fn(), SUCCESS_MOMENT_LIFETIME_MS: 0 }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn(async () => undefined) }));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useStripeConnectCheck", () => ({
  useStripeConnectCheck: () => ({ checkHelperAwardEligibility: async () => ({ ok: true }) }),
}));
vi.mock("./activityActions/useOptimisticJobCache", () => ({
  useOptimisticJobCache: () => ({ optimisticallyPatchJob: () => undefined, rollbackActivity: vi.fn() }),
}));
vi.mock("./activityActions/useApplicantsState", () => ({
  useApplicantsState: () => ({
    selectedJob: JOB, setSelectedJob: vi.fn(),
    applications: [], setApplications: vi.fn(),
    applicationsLoading: false, applicationsError: null,
    inlineApplicants: {}, setInlineApplicants: vi.fn(),
    loadingApplicants: {}, applicantErrors: {},
    loadApplications: vi.fn(), loadInlineApplicants: vi.fn(),
  }),
}));

import { PaymentHeldDialog, PAYMENT_HELD_SENTENCE } from "./PaymentHeldDialog";
import { useActivityActions } from "./useActivityActions";

type Args = Parameters<typeof useActivityActions>[0];

describe("Q997: the 'payment is held' pop-up", () => {
  it("says the owner's sentence, for either side, and closes", () => {
    const onClose = vi.fn();
    const { rerender } = render(<PaymentHeldDialog side="poster" onClose={onClose} />);
    expect(screen.getByText("Offer sent")).toBeInTheDocument();
    expect(screen.getByText(PAYMENT_HELD_SENTENCE)).toBeInTheDocument();
    expect(PAYMENT_HELD_SENTENCE).toBe("The payment is held by Louisiana Helpr until the job is done.");
    rerender(<PaymentHeldDialog side="helpr" onClose={onClose} />);
    expect(screen.getByText("You're booked")).toBeInTheDocument();
    act(() => { screen.getByRole("button", { name: "Got it" }).click(); });
    expect(onClose).toHaveBeenCalled();
    rerender(<PaymentHeldDialog side={null} onClose={onClose} />);
    expect(screen.queryByText(PAYMENT_HELD_SENTENCE)).toBeNull();
  });

  it("a sent offer opens it for the poster", async () => {
    const { result } = renderHook(() =>
      useActivityActions({
        user: { id: "poster-1" } as unknown as Args["user"],
        postedJobs: [],
        appliedApps: [],
        refresh: async () => undefined,
        setStatusFilter: vi.fn(),
      }),
    );
    const app = { id: "app-1", job_id: "job-1", helper_id: "helper-1", profiles: { full_name: "Hal" } };
    await act(async () => { await result.current.acceptApplication(app as never); });
    expect(result.current.paymentHeldSide).toBeNull();
    await act(async () => { await result.current.confirmAcceptWithDeadline(24); });
    expect(rpcMock).toHaveBeenCalledWith("accept_application", expect.objectContaining({ p_application_id: "app-1" }));
    await waitFor(() => expect(result.current.paymentHeldSide).toBe("poster"));
  });
});
