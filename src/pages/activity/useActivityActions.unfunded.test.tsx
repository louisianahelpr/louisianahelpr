// Q320 — Accept Job on a job whose escrow is not funded (refunded after the
// offer). The live trigger enforce_job_funded_before_award refuses with 23514
// "This job is not funded yet…". The client used to answer "Couldn't accept the
// job — please try again.", a retry that can never work, and left Accept Job on
// the card to bounce again. It must say why and re-read.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const UNFUNDED = {
  code: "23514",
  message: "This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.",
};
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
const rpcResult = { current: { data: null as unknown, error: null as unknown } };

function chain(result: unknown) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "in", "neq", "order", "limit", "maybeSingle", "single", "update"]) {
    self[m] = () => self;
  }
  self.then = (resolve: (v: unknown) => void) => resolve(result);
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => chain({ data: null, error: UNFUNDED }),
    rpc: async () => rpcResult.current,
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useStripeConnectCheck", () => ({
  useStripeConnectCheck: () => ({ checkHelperAwardEligibility: async () => ({ ok: true }) }),
}));
vi.mock("./activityActions/useOptimisticJobCache", () => ({
  useOptimisticJobCache: () => ({ optimisticallyPatchJob: () => undefined, rollbackActivity: vi.fn() }),
}));
vi.mock("./activityActions/useApplicantsState", () => ({
  useApplicantsState: () => ({
    selectedJob: null, setSelectedJob: vi.fn(),
    applications: [], setApplications: vi.fn(),
    applicationsLoading: false, applicationsError: null,
    inlineApplicants: {}, setInlineApplicants: vi.fn(),
    loadingApplicants: {}, applicantErrors: {},
    loadApplications: vi.fn(), loadInlineApplicants: vi.fn(),
  }),
}));

import { useActivityActions } from "./useActivityActions";
import { UNFUNDED_AWARD_COPY } from "@/lib/awardGate";
import type { Application } from "@/components/activity/activityConstants";

type Args = Parameters<typeof useActivityActions>[0];
const USER = { id: "user-1" } as unknown as Args["user"];

function setup(refresh: () => Promise<void>) {
  return renderHook(() =>
    useActivityActions({ user: USER, postedJobs: [], appliedApps: [], refresh, setStatusFilter: vi.fn() }),
  );
}

describe("Accept Job on an unfunded job (Q320)", () => {
  beforeEach(() => { toastError.mockReset(); rpcResult.current = { data: null, error: null }; });

  it("application accept: says the job is not funded and re-reads, never 'try again'", async () => {
    const refresh = vi.fn(async () => undefined);
    const { result } = setup(refresh);
    const app = { id: "app-1", job_id: "job-1", helper_id: "user-1" } as unknown as Application;
    await act(async () => { await result.current.handleHelperResponse(app, true); });
    expect(toastError).toHaveBeenCalledWith(UNFUNDED_AWARD_COPY);
    expect(toastError).not.toHaveBeenCalledWith("Couldn't accept the job — please try again.");
    expect(refresh).toHaveBeenCalled();
  });

  it("direct offer accept: same refusal, same answer", async () => {
    rpcResult.current = { data: null, error: UNFUNDED };
    const refresh = vi.fn(async () => undefined);
    const { result } = setup(refresh);
    const app = { id: "direct-job-1", job_id: "job-1", helper_id: "user-1", is_direct_offer: true } as unknown as Application;
    await act(async () => { await result.current.handleHelperResponse(app, true); });
    expect(toastError).toHaveBeenCalledWith(UNFUNDED_AWARD_COPY);
    expect(refresh).toHaveBeenCalled();
  });
});

// @mutate src/pages/activity/activityActions/useOfferHandlers.ts | if (isUnfundedAwardRefusal(confirmError)) { | if (false) {
// @mutate src/pages/activity/activityActions/useOfferHandlers.ts | if (isUnfundedAwardRefusal(error)) { | if (false) {
