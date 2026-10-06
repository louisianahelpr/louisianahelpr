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
let holdsResult: { data: unknown; error: unknown } = { data: [], error: null };

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
      if (table === "payout_holds") {
        // Q764: the server-side hold list every admin reads.
        return { select: async () => holdsResult };
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
  holdsResult = { data: [], error: null };
});

/**
 * Q764: holds are SERVER state. A hold another admin placed (a row in
 * payout_holds) keeps the batch out of Ready, out of Select All and away from
 * Pay Out on this screen too; placing one writes through the admin RPC, not
 * localStorage; and a hold list that cannot be read offers nothing for payout.
 *
 * @mutate src/components/admin/AdminPayoutBatches.tsx | const readyBatches = holdsKnown ? batches.filter((b) => !holds[b.helper_id]) : []; | const readyBatches = batches;
 * @mutate src/components/admin/adminPayoutBatches/usePayoutHolds.ts | const row = unwrap(await supabase.rpc("admin_set_payout_hold", { p_helper_id: helperId, p_reason: reason })); | const row = { helper_id: helperId };
 * @mutate src/components/admin/AdminPayoutBatches.tsx | ) : isError \|\| holdsError ? ( | ) : isError ? (
 */
describe("AdminPayoutBatches — server-side payout holds (Q764)", () => {
  it("a hold placed by ANOTHER admin keeps the batch out of Ready and away from Pay Out", async () => {
    holdsResult = {
      data: [{ helper_id: HELPER_ID, reason: "fraud review", held_at: "2026-10-03T00:00:00Z", held_by: "admin-2", denied_at: null, denied_reason: null }],
      error: null,
    };
    renderScreen();
    expect(await screen.findByRole("tab", { name: /Ready.*\(0\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay Out/i })).toBeNull();
    expect(screen.queryByText(/this device/i)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Hold for Review/ }));
    expect(await screen.findByText(/fraud review/)).toBeInTheDocument();
  });

  it("placing a hold writes it through admin_set_payout_hold", async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "get_payout_batches"
        ? { data: [batch], error: null }
        : fn === "admin_set_payout_hold"
          ? { data: { helper_id: HELPER_ID, reason: "check the photos" }, error: null }
          : { data: [{ job_id: JOB_ID }], error: null },
    );
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^Hold$/ }));
    fireEvent.change(await screen.findByLabelText("Hold reason"), { target: { value: "check the photos" } });
    fireEvent.click(screen.getByRole("button", { name: /^Hold for Review$/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("admin_set_payout_hold", { p_helper_id: HELPER_ID, p_reason: "check the photos" }),
    );
    // The RPC writes the audit row itself; the client must not log a second one.
    expect(logAdminActionMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("helpr.admin_payout_holds.v1")).toBeNull();
  });

  /**
   * Q1221: the hold also freezes the Helpr's Stripe automatic payouts. The
   * screen asks payout-hold-stripe-sync right after the hold write and tells
   * the admin plainly when Stripe did not take it (the sweep retries; ops is
   * paged).
   *
   * @mutate src/components/admin/adminPayoutBatches/usePayoutHolds.ts | if (ok) await syncStripeFreeze(helperId, false); |
   * @mutate src/components/admin/adminPayoutBatches/usePayoutHolds.ts | if (ok) await syncStripeFreeze(helperId, true); |
   * @mutate src/components/admin/adminPayoutBatches/usePayoutHolds.ts | ok = !error && (data as { ok?: unknown } \| null)?.ok === true; | ok = !error;
   */
  it("placing a hold asks Stripe to pause the Helpr's automatic payouts", async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "get_payout_batches"
        ? { data: [batch], error: null }
        : fn === "admin_set_payout_hold"
          ? { data: { helper_id: HELPER_ID, reason: "check the photos" }, error: null }
          : { data: [{ job_id: JOB_ID }], error: null },
    );
    invokeMock.mockResolvedValue({ data: { ok: true, results: [] }, error: null });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^Hold$/ }));
    fireEvent.change(await screen.findByLabelText("Hold reason"), { target: { value: "check the photos" } });
    fireEvent.click(screen.getByRole("button", { name: /^Hold for Review$/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("payout-hold-stripe-sync", { body: { helper_id: HELPER_ID } }),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a pause Stripe did not take is told to the admin, and the hold stays", async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "get_payout_batches"
        ? { data: [batch], error: null }
        : fn === "admin_set_payout_hold"
          ? { data: { helper_id: HELPER_ID, reason: "check the photos" }, error: null }
          : { data: [{ job_id: JOB_ID }], error: null },
    );
    invokeMock.mockResolvedValue({ data: { ok: false, results: [{ kind: "failed" }] }, error: null });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^Hold$/ }));
    fireEvent.change(await screen.findByLabelText("Hold reason"), { target: { value: "check the photos" } });
    fireEvent.click(screen.getByRole("button", { name: /^Hold for Review$/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/could not be paused/)));
    expect(rpcMock).not.toHaveBeenCalledWith("admin_release_payout_hold", expect.anything());
  });

  it("releasing a hold asks Stripe to put the automatic payouts back", async () => {
    holdsResult = {
      data: [{ helper_id: HELPER_ID, reason: "fraud review", held_at: "2026-10-03T00:00:00Z", held_by: "admin-2", denied_at: null, denied_reason: null }],
      error: null,
    };
    invokeMock.mockResolvedValue({ data: { ok: true, results: [] }, error: null });
    renderScreen();
    fireEvent.click(await screen.findByRole("tab", { name: /Hold for Review/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Release/ }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_release_payout_hold", { p_helper_id: HELPER_ID }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("payout-hold-stripe-sync", { body: { helper_id: HELPER_ID } }),
    );
  });

  it("an unreadable hold list offers nothing for payout", async () => {
    holdsResult = { data: null, error: { message: "permission denied", code: "42501" } };
    renderScreen();
    expect(await screen.findByText(/couldn't load payout holds/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay Out/i })).toBeNull();
  });
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

  it("Q758: the bulk run pays through release-payout per job — never any other function", async () => {
    // The bulk run used to invoke `stripe-payouts` with { helper_id }: a
    // Connect BALANCE read that never creates a transfer, so every bulk batch
    // failed. It must take the per-batch path: job ids, then release-payout
    // once per job.
    const jobs = ["job-a", "job-b"];
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "get_payout_batches"
        ? { data: [batch], error: null }
        : { data: jobs.map((job_id) => ({ job_id })), error: null },
    );
    const send = await reachBulkSend();
    fireEvent.click(send);

    await waitFor(() =>
      expect(invokeMock.mock.calls.filter(([fn]) => fn === "release-payout")).toHaveLength(jobs.length),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const invoked = invokeMock.mock.calls.map(([fn]) => fn as string);
    // Floor: the run made real calls, so "every call is release-payout" is not vacuous.
    expect(invoked.length).toBeGreaterThan(1);
    expect(invoked.filter((fn) => fn !== "release-payout")).toEqual([]);
    for (const job_id of jobs) {
      expect(invokeMock).toHaveBeenCalledWith("release-payout", { body: { job_id } });
    }
    expect(rpcMock).toHaveBeenCalledWith("get_payout_batch_job_ids", { p_helper_id: HELPER_ID });
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    // The audit row records what moved, flagged as a bulk run.
    expect(logAdminActionMock).toHaveBeenCalledWith(
      "trigger_payout",
      "user",
      HELPER_ID,
      expect.objectContaining({ jobs_paid: 2, jobs_failed: 0, bulk: true }),
    );
    expect(toastError).not.toHaveBeenCalled();
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
// Q758: the bulk run must pay through release-payout, not the stripe-payouts balance read.
// @mutate src/components/admin/AdminPayoutBatches.tsx | const { jobIds, failures } = await releaseBatchJobs(batch.helper_id);\n        const paid | await supabase.functions.invoke("stripe-payouts", { body: { helper_id: batch.helper_id } });\n        const jobIds = [batch.helper_id]; const failures: string[] = [];\n        const paid
