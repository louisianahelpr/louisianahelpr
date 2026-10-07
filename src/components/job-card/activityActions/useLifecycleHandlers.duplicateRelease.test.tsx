// completeJob — a duplicate release response must not replay the
// completion celebration.
//
// create-payment's "release" action answers a duplicate call (double tap,
// retry after a lost response, a second device) BEFORE doing any work,
// with `alreadyReleased: true` (or `alreadyConfirmed: true` if only this
// party had confirmed) — see the `alreadyDone` early-return in
// supabase/functions/create-payment/index.ts. That response ALSO sets
// `bothDone: true` (so old clients checking bothDone alone still see
// success), which meant `completeJob` in useLifecycleHandlers.ts fired
// `fireSuccessMoment`, `maybeCelebrate("first_complete")` and the poster's
// tip prompt (`setCompletionPromptJob`) a second time for a completion
// that already fired them on the original call. Fixed by checking
// `alreadyReleased` / `alreadyConfirmed` first and returning early.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
const celebrateMock = vi.fn();
const successMomentMock = vi.fn();
const pending: Array<() => void> = [];

function chain(result: unknown = { data: [], error: null }) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "in", "neq", "order", "limit", "update"]) {
    self[m] = () => self;
  }
  self.single = () => Promise.resolve({ data: null, error: null });
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
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: (...a: unknown[]) => successMomentMock(...a) }));
vi.mock("@/lib/celebrate", () => ({ maybeCelebrate: (...a: unknown[]) => { celebrateMock(...a); return Promise.resolve(); } }));
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
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { REVIEW_HOLD_MESSAGE } from "../../../../supabase/functions/_shared/reviewHoldCopy";
import type { Job } from "@/components/job-card/activityConstants";

const USER = { id: "poster-1" } as unknown as Parameters<typeof useActivityActions>[0]["user"];

// Poster side of completeJob (appliedApps: [] → not the helper), so this
// goes straight to the release invoke without the arrival/proof reads —
// same shortcut the existing in-flight test uses.
const POSTED_JOB = { id: "job-1", helper_id: "helper-1" } as unknown as Job;

function setup() {
  return renderHook(() =>
    useActivityActions({
      user: USER,
      postedJobs: [POSTED_JOB],
      appliedApps: [],
      refresh: async () => undefined,
      setStatusFilter: vi.fn(),
      helperNames: { "helper-1": "Hallie H." },
      completedJobMeta: {},
    }),
  );
}

const flush = () => new Promise((r) => setTimeout(r, 20));
const releaseAll = async () => {
  await act(async () => { for (let i = 0; i < 10; i++) { while (pending.length) pending.shift()!(); await flush(); } });
};

describe("completeJob — duplicate release response", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    celebrateMock.mockReset();
    successMomentMock.mockReset();
    pending.length = 0;
  });

  it("does NOT fire confetti or the tip prompt when the response says alreadyReleased", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        bothDone: true,
        alreadyReleased: true,
        alreadyConfirmed: false,
        message: "This job was already released — nothing more to do.",
        helperPayout: 0,
        platformFee: 0,
      },
      error: null,
    });
    const { result } = setup();
    act(() => { void result.current.completeJob("job-1"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await releaseAll();

    expect(successMomentMock).not.toHaveBeenCalled();
    expect(celebrateMock).not.toHaveBeenCalled();
    expect(result.current.completionPromptJob).toBeNull();
  });

  it("does NOT fire confetti or the tip prompt when the response says alreadyConfirmed", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        bothDone: false,
        alreadyReleased: false,
        alreadyConfirmed: true,
        message: "You already confirmed completion — waiting on the other party.",
        helperPayout: 0,
        platformFee: 0,
      },
      error: null,
    });
    const { result } = setup();
    act(() => { void result.current.completeJob("job-1"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await releaseAll();

    expect(successMomentMock).not.toHaveBeenCalled();
    expect(celebrateMock).not.toHaveBeenCalled();
    expect(result.current.completionPromptJob).toBeNull();
  });

  // Proves the two checks above can actually fail: a FRESH (non-duplicate)
  // completion must still celebrate and still prompt for a tip.
  it("control: a fresh completion (bothDone, not already-anything) DOES celebrate and prompt", async () => {
    invokeMock.mockResolvedValue({
      data: { success: true, bothDone: true, helperPayout: 42, platformFee: 5 },
      error: null,
    });
    const { result } = setup();
    act(() => { void result.current.completeJob("job-1"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await releaseAll();

    expect(successMomentMock).toHaveBeenCalledWith({ label: "Job completed" });
    await waitFor(() => expect(celebrateMock).toHaveBeenCalledWith("first_complete", { particleCount: 120 }));
    await waitFor(() => expect(result.current.completionPromptJob).not.toBeNull());
    expect(result.current.completionPromptJob).toEqual({
      job: POSTED_JOB,
      revieweeId: "helper-1",
      revieweeName: "Hallie H.",
    });
  });
});

// Q1415(b): a release refused because an account on the job is under a ban
// review is a FINAL answer. The caller shows the server's neutral sentence,
// never "please try again", and does not report it as an error.
// @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |       if (isReviewHold(err)) { |       if (false) {
describe("completeJob — a release held by a review", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    pending.length = 0;
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(report).mockClear();
  });

  it("says the hold sentence, not 'please try again', and reports nothing", async () => {
    invokeMock.mockResolvedValue({ data: { error: REVIEW_HOLD_MESSAGE }, error: null });
    const { result } = setup();
    act(() => { void result.current.completeJob("job-1"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await releaseAll();
    expect(vi.mocked(toast)).toHaveBeenCalledWith(REVIEW_HOLD_MESSAGE, expect.anything());
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(vi.mocked(report)).not.toHaveBeenCalled();
  });

  it("control: any other server error still says try again and is reported", async () => {
    invokeMock.mockResolvedValue({ data: { error: "Failed to update the job status — please try again" }, error: null });
    const { result } = setup();
    act(() => { void result.current.completeJob("job-1"); });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await releaseAll();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("We couldn't mark this job complete — please try again.");
    expect(vi.mocked(report)).toHaveBeenCalled();
  });
});

// Shown able to fail:
// The idempotent-replay guard. create-payment answers a duplicate release with
// `alreadyReleased` AND `bothDone: true` (for old clients), so without this
// check the bothDone branch below replays the confetti, the success moment and
// the poster's tip prompt for a completion that already fired them.
// @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts | if (data?.alreadyReleased \|\| data?.alreadyConfirmed) { | if (false) {
// Both halves: `alreadyConfirmed` (only this party had confirmed) arrives with
// bothDone FALSE, so an `alreadyReleased`-only check still misses it.
// @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts | data?.alreadyReleased \|\| data?.alreadyConfirmed | data?.alreadyReleased && data?.alreadyConfirmed
