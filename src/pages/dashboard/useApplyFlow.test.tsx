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
let resolveRpc: (() => void) | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      rpcMock(...args);
      return new Promise((resolve) => {
        resolveRpc = () => resolve({ data: "app-1", error: null });
      });
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
    resolveRpc = null;
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
});
