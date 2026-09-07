import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useStripeConnectCheck,
  type AwardEligibility,
  type StripeConnectCheckResult,
} from "./useStripeConnectCheck";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

/**
 * The signed-in profile, which the eligibility gate now reads for
 * `idv_status` — the HALF OF THE IDENTITY VERDICT the gate used to ignore.
 * Mocked rather than wrapped in a QueryClientProvider so these tests stay
 * about the gate's logic and not about React Query plumbing.
 */
let currentProfile: { idv_status?: string | null } | null = null;
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ profile: currentProfile }),
}));

// The operator kill switch, forced OFF for every test in this file. Without
// this, a paused IDV requirement would clear the identity arm for free and
// every "verified" assertion below would pass for the wrong reason.
vi.mock("@/lib/featureFlags", () => ({
  isIdvRequirementPaused: async () => false,
}));

/** Payout-ready in every respect, so only the identity arm is under test. */
const PAYOUT_READY = { connected: true, details_submitted: true, payouts_enabled: true };

describe("useStripeConnectCheck", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    currentProfile = null;
  });

  it("ok=true when status is connected + details_submitted (payouts may still be verifying)", async () => {
    invokeMock.mockResolvedValue({
      data: { connected: true, details_submitted: true, payouts_enabled: false },
      error: null,
    });
    const { result } = renderHook(() => useStripeConnectCheck());
    let outcome!: StripeConnectCheckResult;
    await act(async () => {
      outcome = await result.current.checkHelperStripeConnect();
    });
    expect(outcome.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("stripe-connect", { body: { action: "status" } });
  });

  it("ok=false with payout-account-needed reason when not connected", async () => {
    invokeMock.mockResolvedValue({
      data: { connected: false, details_submitted: false, payouts_enabled: false },
      error: null,
    });
    const { result } = renderHook(() => useStripeConnectCheck());
    let outcome!: StripeConnectCheckResult;
    await act(async () => {
      outcome = await result.current.checkHelperStripeConnect();
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/connect a payout account/i);
    // The caller renders a "Set up payouts" action off this flag.
    expect(outcome.needsPayoutSetup).toBe(true);
  });

  it("ok=false with incomplete-setup reason when connected but details not submitted", async () => {
    invokeMock.mockResolvedValue({
      data: { connected: true, details_submitted: false, payouts_enabled: false },
      error: null,
    });
    const { result } = renderHook(() => useStripeConnectCheck());
    let outcome!: StripeConnectCheckResult;
    await act(async () => {
      outcome = await result.current.checkHelperStripeConnect();
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/setup is incomplete/i);
    expect(outcome.needsPayoutSetup).toBe(true);
  });

  it("ok=false with generic-failure reason when invoke errors", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { result } = renderHook(() => useStripeConnectCheck());
    let outcome!: StripeConnectCheckResult;
    await act(async () => {
      outcome = await result.current.checkHelperStripeConnect();
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/Couldn't verify/i);
    // Unknown status is not evidence the account is missing — no setup action.
    expect(outcome.needsPayoutSetup).toBeFalsy();
  });

  it("ok=false when invoke throws", async () => {
    invokeMock.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useStripeConnectCheck());
    let outcome!: StripeConnectCheckResult;
    await act(async () => {
      outcome = await result.current.checkHelperStripeConnect();
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/Couldn't verify/i);
    // Unknown status is not evidence the account is missing — no setup action.
    expect(outcome.needsPayoutSetup).toBeFalsy();
  });

  it("checking flag flips true during invoke and back to false after", async () => {
    let resolveInvoke!: (v: { data: unknown; error: null }) => void;
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    const { result } = renderHook(() => useStripeConnectCheck());
    expect(result.current.checking).toBe(false);

    let pending!: Promise<StripeConnectCheckResult>;
    act(() => {
      pending = result.current.checkHelperStripeConnect();
    });
    await waitFor(() => expect(result.current.checking).toBe(true));

    resolveInvoke({
      data: { connected: true, details_submitted: true, payouts_enabled: true },
      error: null,
    });
    await act(async () => {
      await pending;
    });
    expect(result.current.checking).toBe(false);
  });
});

// The acceptance gate must give the same answer the database gives.
//
// It did not. `helper_award_block_reason()` accepts EITHER identity verdict
// since migration 20260907013734 — the Stripe Connect flag, or `idv_status =
// 'verified'` from the Stripe Identity document + selfie check. This hook read
// only the Connect flag, so it stopped people the server would have hired.
// Measured against prod 2026-09-06: one live non-seed profile with
// `idv_status = 'verified'`, `stripe_identity_verified = false`, payouts
// enabled, and `helper_award_block_reason() = NULL`.
describe("checkHelperAwardEligibility agrees with the server's gate", () => {
  beforeEach(() => {
    // Not inherited from the block above — reset here too, or a test could
    // pass on the previous one's profile instead of the one it declares.
    invokeMock.mockReset();
    currentProfile = null;
  });

  async function run(): Promise<AwardEligibility> {
    const { result } = renderHook(() => useStripeConnectCheck());
    let outcome!: AwardEligibility;
    await act(async () => {
      outcome = await result.current.checkHelperAwardEligibility();
    });
    return outcome;
  }

  it("clears a payout-ready helper verified by Stripe Identity alone", async () => {
    // Connect says no, Identity says yes, the server says HIRE.
    invokeMock.mockResolvedValue({
      data: { ...PAYOUT_READY, identity_verified: false },
      error: null,
    });
    currentProfile = { idv_status: "verified" };
    await expect(run()).resolves.toEqual({ ok: true, reason: null });
  });

  it("clears a payout-ready helper verified by Stripe Connect alone", async () => {
    invokeMock.mockResolvedValue({
      data: { ...PAYOUT_READY, identity_verified: true },
      error: null,
    });
    currentProfile = { idv_status: "pending" };
    await expect(run()).resolves.toEqual({ ok: true, reason: null });
  });

  it("still blocks when NEITHER verdict is in — the fix is not a loosening", async () => {
    invokeMock.mockResolvedValue({
      data: { ...PAYOUT_READY, identity_verified: false },
      error: null,
    });
    currentProfile = { idv_status: "pending" };
    await expect(run()).resolves.toMatchObject({
      ok: false,
      reason: "helper_identity_unverified",
    });
  });

  it("blocks on payouts first, even with identity fully verified", async () => {
    invokeMock.mockResolvedValue({
      data: { ...PAYOUT_READY, payouts_enabled: false, identity_verified: true },
      error: null,
    });
    currentProfile = { idv_status: "verified" };
    await expect(run()).resolves.toMatchObject({
      ok: false,
      reason: "helper_payout_setup_incomplete",
    });
  });

  it("reports indeterminate rather than 'not eligible' when the check fails", async () => {
    // Telling a verified helper they are unverified because a fetch dropped is
    // the bug this distinction exists to prevent — it must not be collapsed
    // into a definite refusal by the identity change above.
    invokeMock.mockRejectedValue(new Error("network down"));
    currentProfile = { idv_status: "verified" };
    await expect(run()).resolves.toMatchObject({ ok: false, indeterminate: true });
  });
});
