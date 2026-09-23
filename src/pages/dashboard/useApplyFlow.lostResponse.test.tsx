// Q269 — a retried apply that already landed was told it failed, then
// "already applied".
//
// apply_to_job ran and committed, and its RESPONSE was lost: the helper saw
// "Couldn't send your application through — tap retry". The retry was refused
// by the RPC ("Already applied to this job") and the helper was then told
// "You've already applied to this job." — two errors for an apply that worked
// first time. No duplicate row was ever possible (UNIQUE(job_id, helper_id));
// the defect is what the helper is told. e2e/slow-network apply·drop drives the
// same scenario against prod.
//
// Red first (2026-09-23): against the pre-fix useApplyFlow.ts the retry ended
// in toast.error("You've already applied to this job.") and no success toast.
//
// @mutate src/pages/dashboard/useApplyFlow.ts | outcomeUnknownJobIds.current.add(vars.jobId); | void vars.jobId;
// @mutate src/pages/dashboard/useApplyFlow.ts | if (!(isAlreadyAppliedRefusal(rpcError) && outcomeUnknownJobIds.current.has(jobId))) { | if (true) {
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const server = vi.hoisted(() => ({
  applied: new Set<string>(),
  rpcCalls: 0,
  loseNextResponse: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // A fake apply_to_job with the real refusal: one application per
    // (job, helper), and "Already applied to this job" for the second.
    rpc: async (_fn: string, args: { p_job_id: string }) => {
      server.rpcCalls += 1;
      if (server.applied.has(args.p_job_id)) {
        return { data: null, error: { code: "P0001", message: "Already applied to this job" } };
      }
      server.applied.add(args.p_job_id);
      if (server.loseNextResponse) {
        server.loseNextResponse = false;
        return { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };
      }
      return { data: "app-1", error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (r: (v: unknown) => void) => r({ count: 1, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ errorToast: vi.fn() }));
vi.mock("@/hooks/useNotificationPermissionPrompt", () => ({ recordJobActionForPermissionPrompt: vi.fn() }));
vi.mock("@/hooks/useImpersonation", () => ({ assertWritable: () => true }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/requireOnline", () => ({ requireOnline: () => true }));
vi.mock("@/lib/applyRateLimit", () => ({
  checkApplicationRate: async () => ({ allowed: true }),
  recordApplicationAttempt: async () => undefined,
}));

import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { useApplyFlow } from "./useApplyFlow";

const USER = { id: "helper-1" } as unknown as Parameters<typeof useApplyFlow>[0]["user"];
const errorToastMock = errorToast as unknown as ReturnType<typeof vi.fn>;

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useApplyFlow({ user: USER, allJobs: [] }), { wrapper });
}

beforeEach(() => {
  server.applied.clear();
  server.rpcCalls = 0;
  server.loseNextResponse = false;
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  errorToastMock.mockClear();
});

describe("Q269: retry after a lost apply response", () => {
  it("the Retry of an apply that already landed ends in 'Application sent', never 'already applied'", async () => {
    const { result } = setup();
    server.loseNextResponse = true;
    act(() => { result.current.handleApplyConfirm("job-1"); });
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(server.applied.has("job-1")).toBe(true); // it DID land
    const onRetry = (errorToastMock.mock.calls[0][1] as { onRetry: () => void }).onRetry;

    await act(async () => { onRetry(); });
    await waitFor(() => expect(server.rpcCalls).toBe(2));

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const errors = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
    expect(errors.filter((m) => /already applied/i.test(m)), "told 'already applied' after being told it failed").toEqual([]);
    expect(String(vi.mocked(toast.success).mock.calls[0][0])).toMatch(/Application sent/);
  });

  it("an 'already applied' with no earlier unknown outcome is still shown as the refusal it is", async () => {
    server.applied.add("job-2"); // applied last week, from another device
    const { result } = setup();
    act(() => { result.current.handleApplyConfirm("job-2"); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've already applied to this job."));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
