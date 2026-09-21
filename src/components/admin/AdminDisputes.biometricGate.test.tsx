import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import AdminDisputes from "./AdminDisputes";

/**
 * THE THREE BIOMETRIC GATES ON THE DISPUTE CONSOLE.
 *
 * `requireBiometric()` opens with `if (!isNativePlatform) return true;`, so the
 * real module passes unconditionally under vitest. A test that imports it
 * cannot observe the gate at all: every Face ID confirmation standing between a
 * merely-unlocked admin phone and real escrow could be deleted and the suite
 * would stay green. That shipped twice already, both times in front of an
 * account-takeover primitive.
 *
 * The three, all irreversible and all one tap from the queue:
 *
 *   resolveDispute   Quick Release / Quick Refund — `create-payment` moves the
 *                    whole escrow out of Stripe with no undo.
 *   decide           records the formal decision AND executes the split — one
 *                    Stripe transfer plus one refund.
 *   retrySettlement  re-runs `execute-dispute-split` on a stuck case.
 *
 * So the gate is mocked with a handle the tests drive. It defaults to `true` in
 * `beforeEach` — a mock PINNED to `true` is the opposite of coverage, it
 * removes the gate from the test's world so the surrounding assertions pass
 * (the sibling file `adminDisputesFiltering.test.tsx` pins it to `true`, which
 * is exactly why it cannot see any of this) — and each refusal case drives it
 * `false` and asserts THE MONEY DID NOT MOVE.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

/** An open, contested job — the Decide / Quick Release / Quick Refund card. */
const OPEN_JOB = {
  id: "job-open",
  title: "Haul brush after the storm",
  budget: 180,
  status: "disputed",
  customer_id: "poster-1",
  helper_id: "helper-1",
  stripe_payment_intent_id: "pi_open",
  dispute_reason: "no_show",
  dispute_evidence_urls: [],
  disputed_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  disputed_by: "helper-1",
  payment_status: "escrow",
};

/** Decided, but the split never executed — the "Retry settlement" card. */
const STUCK_JOB = {
  ...OPEN_JOB,
  id: "job-stuck",
  title: "Move a washer",
  status: "completed",
  stripe_payment_intent_id: "pi_stuck",
  dispute_resolved_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
};

const RECORDS = [
  {
    id: "dis-open",
    job_id: "job-open",
    opener_id: "helper-1",
    reason: "no_show",
    evidence_urls: [],
    status: "open",
    created_at: "2026-09-20T00:00:00Z",
    decided_at: null,
    decided_by: null,
    decision_text: null,
    payout_split: null,
    execution_status: null,
  },
  {
    id: "dis-stuck",
    job_id: "job-stuck",
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
    execution_error: "Stripe returned 502",
  },
];

/**
 * One chainable PostgREST double. Each builder records the filters applied to
 * it and resolves by SHAPE, because AdminDisputes issues two different reads
 * against `jobs` and two against `disputes` in the same load.
 */
vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const state: {
      status?: string;
      notResolved?: boolean;
      inCol?: string;
      inVals?: string[];
    } = {};
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
        if (state.status === "disputed") return [OPEN_JOB];
        if (state.notResolved) return [STUCK_JOB];
        if (state.inCol === "id") return [STUCK_JOB].filter((j) => state.inVals?.includes(j.id));
        return [];
      }
      if (table === "disputes") {
        // The unsettled PROBE filters on status alone; the RECORDS read is the
        // one keyed by job_id.
        if (state.inCol === "job_id") {
          return RECORDS.filter((r) => state.inVals?.includes(r.job_id));
        }
        return [{ job_id: "job-stuck" }];
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

const logAdminActionMock = vi.fn();
vi.mock("@/lib/adminAudit", () => ({
  logAdminAction: (...a: unknown[]) => logAdminActionMock(...a),
}));

const confirmConsequentialMock = vi.fn();
vi.mock("@/lib/toastPolicy", () => ({
  confirmConsequential: (...a: unknown[]) => confirmConsequentialMock(...a),
}));

const toastError = vi.fn();
const toastWarning = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
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

/** Every edge invoke that MOVES MONEY, by function name. */
const moneyCalls = (fn?: string) =>
  invokeMock.mock.calls.filter(([name]) =>
    fn ? name === fn : name === "create-payment" || name === "execute-dispute-split",
  );

/** Let every microtask + timer the handler could still have queued drain. */
async function drain() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Render and wait for BOTH cards — the open one and the stuck one. */
async function openConsole() {
  render(<AdminDisputes />);
  await screen.findByText(/Haul brush after the storm/);
  await screen.findByText(/Settlement failed: Stripe returned 502/);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { helper_cents: 9000, refund_cents: 9000 }, error: null });
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
  logAdminActionMock.mockReset();
  confirmConsequentialMock.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
  toastSuccess.mockReset();
  requireBiometricMock.mockReset();
  // Default PASS: every other case must read exactly as it would with no gate
  // in the component at all.
  requireBiometricMock.mockResolvedValue(true);
});

describe("AdminDisputes — the gate on Quick Release / Quick Refund", () => {
  /** Click the quick action and confirm the existing BrandConfirmDialog. */
  async function quickRelease() {
    fireEvent.click(screen.getByRole("button", { name: /Quick: Release to Helpr/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Release Payment" }));
  }

  it("a passed confirmation releases the escrow once", async () => {
    await openConsole();
    await quickRelease();

    await waitFor(() => expect(moneyCalls("create-payment")).toHaveLength(1));
    expect(moneyCalls("create-payment")[0][1]).toMatchObject({
      body: { action: "admin_release_dispute", jobId: "job-open" },
    });
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
  });

  it("a refused prompt moves NO escrow — create-payment is never invoked", async () => {
    requireBiometricMock.mockResolvedValue(false);
    await openConsole();
    await quickRelease();

    // Wait for the GATE to have resolved, then drain. Asserting the absence
    // the instant the click returns would pass with the guard deleted, because
    // the invoke is a tick further along.
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    // THE MONEY DID NOT MOVE.
    expect(moneyCalls()).toHaveLength(0);
    expect(confirmConsequentialMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The dispute is still open work, and the card is not stuck on "Working…".
    expect(screen.getByRole("button", { name: /Quick: Release to Helpr/ })).toBeEnabled();
    expect(screen.queryByText(/Working…/)).not.toBeInTheDocument();
  });

  it("a refusal RELEASES the in-flight latch — the next attempt is not dead", async () => {
    // `resolveInFlight` is set BEFORE the biometric await (that is what stops
    // two same-frame taps both reaching create-payment). Its `finally` must
    // clear it on a refusal, or a single cancelled Face ID prompt would jam
    // Quick Release for the rest of the session with no error anywhere.
    requireBiometricMock.mockResolvedValueOnce(false).mockResolvedValue(true);
    await openConsole();
    await quickRelease();
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();
    expect(moneyCalls()).toHaveLength(0);

    await quickRelease();
    await waitFor(() => expect(moneyCalls("create-payment")).toHaveLength(1));
  });

  it("the OS prompt names the escrow action, not a generic 'confirm'", async () => {
    await openConsole();
    await quickRelease();
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(String(requireBiometricMock.mock.calls[0][0])).toMatch(/releasing this escrow/i);
  });
});

describe("AdminDisputes — the gate on recording AND settling a decision", () => {
  /** Open the split panel, write the required note, submit. */
  async function recordAndSettle() {
    fireEvent.click(screen.getByRole("button", { name: /Decide Outcome…/ }));
    const note = await screen.findByLabelText(/Decision note/);
    fireEvent.change(note, { target: { value: "Helpr showed up; poster cancelled late." } });
    fireEvent.click(screen.getByRole("button", { name: "Record & Settle" }));
  }

  it("a passed confirmation records the decision and executes the split", async () => {
    await openConsole();
    await recordAndSettle();

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("rpc_decide_dispute", expect.anything()));
    await waitFor(() => expect(moneyCalls("execute-dispute-split")).toHaveLength(1));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
  });

  it("a refused prompt records NOTHING and settles NOTHING", async () => {
    requireBiometricMock.mockResolvedValue(false);
    await openConsole();
    await recordAndSettle();

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    // THE DECISION WAS NOT RECORDED AND THE MONEY DID NOT MOVE. The decision
    // half matters as much as the money: `rpc_decide_dispute` flips the job
    // off 'disputed' and notifies both parties, and it refuses a second
    // decision — so a decision written without confirmation is not undoable
    // from this console.
    expect(rpcMock).not.toHaveBeenCalled();
    expect(moneyCalls()).toHaveLength(0);
    expect(logAdminActionMock).not.toHaveBeenCalled();
    expect(confirmConsequentialMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The panel is still open with the note intact, and the button is not
    // stuck on "Settling…" — a refusal must leave the screen usable.
    expect(screen.getByRole("button", { name: "Record & Settle" })).toBeEnabled();
    expect(screen.getByLabelText(/Decision note/)).toHaveValue(
      "Helpr showed up; poster cancelled late.",
    );
  });

  it("an empty decision note is refused BEFORE any OS prompt is raised", async () => {
    // Ordering, not decoration: a rejected form must not raise a Face ID sheet
    // for an action that was never going to run.
    await openConsole();
    fireEvent.click(screen.getByRole("button", { name: /Decide Outcome…/ }));
    const submit = await screen.findByRole("button", { name: "Record & Settle" });
    expect(submit).toBeDisabled();
    expect(requireBiometricMock).not.toHaveBeenCalled();
  });
});

describe("AdminDisputes — the gate on retrying a stuck settlement", () => {
  const retryButton = () => screen.getByRole("button", { name: /Retry settlement/ });

  it("a passed confirmation retries the split once", async () => {
    await openConsole();
    fireEvent.click(retryButton());

    await waitFor(() => expect(moneyCalls("execute-dispute-split")).toHaveLength(1));
    expect(moneyCalls("execute-dispute-split")[0][1]).toMatchObject({
      body: { dispute_id: "dis-stuck" },
    });
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
  });

  it("a refused prompt re-runs NO settlement", async () => {
    requireBiometricMock.mockResolvedValue(false);
    await openConsole();
    fireEvent.click(retryButton());

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    // THE MONEY DID NOT MOVE.
    expect(moneyCalls()).toHaveLength(0);
    expect(confirmConsequentialMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The stuck case is still flagged, with its retry still offered and not
    // stuck on "Settling…".
    expect(screen.getByText(/Settlement failed: Stripe returned 502/)).toBeInTheDocument();
    expect(retryButton()).toBeEnabled();
    expect(screen.queryByText(/Settling…/)).not.toBeInTheDocument();
  });

  it("the OS prompt names the settlement, not a generic 'confirm'", async () => {
    await openConsole();
    fireEvent.click(retryButton());
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(String(requireBiometricMock.mock.calls[0][0])).toMatch(/settlement/i);
  });
});

/*
 * THREE GATES, THREE MUTATIONS — one per guard, because a single registration
 * would leave the other two deletable with this file green. Each is anchored
 * on its own `requireBiometric` call so the otherwise identical `if (!ok)
 * return;` lines stay individually addressable.
 *
 * The real module returns true on web, so only the mocked refusals above can
 * see any of these lines disappear.
 */
// @mutate src/components/admin/AdminDisputes.tsx | if (!ok) return;\n    setResolving(job.id); | setResolving(job.id);
// @mutate src/components/admin/AdminDisputes.tsx | const ok = await requireBiometric("Confirm retrying this settlement");\n    if (!ok) return; | const ok = await requireBiometric("Confirm retrying this settlement");
// @mutate src/components/admin/AdminDisputes.tsx | const ok = await requireBiometric("Confirm this dispute decision and settlement");\n    if (!ok) return; | const ok = await requireBiometric("Confirm this dispute decision and settlement");
