/**
 * CONFIRM NO-SHOW WORKS FROM THE JOB PAGE'S MANAGE JOB (audit 2026-10-29 A2-B13).
 *
 * The bug, on prod (AA9 chunk 1a): /jobs?highlight=<id>&manage=1&tab=posted, Confirm No-Show -> "We couldn't find
 * the Helpr on this job". handleNoShow (useLifecycleHandlers.ts) looked the job up in `postedJobs` and refused
 * before the RPC when it was not there; from the plain Posted list it worked.
 * The fix: the RPC is the authority. It runs whatever the list holds, the server refuses a job with no Helpr, and the
 * notice goes to the helper_id the RPC returns. Since 20261108202000 (Jobs audit 11-08 #7) the RPC writes that notice
 * itself, so the client sends none (a second one would be a duplicate the server drops).
 *
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |       const { data: rpcData, error: rpcError } = await supabase.rpc("report_helper_no_show", { |       if (!postedJobs.some((j) => j.id === jobId)) { toast.error("We couldn't find the Helpr on this job — pull to refresh and try again."); return; }\n      const { data: rpcData, error: rpcError } = await supabase.rpc("report_helper_no_show", {
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |       const { action: actionTaken = "warning" } = (rpcData ?? {}) as { action?: string }; |       const { action: actionTaken = "warning", helper_id: helperId } = (rpcData ?? {}) as { action?: string; helper_id?: string };\n      if (helperId) await notifyJobParty({ user_id: helperId, job_id: jobId, template: "no_show_reported" });
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const rpcMock = vi.fn();
const notifyMock = vi.fn();
const toastError = vi.fn();

function chain(result: unknown = { data: [], error: null }) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "in", "neq", "order", "limit", "update"]) self[m] = () => self;
  self.single = () => Promise.resolve({ data: null, error: null });
  self.maybeSingle = () => Promise.resolve({ data: null, error: null });
  self.then = (resolve: (v: unknown) => void) => { resolve(result); };
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    from: () => chain(),
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));
vi.mock("@/lib/toastPolicy", () => ({ confirmConsequential: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: vi.fn() }));
vi.mock("@/lib/celebrate", () => ({ maybeCelebrate: () => Promise.resolve() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: (...a: unknown[]) => notifyMock(...a) }));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useStripeConnectCheck", () => ({ useStripeConnectCheck: () => ({ checkHelperAwardEligibility: async () => ({ ok: true }) }) }));
vi.mock("@/components/job-card/activityActions/useOptimisticJobCache", () => ({
  useOptimisticJobCache: () => ({ optimisticallyPatchJob: () => undefined, rollbackActivity: vi.fn() }),
}));
vi.mock("@/components/job-card/activityActions/useApplicantsState", () => ({
  useApplicantsState: () => ({
    selectedJob: null, setSelectedJob: vi.fn(), applications: [], setApplications: vi.fn(), applicationsLoading: false,
    applicationsError: null, inlineApplicants: {}, setInlineApplicants: vi.fn(), loadingApplicants: {}, applicantErrors: {},
    loadApplications: vi.fn(), loadInlineApplicants: vi.fn(),
  }),
}));

import { useActivityActions } from "@/components/job-card/useActivityActions";

const USER = { id: "poster-1" } as unknown as Parameters<typeof useActivityActions>[0]["user"];

function setup() {
  return renderHook(() =>
    useActivityActions({
      user: USER,
      // The job page's Manage job: the job is NOT in the list this hook was given.
      postedJobs: [],
      appliedApps: [],
      refresh: async () => undefined,
      setStatusFilter: vi.fn(),
      helperNames: {},
      completedJobMeta: {},
    }),
  );
}

describe("Confirm No-Show from the job page (A2-B13)", () => {
  beforeEach(() => { rpcMock.mockReset(); notifyMock.mockReset(); toastError.mockReset(); });

  it("a job missing from the Posted list still reaches the server; the client sends no notice of its own", async () => {
    rpcMock.mockResolvedValue({ data: { action: "warning", prior_count: 0, helper_id: "eli-1", job_title: "Mow" }, error: null });
    const { result } = setup();
    await act(async () => { await result.current.handleNoShow("job-1"); });
    expect(rpcMock).toHaveBeenCalledWith("report_helper_no_show", { p_job_id: "job-1" });
    expect(toastError).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("a job with no Helpr is refused by the server in its own words, and no notice goes out", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "no_helper_assigned", code: "P0001" } });
    const { result } = setup();
    await act(async () => { await result.current.handleNoShow("job-1"); });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toBe("No Helpr has been assigned to this job yet.");
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
