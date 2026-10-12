// @mutate src/components/admin/adminDisputes/DisputeCard.tsx | const ranInTestMode = unsettled && /Stripe test mode\|test-mode records cleared by an admin/i.test(record?.execution_error ?? ""); | const ranInTestMode = unsettled;
// @mutate src/components/admin/adminDisputes/DisputeCard.tsx | const ranInTestMode = unsettled && /Stripe test mode\|test-mode records cleared by an admin/i.test(record?.execution_error ?? ""); | const ranInTestMode = false;
// @mutate src/components/admin/adminDisputes/DisputeCard.tsx | disabled={retrying === job.id \|\| testModeNote.trim().length < 10} | disabled={retrying === job.id}
// @mutate src/components/admin/AdminDisputes.tsx | const ok = await requireBiometric("Confirm clearing this dispute's test-mode records");\n    if (!ok) return; | const ok = true;
// @mutate src/components/admin/AdminDisputes.tsx |       const invokeError = error ?? (data?.error ? new Error(String(data.error)) : null);\n      if (invokeError) {\n        report(invokeError, { tags: { source: "AdminDisputes.clearTestModeRecords" } }); |       const invokeError = error;\n      if (invokeError) {\n        report(invokeError, { tags: { source: "AdminDisputes.clearTestModeRecords" } });
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import AdminDisputes from "./AdminDisputes";

/**
 * Q1732 (OWNER DECISION 2026-10-12): the admin button that un-sticks a decided
 * dispute whose Stripe TEST-mode refund or transfer is already recorded in our
 * books. Offered only on an unsettled card whose split refused for Stripe test
 * mode, behind the biometric gate every settlement action has, with a reason of
 * 10+ characters; it calls execute-dispute-split's clear_test_mode_records
 * branch (the Stripe check, the audited clear and the supersede are all
 * server-side: src/test/edge/clearTestModeDisputeRecords.test.ts and
 * src/test/pglite/testModeDisputeLedgerClears.pglite.mjs).
 *
 * Fixture scaffold copied from AdminDisputes.settleWithoutPayment.test.tsx.
 * NOT LOOKED AT on a real screen yet (no browser work in this lane): Q1732
 * holds a look at 375 and 1440.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

const BASE_JOB = {
  title: "x",
  budget: 180,
  status: "completed",
  customer_id: "poster-1",
  helper_id: "helper-1",
  dispute_reason: "no_show",
  dispute_evidence_urls: [],
  disputed_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  disputed_by: "helper-1",
  payment_status: "escrow",
  dispute_resolved_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
};
/** Decided, split refused: the escrow was paid in Stripe TEST mode. */
const TEST_MODE_JOB = { ...BASE_JOB, id: "job-test", title: "Rake the yard", stripe_payment_intent_id: "pi_test_old" };
/** Decided, split failed for an ordinary reason: retry only. */
const OTHER_JOB = { ...BASE_JOB, id: "job-other", title: "Clear a gutter", stripe_payment_intent_id: "pi_live" };

const decided = (id: string, jobId: string, error: string) => ({
  id,
  job_id: jobId,
  opener_id: "poster-1",
  reason: "quality",
  evidence_urls: [],
  status: "decided",
  created_at: "2026-09-19T00:00:00Z",
  decided_at: "2026-09-20T00:00:00Z",
  decided_by: "admin-1",
  decision_text: "Split 50/50.",
  payout_split: { poster: 0.5, helper: 0.5 },
  execution_status: "failed",
  execution_error: error,
});
const RECORDS = [
  decided("dis-test", "job-test", "this escrow was paid in Stripe test mode, so there is no real money behind it — split refused. No money was moved."),
  decided("dis-other", "job-other", "Stripe returned 502"),
];

vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const state: { status?: string; notResolved?: boolean; inCol?: string; inVals?: string[] } = {};
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "is", "or", "neq", "gte", "lte", "update"]) {
      b[m] = vi.fn(() => b);
    }
    b.eq = vi.fn((col: string, val: string) => {
      if (col === "status") state.status = val;
      return b;
    });
    b.not = vi.fn((col: string) => {
      if (col === "dispute_resolved_at") state.notResolved = true;
      return b;
    });
    b.in = vi.fn((col: string, vals: string[]) => {
      state.inCol = col;
      state.inVals = vals;
      return b;
    });
    const rows = () => {
      if (table === "jobs") {
        if (state.status === "disputed") return [];
        if (state.notResolved) return [TEST_MODE_JOB, OTHER_JOB];
        if (state.inCol === "id") return [TEST_MODE_JOB, OTHER_JOB].filter((j) => state.inVals?.includes(j.id));
        return [];
      }
      if (table === "disputes") {
        if (state.inCol === "job_id") return RECORDS.filter((r) => state.inVals?.includes(r.job_id));
        return [{ job_id: "job-test" }, { job_id: "job-other" }];
      }
      if (table === "profiles") {
        return [
          { user_id: "poster-1", full_name: "Perry Poster", subscription_tier: "free" },
          { user_id: "helper-1", full_name: "Hallie Helper", subscription_tier: "free" },
        ];
      }
      return [];
    };
    b.then = (res: (v: unknown) => void) => res({ data: rows(), error: null });
    return b;
  };
  return {
    supabase: {
      from: vi.fn((t: string) => build(t)),
      rpc: (...args: unknown[]) => rpcMock(...args),
      functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "admin-1" } }, error: null })) },
    },
  };
});

const invokeMock = vi.fn();
const rpcMock = vi.fn();
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));
const confirmConsequentialMock = vi.fn();
vi.mock("@/lib/toastPolicy", () => ({
  confirmConsequential: (...a: unknown[]) => confirmConsequentialMock(...a),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(),
  hapticMedium: vi.fn(),
  hapticHeavy: vi.fn(),
  hapticSuccess: vi.fn(),
  hapticWarning: vi.fn(),
  hapticError: vi.fn(),
}));

const BUTTON = /Clear test-mode records and re-open/;
const clearCalls = () =>
  invokeMock.mock.calls.filter(([name, opts]) => name === "execute-dispute-split" && (opts as { body?: { action?: string } })?.body?.action === "clear_test_mode_records");

async function openConsole() {
  render(<AdminDisputes />);
  await screen.findByText(/Settlement failed: this escrow was paid in Stripe test mode/);
  await screen.findByText(/Settlement failed: Stripe returned 502/);
}
async function drain() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function typeAndPress(note = "paid before Stripe went live on 2026-09-27") {
  fireEvent.change(screen.getByLabelText(/ran in Stripe test mode/), { target: { value: note } });
  fireEvent.click(screen.getByRole("button", { name: BUTTON }));
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { action: "superseded", new_dispute_id: "dis-new" }, error: null });
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
  confirmConsequentialMock.mockReset();
  toastError.mockReset();
  requireBiometricMock.mockReset();
  requireBiometricMock.mockResolvedValue(true);
});

describe("Q1732: the admin button that un-sticks a test-mode dispute", () => {
  it("is offered only on the unsettled card whose split refused for Stripe test mode (inventory: 2 unsettled cards, 1 button)", async () => {
    await openConsole();
    expect(screen.getAllByRole("button", { name: /Retry settlement/ }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole("button", { name: BUTTON })).toHaveLength(1);
  });

  it("needs a reason of 10+ characters before it can be pressed", async () => {
    await openConsole();
    expect(screen.getByRole("button", { name: BUTTON })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/ran in Stripe test mode/), { target: { value: "too short" } });
    expect(screen.getByRole("button", { name: BUTTON })).toBeDisabled();
  });

  it("calls the clear_test_mode_records branch with the dispute and the reason, behind the biometric gate", async () => {
    await openConsole();
    await typeAndPress();
    await waitFor(() => expect(clearCalls()).toHaveLength(1));
    expect(clearCalls()[0][1]).toEqual({
      body: { dispute_id: "dis-test", action: "clear_test_mode_records", reason: "paid before Stripe went live on 2026-09-27" },
    });
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(confirmConsequentialMock).toHaveBeenCalled());
    expect(String(confirmConsequentialMock.mock.calls[0][0])).toMatch(/open again to decide/);
  });

  it("a refused biometric prompt calls nothing", async () => {
    requireBiometricMock.mockResolvedValue(false);
    await openConsole();
    await typeAndPress();
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();
    expect(clearCalls()).toHaveLength(0);
  });

  it("a server refusal (e.g. a LIVE refund) is shown in words, never as success", async () => {
    invokeMock.mockResolvedValue({
      data: { error: "refund re_1 is LIVE money at Stripe, not a test-mode record — nothing was changed; reconcile it by hand" },
      error: null,
    });
    await openConsole();
    await typeAndPress();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/LIVE money/);
    expect(confirmConsequentialMock).not.toHaveBeenCalled();
  });

  it("a non-2xx refusal shows the server's words from the Response body", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
        context: new Response(JSON.stringify({ error: "nothing was changed: clear_ledger_changed" }), { status: 409 }),
      }),
    });
    await openConsole();
    await typeAndPress();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/clear_ledger_changed/);
    expect(confirmConsequentialMock).not.toHaveBeenCalled();
  });

  it("pressed again after it went through says so", async () => {
    invokeMock.mockResolvedValue({ data: { action: "already_superseded" }, error: null });
    await openConsole();
    await typeAndPress();
    await waitFor(() => expect(confirmConsequentialMock).toHaveBeenCalled());
    expect(String(confirmConsequentialMock.mock.calls[0][0])).toMatch(/Already done/);
  });
});
