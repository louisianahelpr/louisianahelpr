import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminJobs from "./AdminJobs";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/**
 * THE BIOMETRIC GATE IN FRONT OF AN ADMIN REFUND.
 *
 * An admin refund pulls a captured payment back out of Stripe and, when it is
 * a full one, cancels the job. There is no undo. `requireBiometric()` stands in
 * front of it — and until 2026-09-21 nothing could see that it did:
 * `requireBiometric` opens with `if (!isNativePlatform) return true;`, so the
 * real module passes unconditionally under vitest and `if (!ok) return;` was
 * deletable with every AdminJobs test green.
 *
 * The one other file that renders this component
 * (adminJobs/adminJobsNotifications.test.tsx) mocks the gate to a bare
 * `async () => true`. That is not coverage — it is the opposite: it removes the
 * gate from that test's world so the surrounding assertions pass. Here the mock
 * has a handle, defaults to `true`, and is driven to `false` in the case below,
 * which asserts `create-payment` was never invoked.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

const JOB_ID = "job-refund-1";
const POSTER_ID = "poster-1";

const job = {
  id: JOB_ID,
  title: "Haul off storm debris",
  customer_id: POSTER_ID,
  helper_id: null,
  status: "completed",
  // Refund is only offered once money has actually changed hands.
  payment_status: "escrow",
  budget: 240,
  location: "Houma, LA",
  category: "Hauling",
  description: "Two trailer loads.",
  created_at: "2026-09-01T12:00:00Z",
  date_needed: jobLocalDateISO(-3),
  flag_reasons: null,
};

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (table: string) => {
      if (table === "jobs") {
        return {
          select: () => ({ order: async () => ({ data: [job], error: null }) }),
          update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: JOB_ID }], error: null }) }) }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ user_id: POSTER_ID, full_name: "Marie Beaumont" }],
              error: null,
            }),
          }),
        };
      }
      if (table === "notifications") {
        return { insert: () => ({ select: async () => ({ data: [{ id: "n1" }], error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
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

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));

/** Every `create-payment` call that actually asks Stripe to refund. */
const refundCalls = () =>
  invokeMock.mock.calls.filter(
    ([fn, opts]) =>
      fn === "create-payment" &&
      (opts as { body?: { action?: string } } | undefined)?.body?.action === "admin_refund_general",
  );

/** Deep-link straight to the job, open Refund Poster, land on Issue Refund. */
async function openRefundDialog() {
  render(
    <MemoryRouter initialEntries={[`/admin?view=jobs&job=${JOB_ID}`]}>
      <AdminJobs />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Refund Poster/i }));
  return await screen.findByRole("button", { name: /Issue Refund/i });
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  toastError.mockReset();
  toastSuccess.mockReset();
  reportMock.mockReset();
  requireBiometricMock.mockReset();
  // Default PASS — the happy path below must read exactly as it would with no
  // gate at all, so nothing else in the suite is bent around this mock.
  requireBiometricMock.mockResolvedValue(true);
  window.localStorage.clear();
});

describe("AdminJobs — the refund confirmation", () => {
  it("a passed confirmation issues the refund once", async () => {
    const confirm = await openRefundDialog();
    fireEvent.click(confirm);

    await waitFor(() => expect(refundCalls()).toHaveLength(1));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    expect(refundCalls()[0][1]).toMatchObject({ body: { jobId: JOB_ID } });
    // Full refund (amount left blank) — the dialog closes behind it. Drained
    // with `act`, then asserted once: a `waitFor` on an ABSENCE passes on its
    // first poll, before anything has happened (see waitForEmptyIsVacuous).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("button", { name: /Issue Refund/i })).not.toBeInTheDocument();
  });

  it("a refused Face ID prompt refunds nothing — no create-payment call, dialog stays open", async () => {
    requireBiometricMock.mockResolvedValue(false);
    const confirm = await openRefundDialog();
    fireEvent.click(confirm);

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    // Drain what the handler could still have queued: asserting "not called"
    // the instant the gate resolves would pass with the guard deleted, because
    // the invoke is a tick further along.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // THE ACTION DID NOT HAPPEN.
    expect(refundCalls()).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // …and the refund dialog is still standing, not stuck on "Refunding…", so
    // the admin can see the refund did not go through and retry deliberately.
    expect(screen.getByRole("button", { name: /Issue Refund/i })).toBeInTheDocument();
    expect(screen.queryByText(/Refunding…/)).not.toBeInTheDocument();
  });

  it("the amount check runs BEFORE the prompt — a rejected form never raises an OS sheet", async () => {
    // Prompting for a refund that validation is about to refuse trains admins
    // to approve sheets that mean nothing.
    await openRefundDialog();
    fireEvent.change(screen.getByLabelText(/Refund amount/i), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: /Issue Refund/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(requireBiometricMock).not.toHaveBeenCalled();
    expect(refundCalls()).toHaveLength(0);
  });
});

// `if (!ok) return;` is the whole gate. Without it a refused, cancelled or
// locked-out Face ID prompt still pulls the money back out of Stripe and
// cancels the job. The real module returns true on web, so only the mocked
// refusal above can see this line go missing.
// @mutate src/components/admin/AdminJobs.tsx | if (!ok) return;\n\n    setRefunding(true); | setRefunding(true);
