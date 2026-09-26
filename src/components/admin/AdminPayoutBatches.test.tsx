import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminPayoutBatches from "./AdminPayoutBatches";

/**
 * THE BIOMETRIC GATE IN FRONT OF A REAL STRIPE TRANSFER.
 *
 * Two gates live on this screen and both push money out of the platform
 * balance irreversibly: one per batch ("Send Payout") and one for the whole
 * selection ("Bulk Approve"). The bulk one is deliberately a SINGLE prompt
 * before the loop — per-helper prompts on a 40-batch run would train admins to
 * blow through them — which makes that one prompt the only thing between an
 * unlocked admin phone and every selected transfer.
 *
 * Neither was observable. `requireBiometric()` opens with
 * `if (!isNativePlatform) return true;`, so the real module passes
 * unconditionally under vitest and both `if (!ok) return;` lines were deletable
 * with the suite green. Mocked here with a handle, defaulted to `true`, and
 * driven to `false` in the two refusal cases — which assert the edge function
 * was invoked ZERO times.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

const HELPER_ID = "helper-1";
const JOB_ID = "job-1";

const batch = {
  helper_id: HELPER_ID,
  helper_name: "Eli Trahan",
  helper_email: "eli@example.com",
  stripe_account_id: "acct_123",
  job_count: 2,
  total_payout: 310.5,
  oldest_completed_at: "2026-09-10T12:00:00Z",
};

const invokeMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (table: string) => {
      if (table === "payout_transfers") {
        return {
          select: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        };
      }
      if (table === "profiles") {
        // Thenable for the name read; `.eq("is_seed", true)` for the Q233 seed read.
        return {
          select: () => ({
            in: () => Object.assign(Promise.resolve({ data: [], error: null }), { eq: async () => ({ data: [], error: null }) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "admin-1" }, ready: true, session: null, loading: false }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

const logAdminActionMock = vi.fn();
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: (...a: unknown[]) => logAdminActionMock(...a) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

/** Every edge-function call that actually moves money. */
const transferCalls = () =>
  invokeMock.mock.calls.filter(([fn]) => fn === "release-payout" || fn === "stripe-payouts");

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AdminPayoutBatches />
    </QueryClientProvider>,
  );
}

/** Render, wait for the queue, open the per-batch confirm, land on Send Payout. */
async function reachSendPayout() {
  renderScreen();
  fireEvent.click(await screen.findByRole("button", { name: /Pay Out/i }));
  return await screen.findByRole("button", { name: /^Send Payout$/ });
}

/** Render, select the batch, open the bulk confirm, land on its primary. */
async function reachBulkSend() {
  renderScreen();
  fireEvent.click(await screen.findByRole("checkbox", { name: /for bulk payout/i }));
  fireEvent.click(await screen.findByRole("button", { name: /Bulk Approve/i }));
  return await screen.findByRole("button", { name: /^Send 1$/ });
}

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockImplementation(async (fn: string) =>
    fn === "get_payout_batches"
      ? { data: [batch], error: null }
      : { data: [{ job_id: JOB_ID }], error: null },
  );
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { transfer_id: "tr_1" }, error: null });
  toastError.mockReset();
  toastSuccess.mockReset();
  logAdminActionMock.mockReset();
  requireBiometricMock.mockReset();
  // Default PASS — the happy paths must read as they would with no gate.
  requireBiometricMock.mockResolvedValue(true);
  window.localStorage.clear();
});

describe("AdminPayoutBatches — the per-batch payout", () => {
  it("a passed confirmation releases the batch's jobs", async () => {
    const send = await reachSendPayout();
    fireEvent.click(send);

    await waitFor(() => expect(transferCalls()).toHaveLength(1));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("release-payout", { body: { job_id: JOB_ID } });
  });

  it("a refused Face ID prompt sends nothing — zero edge calls, the batch stays queued", async () => {
    requireBiometricMock.mockResolvedValue(false);
    const send = await reachSendPayout();
    fireEvent.click(send);

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    // Drain whatever the handler could still have queued — "not called" the
    // instant the gate resolves passes even with the guard deleted.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // THE ACTION DID NOT HAPPEN. Not even the job-id lookup ran, and no audit
    // row claims a payout that no Stripe transfer backs.
    expect(transferCalls()).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalledWith("get_payout_batch_job_ids", expect.anything());
    expect(logAdminActionMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // …and the batch is still in the queue with a live Pay Out button, not
    // stuck on "Sending…".
    expect(await screen.findByRole("button", { name: /Pay Out/i })).toBeInTheDocument();
  });
});

describe("AdminPayoutBatches — the bulk payout run", () => {
  it("a passed confirmation fires the selected transfers", async () => {
    const send = await reachBulkSend();
    fireEvent.click(send);

    await waitFor(() => expect(transferCalls()).toHaveLength(1));
    // ONE prompt for the whole run, before the loop — never one per helper.
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
  });

  it("a refused Face ID prompt cancels the WHOLE run — zero transfers, not one", async () => {
    // The bulk gate is a single prompt in front of every selected transfer, so
    // a refusal that leaked even one through would be the worst kind of
    // half-applied money movement.
    requireBiometricMock.mockResolvedValue(false);
    const send = await reachBulkSend();
    fireEvent.click(send);

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // THE ACTION DID NOT HAPPEN.
    expect(transferCalls()).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(logAdminActionMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The selection survives, so the admin can retry deliberately.
    expect(await screen.findByRole("button", { name: /Bulk Approve/i })).toBeInTheDocument();
  });
});

// Two gates, two registrations. Each `if (!ok) return;` is the whole
// confirmation: without it a refused, cancelled or locked-out prompt still
// fires the Stripe transfer(s). The real module returns true on web, so only
// the mocked refusals above can see either line go missing.
// @mutate src/components/admin/AdminPayoutBatches.tsx | if (!ok) return;\n    setPaying(batch.helper_id); | setPaying(batch.helper_id);
// @mutate src/components/admin/AdminPayoutBatches.tsx | if (!ok) return;\n    setBulkPaying(true); | setBulkPaying(true);
