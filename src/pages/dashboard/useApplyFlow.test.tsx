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
    // ...and that the one call is the RPC BY NAME. Counting calls alone cannot
    // tell `apply_to_job` from a renamed/missing function: a name the server
    // does not have returns PGRST202, which is precisely the door into the
    // direct-INSERT fallback below (see the REPORT at the foot of this file).
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

// ─────────────────────────────────────────────────────────────────────────────
// REPORTED, NOT GUARDED — the PGRST202 direct-INSERT fallback (2026-09-21).
//
// `mutationFn` falls back to `supabase.from("applications").insert({...})` when
// the RPC answers PGRST202. Verified read-only against prod
// (fncmgoasalhdgfwzhsqa) on 2026-09-21: `apply_to_job(uuid, text)` IS deployed
// with exactly the signature the client calls, so the fallback is unreachable
// TODAY. What it would skip if the RPC were ever renamed or dropped, checked
// against `pg_get_functiondef` and every non-internal trigger on
// `public.applications`:
//
//   • the per-MINUTE and per-HOUR rungs of the cap ladder. `application_cap`
//     is read for 'minute'/'hour'/'day' inside apply_to_job, but the only
//     trigger behind it — `enforce_application_limit` — reads ONLY
//     `application_cap('day')`. Minute and hour have NO trigger.
//   • the funding gate `job_payment_is_funded(jobs.payment_status)`. Present
//     in the RPC; absent from `enforce_application_job_state`, which covers
//     own-job, not-open, direct-offer reservation, Early Access, seed, past
//     date and expiry — but not payment.
//   • `pg_advisory_xact_lock('apply_rate:' || auth.uid())`, the serialization
//     that makes those counts see each other.
//
// Not registered as a mutation and not "fixed" here: writing a test around the
// fallback would lock in a bypass, and deleting the branch is a production
// change outside this hardening pass. It belongs in docs/OPEN.md.
// ─────────────────────────────────────────────────────────────────────────────

// @mutate src/pages/dashboard/useApplyFlow.ts | if (!user \|\| !jobId \|\| applyLoading \|\| applyInFlight.current) return; | if (!user \|\| !jobId \|\| applyLoading) return;
// @mutate src/pages/dashboard/useApplyFlow.ts | { onSettled: () => { applyInFlight.current = false; setApplyLoading(false); toast.dismiss(APPLY_PENDING_TOAST_ID); } }, | { onSettled: () => { setApplyLoading(false); toast.dismiss(APPLY_PENDING_TOAST_ID); } },
// Q324: the dialog closes at once, so this toast is the only sign the apply is on its way.
// @mutate src/pages/dashboard/useApplyFlow.ts | toast.loading("Sending your application…", { id: APPLY_PENDING_TOAST_ID }); | void 0;
// @mutate src/pages/dashboard/useApplyFlow.ts | setApplyLoading(false); toast.dismiss(APPLY_PENDING_TOAST_ID); } }, | setApplyLoading(false); } },
