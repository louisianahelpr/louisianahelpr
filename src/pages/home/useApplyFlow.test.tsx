// useApplyFlow — the synchronous in-flight guard on handleApplyConfirm.
//
// What this prevents: two Apply Now clicks dispatched in the same frame both
// calling apply_to_job. `applyLoading` is React state, so both clicks read
// `false` before any re-render; measured on prod 2026-09-12 as 2 RPCs from one
// intent. The guard is a ref set before mutate() and cleared on settle. The
// prod-side check for the same class is the "SAME frame" case in
// e2e/prod-audit/interruptions.spec.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const rpcMock = vi.fn();
const writeMock = vi.fn();
let resolveRpc: (() => void) | null = null;
// When set, the RPC answers at once with this error (Q1009: PGRST202).
let rpcFailsWith: { code: string; message: string } | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      rpcMock(...args);
      if (rpcFailsWith) return Promise.resolve({ data: null, error: rpcFailsWith });
      return new Promise((resolve) => {
        resolveRpc = () => resolve({ data: "app-1", error: null });
      });
    },
    from: (table: string) => ({
      insert: (row: unknown) => { writeMock(table, "insert", row); return Promise.resolve({ data: null, error: null }); },
      upsert: (row: unknown) => { writeMock(table, "upsert", row); return Promise.resolve({ data: null, error: null }); },
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

import { useApplyFlow } from "./useApplyFlow";

const USER = { id: "helper-1" } as unknown as Parameters<typeof useApplyFlow>[0]["user"];

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useApplyFlow({ user: USER, allJobs: [] }), { wrapper });
}

describe("useApplyFlow in-flight guard", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    writeMock.mockReset();
    resolveRpc = null;
    rpcFailsWith = null;
  });

  it("two confirms in the same frame send exactly one apply_to_job", async () => {
    const { result } = setup();
    const confirm = result.current.handleApplyConfirm;
    // Same closure twice, no re-render between: exactly what a same-frame
    // double click sees.
    act(() => {
      confirm("job-1");
      confirm("job-1");
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    // ...and that the one call is the RPC BY NAME. Counting calls alone cannot
    // tell `apply_to_job` from a renamed/missing function: a name the server
    // does not have returns PGRST202, which used to open a direct-INSERT
    // fallback (Q1009, removed; see the case below).
    expect(rpcMock).toHaveBeenCalledWith("apply_to_job", { p_job_id: "job-1", p_message: null });
  });

  it("releases the guard once the apply settles, so a later apply goes through", async () => {
    const { result } = setup();
    act(() => { result.current.handleApplyConfirm("job-1"); });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    await act(async () => { resolveRpc?.(); });
    await waitFor(() => expect(result.current.applyLoading).toBe(false));
    act(() => { result.current.handleApplyConfirm("job-2"); });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));
  });

  it("says it is sending while the apply is in flight, and stops saying so once it settles (Q324)", async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.loading).mockClear();
    vi.mocked(toast.dismiss).mockClear();
    const { result } = setup();
    act(() => { result.current.handleApplyConfirm("job-1"); });
    // The dialog has already closed: without this the screen is blank until the
    // server answers (1.07s on 3G, live slow-network run 35936336468).
    expect(toast.loading).toHaveBeenCalledWith("Sending your application…", { id: "apply-pending" });
    expect(toast.dismiss).not.toHaveBeenCalledWith("apply-pending");
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    await act(async () => { resolveRpc?.(); });
    await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith("apply-pending"));
  });
});

// Q1009: apply_to_job is the only door. The PGRST202 direct-INSERT fallback
// (which skipped the minute/hour caps and the apply_rate advisory lock) is
// gone, and authenticated holds no INSERT on applications
// (20261004184135_applications_insert_rpc_only.sql, pinned live by
// scripts/ci/client-insert-columns.sql). Server-side proof:
// src/test/pglite/applicationsInsertRpcOnly.pglite.mjs.
describe("useApplyFlow writes an application only through apply_to_job (Q1009)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    writeMock.mockReset();
    resolveRpc = null;
    rpcFailsWith = null;
  });

  it("a PGRST202 (the RPC missing) is an error, never a direct INSERT", async () => {
    rpcFailsWith = { code: "PGRST202", message: "Could not find the function public.apply_to_job" };
    const { errorToast } = await import("@/lib/toast");
    vi.mocked(errorToast).mockClear();
    const { result } = setup();
    act(() => { result.current.handleApplyConfirm("job-1"); });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.applyLoading).toBe(false));
    expect(writeMock.mock.calls.filter(([t, kind]) => t === "applications" && kind !== "update")).toEqual([]);
  });
});

// @mutate src/pages/home/useApplyFlow.ts | if (!user \|\| !jobId \|\| applyLoading \|\| applyInFlight.current) return; | if (!user \|\| !jobId \|\| applyLoading) return;
// @mutate src/pages/home/useApplyFlow.ts | { onSettled: () => { applyInFlight.current = false; setApplyLoading(false); toast.dismiss(APPLY_PENDING_TOAST_ID); } }, | { onSettled: () => { setApplyLoading(false); toast.dismiss(APPLY_PENDING_TOAST_ID); } },
// Q324: the dialog closes at once, so this toast is the only sign the apply is on its way.
// @mutate src/pages/home/useApplyFlow.ts | toast.loading("Sending your application…", { id: APPLY_PENDING_TOAST_ID }); | void 0;
// @mutate src/pages/home/useApplyFlow.ts | setApplyLoading(false); toast.dismiss(APPLY_PENDING_TOAST_ID); } }, | setApplyLoading(false); } },
// Q1009: the direct-INSERT fallback comes back on a PGRST202.
// @mutate src/pages/home/useApplyFlow.ts |         recoveredId = await confirmThisAttemptLanded(rpcError);\n        if (!recoveredId) { |         if ((rpcError as { code?: string }).code === "PGRST202") { await supabase.from("applications").insert({ job_id: jobId, helper_id: helperId, message: message.trim() \|\| null }); return; }\n        recoveredId = await confirmThisAttemptLanded(rpcError);\n        if (!recoveredId) {
