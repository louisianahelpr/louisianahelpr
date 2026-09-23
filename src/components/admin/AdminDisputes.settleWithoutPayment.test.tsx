// @mutate src/components/admin/adminDisputes/DisputeCard.tsx | const noPaymentOnFile = !job.stripe_payment_intent_id && !job.stripe_session_id; | const noPaymentOnFile = false;
// @mutate src/components/admin/adminDisputes/DisputeCard.tsx | const noPaymentOnFile = !job.stripe_payment_intent_id && !job.stripe_session_id; | const noPaymentOnFile = true;
// @mutate src/components/admin/AdminDisputes.tsx | const ok = await requireBiometric("Confirm closing this settlement with no payment");\n    if (!ok) return; | const ok = true;
// @mutate supabase/migrations/20260923190510_settle_dispute_without_payment.sql | IF _job.stripe_payment_intent_id IS NOT NULL\n     OR _job.stripe_session_id IS NOT NULL | IF false
// @mutate supabase/migrations/20260923190510_settle_dispute_without_payment.sql | execution_error        = 'closed by an admin, no payment on file: ' \|\| _note_clean | execution_error        = NULL
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import AdminDisputes from "./AdminDisputes";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

/**
 * Q235: a DECIDED dispute on a job with no payment on file had no way out.
 *
 * execute-dispute-split refuses such a job ("no payment intent on file"), so
 * "Retry settlement" can only fail again, UnsettledSettlements is read-only,
 * and release-payout's unsettled-dispute blocker holds the job forever. The
 * close is rpc_settle_dispute_without_payment (20260923190510), offered on the
 * unsettled card ONLY when the job has no PaymentIntent and no checkout session,
 * behind the same biometric gate as every other settlement action, with a
 * required note. Its SQL behaviour (every refusal, the audit row, the detector
 * not paging) is proven in src/test/pglite/settleDisputeWithoutPayment.pglite.mjs;
 * this pins the UI and the newest definition's money refusals.
 *
 * Fixture scaffold copied from AdminDisputes.biometricGate.test.tsx.
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

/** Decided, split refused: the job has NO payment on file (Q235). */
const STUCK_JOB = {
  ...OPEN_JOB,
  id: "job-stuck",
  title: "Move a washer",
  status: "completed",
  stripe_payment_intent_id: null,
  stripe_session_id: null,
  dispute_resolved_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
};

/** Decided, split failed, but a PaymentIntent IS on file: retry only. */
const PAID_STUCK_JOB = {
  ...STUCK_JOB,
  id: "job-paid-stuck",
  title: "Clear a gutter",
  stripe_payment_intent_id: "pi_paid",
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
    execution_error: "no payment intent on file — cannot verify or split the escrow",
  },
  {
    id: "dis-paid-stuck",
    job_id: "job-paid-stuck",
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
        if (state.notResolved) return [STUCK_JOB, PAID_STUCK_JOB];
        if (state.inCol === "id") return [STUCK_JOB, PAID_STUCK_JOB].filter((j) => state.inVals?.includes(j.id));
        return [];
      }
      if (table === "disputes") {
        // The unsettled PROBE filters on status alone; the RECORDS read is the
        // one keyed by job_id.
        if (state.inCol === "job_id") {
          return RECORDS.filter((r) => state.inVals?.includes(r.job_id));
        }
        return [{ job_id: "job-stuck" }, { job_id: "job-paid-stuck" }];
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
  await screen.findByText(/Settlement failed: no payment intent on file/);
}

beforeEach(() => {
  invokeMock.mockReset();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
  confirmConsequentialMock.mockReset();
  toastError.mockReset();
  requireBiometricMock.mockReset();
  requireBiometricMock.mockResolvedValue(true);
});

const CLOSE = /Close with no payment/;
const settleCalls = () => rpcMock.mock.calls.filter(([name]) => name === "rpc_settle_dispute_without_payment");

async function typeNoteAndClose(note = "never paid: seeded fixture") {
  fireEvent.change(screen.getByLabelText(/No payment on file/), { target: { value: note } });
  fireEvent.click(screen.getByRole("button", { name: CLOSE }));
}

describe("Q235: closing a decided dispute whose job has no payment on file", () => {
  it("is offered only on the unsettled card with no PaymentIntent or session (inventory: 2 unsettled cards, 1 close)", async () => {
    await openConsole();
    expect(screen.getAllByRole("button", { name: /Retry settlement/ }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole("button", { name: CLOSE })).toHaveLength(1);
  });

  it("needs a note before it can be pressed", async () => {
    await openConsole();
    expect(screen.getByRole("button", { name: CLOSE })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/No payment on file/), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: CLOSE })).toBeDisabled();
  });

  it("calls the RPC with the dispute and the note, behind the biometric gate, and moves no money", async () => {
    await openConsole();
    await typeNoteAndClose();
    await waitFor(() => expect(settleCalls()).toHaveLength(1));
    expect(settleCalls()[0][1]).toEqual({ _dispute_id: "dis-stuck", _note: "never paid: seeded fixture" });
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    expect(moneyCalls()).toHaveLength(0);
    await waitFor(() => expect(confirmConsequentialMock).toHaveBeenCalled());
  });

  it("a refused biometric prompt calls nothing", async () => {
    requireBiometricMock.mockResolvedValue(false);
    await openConsole();
    await typeNoteAndClose();
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();
    expect(settleCalls()).toHaveLength(0);
  });

  it("a server refusal is shown in words, not as success", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "dispute_has_payment", code: "P0001" } });
    await openConsole();
    await typeNoteAndClose();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/has a payment on file/);
    expect(confirmConsequentialMock).not.toHaveBeenCalled();
  });
});

describe("Q235: the newest rpc_settle_dispute_without_payment refuses wherever money could exist", () => {
  const MIG = resolve(__dirname, "../../../supabase/migrations");
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  let grants = "";
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.rpc_settle_dispute_without_payment\s*\(/gi)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/AS\s+(\$[A-Za-z_]*\$)/)!;
      const open = rest.indexOf(tag[1], tag.index!) + tag[1].length;
      body = rest.slice(open, rest.indexOf(tag[1], open));
    }
    for (const m of sql.matchAll(/(REVOKE|GRANT)[^;]*rpc_settle_dispute_without_payment[^;]*;/gi)) grants += m[0] + "\n";
  }

  it("is defined (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(body.length).toBeGreaterThan(500);
  });

  it("is admin-only, anon cannot execute it", () => {
    expect(body).toMatch(/IF NOT public\.has_role\(_uid, 'admin'\) THEN\s+RAISE EXCEPTION 'admin only'/);
    expect(grants).toMatch(/REVOKE ALL ON FUNCTION public\.rpc_settle_dispute_without_payment\(uuid, text\) FROM PUBLIC, anon;/);
  });

  it("refuses a job with a PaymentIntent, a session or a gift card, and a live claim", () => {
    expect(body).toMatch(/_job\.stripe_payment_intent_id IS NOT NULL\s+OR _job\.stripe_session_id IS NOT NULL/);
    expect(body).toMatch(/g\.status IN \('redeemed', 'reserved'\)/);
    expect(body).toMatch(/RAISE EXCEPTION 'dispute_has_payment'/);
    expect(body).toMatch(/c\.money_step_at IS NOT NULL/);
  });

  it("locks the job before the dispute and writes a reason, so the no-money detector stays quiet", () => {
    expect(body.indexOf("FROM public.jobs")).toBeLessThan(body.indexOf("FROM public.disputes\n   WHERE id = _dispute_id\n     FOR UPDATE"));
    expect(body).toMatch(/execution_error\s+= 'closed by an admin, no payment on file: ' \|\| _note_clean/);
    expect(body).toMatch(/INSERT INTO public\.admin_audit_log/);
  });
});
