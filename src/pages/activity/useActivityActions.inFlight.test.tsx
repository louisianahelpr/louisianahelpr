// useActivityActions — synchronous in-flight guards on the two money handlers.
//
// What this prevents: two taps dispatched in the same frame both firing
//   - completeJob            → create-payment { action: "release" }
//   - handleHelperResponse   → the conditional helper_confirmed_at UPDATE
// Both handlers used to guard only with React state (completingJobId /
// respondingHelperAppId), which two calls from one render's closure both read
// as null. Same class and fix as useApplyFlow.test.tsx (27b2e9b86): a ref set
// synchronously before the first await, cleared in `finally`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
const confirmUpdateMock = vi.fn();
const pending: Array<() => void> = [];

// A chainable builder whose terminal await never settles until released, so
// the first call is genuinely still in flight when the second arrives.
function chain(onUpdate: () => void, result: unknown) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "in", "neq", "order", "limit", "maybeSingle", "single"]) {
    self[m] = () => self;
  }
  self.update = () => { onUpdate(); return self; };
  self.then = (resolve: (v: unknown) => void) => { pending.push(() => resolve(result)); };
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => {
        invokeMock(...args);
        return new Promise((resolve) => { pending.push(() => resolve({ data: { bothDone: false }, error: null })); });
      },
    },
    from: () => chain(() => confirmUpdateMock(), { data: [], error: null }),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
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
import type { Application } from "@/components/activity/activityConstants";

type Args = Parameters<typeof useActivityActions>[0];
const USER = { id: "user-1" } as unknown as Args["user"];

function setup() {
  return renderHook(() =>
    useActivityActions({
      user: USER,
      postedJobs: [],
      // Poster side of completeJob: not the helper, so it goes straight to
      // the release invoke without the arrival/proof reads.
      appliedApps: [],
      refresh: async () => undefined,
      setStatusFilter: vi.fn(),
    }),
  );
}

const flush = () => new Promise((r) => setTimeout(r, 20));
const releaseAll = async () => {
  // Draining can enqueue follow-up reads (refresh, perk offer), so repeat.
  await act(async () => { for (let i = 0; i < 10; i++) { while (pending.length) pending.shift()!(); await flush(); } });
};

describe("useActivityActions money handlers — same-frame double tap", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    confirmUpdateMock.mockReset();
    pending.length = 0;
  });

  it("completeJob: two calls in one frame send exactly one release", async () => {
    const { result } = setup();
    const complete = result.current.completeJob;
    act(() => { void complete("job-1"); void complete("job-1"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][1]).toEqual({ body: { action: "release", jobId: "job-1" } });

    // Guard releases on settle: a later, deliberate tap goes through.
    await releaseAll();
    act(() => { void result.current.completeJob("job-1"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  });

  it("handleHelperResponse(accept): two calls in one frame send exactly one confirm", async () => {
    const { result } = setup();
    const respond = result.current.handleHelperResponse;
    const app = { id: "app-1", job_id: "job-1", helper_id: "user-1" } as unknown as Application;
    act(() => { void respond(app, true); void respond(app, true); });
    await waitFor(() => expect(confirmUpdateMock).toHaveBeenCalledTimes(1));
    await flush();
    expect(confirmUpdateMock).toHaveBeenCalledTimes(1);

    await releaseAll();
    act(() => { void result.current.handleHelperResponse(app, true); });
    await waitFor(() => expect(confirmUpdateMock).toHaveBeenCalledTimes(2));
  });
});
