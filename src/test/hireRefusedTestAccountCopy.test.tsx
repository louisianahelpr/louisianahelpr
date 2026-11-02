// Q1755 follow-up (lead 11-02): the App Review account may apply to a real job
// (20261102071213) but is never hired. The refusal comes from a TRIGGER
// (enforce_test_account_off_real_jobs), so no RPC copy table can hold it; the
// poster used to see the raw `test_account_real_job: ...` text or the generic
// "try again". The poster gets plain words and no reason.
//
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts |             ? "This applicant can't be hired. Pick someone else." |             ? null
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts | (/test_account_real_job/.test( | (/test_account_real_job_never/.test(
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const rpcMock = vi.hoisted(() => vi.fn());
const JOB = vi.hoisted(() => ({
  id: "job-1",
  title: "Hang shelves",
  status: "open",
  date_needed: "2099-01-10",
  start_time: null,
  is_group_job: false,
}));
const TRIGGER_MESSAGE = "test_account_real_job: a test account cannot be hired on a real job (Q1755)";

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
        return { data: null, error: { message: TRIGGER_MESSAGE, code: "42501", hint: "Test accounts work only on test (is_seed) jobs." } };
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
vi.mock("@/components/job-card/activityActions/useOptimisticJobCache", () => ({
  useOptimisticJobCache: () => ({ optimisticallyPatchJob: () => undefined, rollbackActivity: vi.fn() }),
}));
vi.mock("@/components/job-card/activityActions/useApplicantsState", () => ({
  useApplicantsState: () => ({
    selectedJob: JOB, setSelectedJob: vi.fn(),
    applications: [], setApplications: vi.fn(),
    applicationsLoading: false, applicationsError: null,
    inlineApplicants: {}, setInlineApplicants: vi.fn(),
    loadingApplicants: {}, applicantErrors: {},
    loadApplications: vi.fn(), loadInlineApplicants: vi.fn(),
  }),
}));

import { useActivityActions } from "@/components/job-card/useActivityActions";

type Args = Parameters<typeof useActivityActions>[0];
const PLAIN = "This applicant can't be hired. Pick someone else.";

async function hire(app: Record<string, unknown>): Promise<string> {
  const { result } = renderHook(() =>
    useActivityActions({
      user: { id: "poster-1" } as unknown as Args["user"],
      postedJobs: [],
      appliedApps: [],
      refresh: async () => undefined,
      setStatusFilter: vi.fn(),
    }),
  );
  await act(async () => { await result.current.acceptApplication(app as never); });
  let message = "";
  await act(async () => {
    try {
      await result.current.confirmAcceptWithDeadline(24);
    } catch (e) {
      message = (e as Error).message;
    }
  });
  return message;
}

describe("Q1755: hiring the store review account is refused in plain words", () => {
  it("the plain hire (accept_application) shows the plain sentence, never the raw code", async () => {
    const message = await hire({ id: "app-1", job_id: "job-1", helper_id: "reviewer-1", profiles: { full_name: "Rev" } });
    expect(rpcMock).toHaveBeenCalledWith("accept_application", expect.objectContaining({ p_application_id: "app-1" }));
    expect(message).toBe(PLAIN);
    expect(message).not.toMatch(/test_account|test account|helper/i);
  });

  it("the hire at a suggested time (accept_application_at_suggested_time) shows it too", async () => {
    rpcMock.mockClear();
    const message = await hire({ id: "app-2", job_id: "job-1", helper_id: "reviewer-1", suggested_date: "2099-01-11", profiles: { full_name: "Rev" } });
    expect(rpcMock).toHaveBeenCalledWith("accept_application_at_suggested_time", expect.objectContaining({ p_application_id: "app-2" }));
    expect(message).toBe(PLAIN);
  });
});
