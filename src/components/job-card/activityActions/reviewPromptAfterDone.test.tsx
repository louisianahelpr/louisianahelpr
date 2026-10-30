/**
 * UX-7 (owner-approved 2026-10-29: "Review prompts right after I got it / Mark done"), the Jobs half.
 *
 * Before: only the poster's "I got it" opened the review prompt (CompletionPrompts), and not at all once
 * they had tipped; the Helpr whose Mark done finished the job got no prompt and had to find Review on the
 * card later. The reviews INSERT policy accepts a review only once the job is completed and released,
 * which is the moment create-payment answers bothDone, so that is when both sides are prompted.
 *
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |           const doneJob = app?.job; |           const doneJob = app ? undefined : undefined;
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |               revieweeId: doneJob.customer_id, |               revieweeId: doneJob.helper_id ?? "",
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |               tipped: completedJobMeta[jobId]?.tipped === true, |               tipped: false,
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
const pending: Array<() => void> = [];
// The Helpr's Mark done re-reads arrival and photo proof first: give it a job that passes both.
const ARRIVED = vi.hoisted(() => ({
  helper_arrived_at: "2026-10-29T10:00:00Z",
  helper_arrival_verified_at: "2026-10-29T10:00:00Z",
  poster_confirmed_arrival_at: "2026-10-29T10:01:00Z",
  helper_arrival_near_miss_at: null,
  proof_before_urls: ["b.jpg"],
  proof_after_urls: ["a.jpg"],
}));

function chain(result: unknown = { data: [], error: null }) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "in", "neq", "order", "limit", "update"]) {
    self[m] = () => self;
  }
  self.single = () => Promise.resolve({ data: ARRIVED, error: null });
  self.maybeSingle = () => Promise.resolve({ data: null, error: null });
  self.then = (resolve: (v: unknown) => void) => { resolve(result); };
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => {
        invokeMock(...args);
        return new Promise((resolve) => { pending.push(() => resolve(invokeMock.mock.results[invokeMock.mock.calls.length - 1]?.value)); });
      },
    },
    from: () => chain(),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: vi.fn() }));
vi.mock("@/lib/celebrate", () => ({ maybeCelebrate: () => Promise.resolve() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useStripeConnectCheck", () => ({
  useStripeConnectCheck: () => ({ checkHelperAwardEligibility: async () => ({ ok: true }) }),
}));
vi.mock("./useOptimisticJobCache", () => ({
  useOptimisticJobCache: () => ({ optimisticallyPatchJob: () => undefined, rollbackActivity: vi.fn() }),
}));
vi.mock("./useApplicantsState", () => ({
  useApplicantsState: () => ({
    selectedJob: null, setSelectedJob: vi.fn(),
    applications: [], setApplications: vi.fn(),
    applicationsLoading: false, applicationsError: null,
    inlineApplicants: {}, setInlineApplicants: vi.fn(),
    loadingApplicants: {}, applicantErrors: {},
    loadApplications: vi.fn(), loadInlineApplicants: vi.fn(),
  }),
}));

import { useActivityActions } from "../useActivityActions";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

const POSTED_JOB = { id: "job-1", helper_id: "helper-1", customer_id: "poster-1" } as unknown as Job;
const HELPED_JOB = { id: "job-2", helper_id: "helper-1", customer_id: "poster-9", status: "in_progress" } as unknown as Job;
const APP = { job_id: "job-2", helper_id: "helper-1", job: HELPED_JOB, posterName: "Pat P." } as unknown as AppliedApp;

function setup(userId: "poster-1" | "helper-1", opts: { tipped?: boolean } = {}) {
  return renderHook(() =>
    useActivityActions({
      user: { id: userId } as unknown as Parameters<typeof useActivityActions>[0]["user"],
      postedJobs: userId === "poster-1" ? [POSTED_JOB] : [],
      appliedApps: userId === "helper-1" ? [APP] : [],
      refresh: async () => undefined,
      setStatusFilter: vi.fn(),
      helperNames: { "helper-1": "Hallie H." },
      completedJobMeta: opts.tipped ? { "job-1": { tipped: true, reviewed: false } } : {},
    }),
  );
}

const flush = () => new Promise((r) => setTimeout(r, 20));
const releaseAll = async () => {
  await act(async () => { for (let i = 0; i < 10; i++) { while (pending.length) pending.shift()!(); await flush(); } });
};
const DONE = { data: { success: true, bothDone: true, helperPayout: 42, platformFee: 5 }, error: null };

describe("the review prompt opens right after the tap that finished the job (UX-7)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    pending.length = 0;
  });

  it("the Helpr's Mark done that completes the job opens the review of the poster", async () => {
    invokeMock.mockResolvedValue(DONE);
    const { result } = setup("helper-1");
    act(() => { void result.current.completeJob("job-2"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await releaseAll();
    await waitFor(() => expect(result.current.completionPromptJob).not.toBeNull());
    expect(result.current.completionPromptJob).toEqual({ job: HELPED_JOB, revieweeId: "poster-9", revieweeName: "Pat P." });
  });

  it("control: a Mark done that still waits on the poster opens nothing (no review is allowed yet)", async () => {
    invokeMock.mockResolvedValue({ data: { success: true, bothDone: false }, error: null });
    const { result } = setup("helper-1");
    act(() => { void result.current.completeJob("job-2"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await releaseAll();
    expect(result.current.completionPromptJob).toBeNull();
  });

  it("a poster who already tipped still gets the review prompt, marked to skip the tip", async () => {
    invokeMock.mockResolvedValue(DONE);
    const { result } = setup("poster-1", { tipped: true });
    act(() => { void result.current.completeJob("job-1"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await releaseAll();
    await waitFor(() => expect(result.current.completionPromptJob).not.toBeNull());
    expect(result.current.completionPromptJob).toEqual({ job: POSTED_JOB, revieweeId: "helper-1", revieweeName: "Hallie H.", tipped: true });
  });
});
