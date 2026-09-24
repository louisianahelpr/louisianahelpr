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
// Review finding (landing, 2026-09-23): apply_to_job refuses "Already applied"
// on a row of ANY status, so the first cut of this fix turned an OLD rejected
// application into a false "Application sent" whenever a generic failure came
// first. The retry now reads the row back and accepts only a PENDING row
// created at/after the first unknown attempt, and only a WIRE failure marks
// the outcome unknown. Red on the branch as it was: the old-row cases and the
// server-error case all toasted success.
//
// @mutate src/pages/home/useApplyFlow.ts | outcomeUnknownJobIds.current.set(vars.jobId, attemptStartedAt.current.get(vars.jobId) ?? Date.now()); | void vars.jobId;
// @mutate src/pages/home/useApplyFlow.ts | recoveredId = await confirmThisAttemptLanded(rpcError); | recoveredId = null;
// @mutate src/pages/home/useApplyFlow.ts | if (!row \|\| row.status !== "pending") return null; | if (!row) return null;
// @mutate src/pages/home/useApplyFlow.ts | if (Date.parse(row.created_at) < firstStart - CLOCK_SLACK_MS) return null; | void CLOCK_SLACK_MS;
// @mutate src/pages/home/useApplyFlow.ts | if (isNetworkFailure(err) && !outcomeUnknownJobIds.current.has(vars.jobId)) { | if (!outcomeUnknownJobIds.current.has(vars.jobId)) {
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const server = vi.hoisted(() => ({
  // (job_id) -> this helper's application row, as apply_to_job sees it.
  rows: new Map<string, { id: string; status: string; created_at: string }>(),
  rpcCalls: 0,
  updates: 0,
  loseNextResponse: false,
  // The request never reaches the server; the client sees the same wire error.
  dropNextRequest: false,
  // The server answers with an error that is not a transport failure.
  serverErrorNext: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // A fake apply_to_job with the real refusal: one application per
    // (job, helper), and "Already applied to this job" for the second.
    rpc: async (_fn: string, args: { p_job_id: string }) => {
      server.rpcCalls += 1;
      if (server.dropNextRequest) {
        server.dropNextRequest = false;
        return { data: null, error: { code: "", message: "TypeError: Load failed" } };
      }
      // The live RPC: COUNT(*) with no status filter.
      if (server.rows.has(args.p_job_id)) {
        return { data: null, error: { code: "P0001", message: "Already applied to this job" } };
      }
      server.rows.set(args.p_job_id, { id: `app-${args.p_job_id}`, status: "pending", created_at: new Date().toISOString() });
      if (server.serverErrorNext) {
        server.serverErrorNext = false;
        return { data: null, error: { code: "XX000", message: "upstream request failed" } };
      }
      if (server.loseNextResponse) {
        server.loseNextResponse = false;
        return { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };
      }
      return { data: "app-1", error: null };
    },
    from: () => ({
      select: () => ({
        eq: (_c: string, jobId: string) => ({
          eq: () => ({ maybeSingle: async () => ({ data: server.rows.get(jobId) ?? null, error: null }) }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (r: (v: unknown) => void) => r({ count: 1, error: null }),
        }),
      }),
      update: () => {
        server.updates += 1;
        const chain = { eq: () => chain, select: async () => ({ data: [{ id: "x" }], error: null }) };
        return chain;
      },
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
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
  server.rows.clear();
  server.rpcCalls = 0;
  server.updates = 0;
  server.loseNextResponse = false;
  server.dropNextRequest = false;
  server.serverErrorNext = false;
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
    expect(server.rows.has("job-1")).toBe(true); // it DID land
    const onRetry = (errorToastMock.mock.calls[0][1] as { onRetry: () => void }).onRetry;

    await act(async () => { onRetry(); });
    await waitFor(() => expect(server.rpcCalls).toBe(2));

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const errors = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
    expect(errors.filter((m) => /already applied/i.test(m)), "told 'already applied' after being told it failed").toEqual([]);
    expect(String(vi.mocked(toast.success).mock.calls[0][0])).toMatch(/Application sent/);
  });

  it("an 'already applied' with no earlier unknown outcome is still shown as the refusal it is", async () => {
    server.rows.set("job-2", { id: "old", status: "pending", created_at: "2026-09-01T00:00:00Z" }); // applied last week, from another device
    const { result } = setup();
    act(() => { result.current.handleApplyConfirm("job-2"); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've already applied to this job."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("an OLD rejected application is never mistaken for the retry's success (dropped request, then refusal)", async () => {
    server.rows.set("job-3", { id: "old-rejected", status: "rejected", created_at: "2026-09-01T00:00:00Z" });
    const { result } = setup();
    server.dropNextRequest = true; // never reached the server
    act(() => { result.current.handleApplyConfirm("job-3"); });
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    const onRetry = (errorToastMock.mock.calls[0][1] as { onRetry: () => void }).onRetry;

    await act(async () => { onRetry(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've already applied to this job."));
    expect(toast.success, "false success over an old rejected row").not.toHaveBeenCalled();
    expect(server.updates, "patched attachments onto the OLD row").toBe(0);
    expect(server.rows.get("job-3")?.status).toBe("rejected");
  });

  it("a RECENT but non-pending row (rejected moments ago) is not claimed: status is checked, not only age", async () => {
    server.rows.set("job-6", { id: "recent-rejected", status: "rejected", created_at: new Date().toISOString() });
    const { result } = setup();
    server.dropNextRequest = true;
    act(() => { result.current.handleApplyConfirm("job-6"); });
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    const onRetry = (errorToastMock.mock.calls[0][1] as { onRetry: () => void }).onRetry;
    await act(async () => { onRetry(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've already applied to this job."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("an OLD pending application from before the first attempt is not claimed either", async () => {
    server.rows.set("job-4", { id: "old-pending", status: "pending", created_at: "2026-09-01T00:00:00Z" });
    const { result } = setup();
    server.dropNextRequest = true;
    act(() => { result.current.handleApplyConfirm("job-4"); });
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    const onRetry = (errorToastMock.mock.calls[0][1] as { onRetry: () => void }).onRetry;
    await act(async () => { onRetry(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've already applied to this job."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a server error (not a wire failure) does not make the outcome unknown", async () => {
    const { result } = setup();
    server.serverErrorNext = true; // a real server answer, not a lost one
    act(() => { result.current.handleApplyConfirm("job-5"); });
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    const onRetry = (errorToastMock.mock.calls[0][1] as { onRetry: () => void }).onRetry;
    await act(async () => { onRetry(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've already applied to this job."));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
