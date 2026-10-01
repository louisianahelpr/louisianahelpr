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

/** Payout-ready in every respect. */
const PAYOUT_READY = { connected: true, details_submitted: true, payouts_enabled: true };

describe("useStripeConnectCheck", () => {
  beforeEach(() => {
    invokeMock.mockReset();
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
// Since 2026-10-01 (migration 20261001222911_remove_idv_requirement)
// helper_award_block_reason() refuses on payouts only: identity verification
// gates nothing, so this hook must not consult it either.
describe("checkHelperAwardEligibility agrees with the server's gate", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  async function run(): Promise<AwardEligibility> {
    const { result } = renderHook(() => useStripeConnectCheck());
    let outcome!: AwardEligibility;
    await act(async () => {
      outcome = await result.current.checkHelperAwardEligibility();
    });
    return outcome;
  }

  it("clears a payout-ready helper whatever Stripe says about identity", async () => {
    invokeMock.mockResolvedValue({
      data: { ...PAYOUT_READY, identity_verified: false },
      error: null,
    });
    await expect(run()).resolves.toEqual({ ok: true, reason: null });
  });

  it("blocks on payouts, even with identity fully verified", async () => {
    invokeMock.mockResolvedValue({
      data: { ...PAYOUT_READY, payouts_enabled: false, identity_verified: true },
      error: null,
    });
    await expect(run()).resolves.toMatchObject({
      ok: false,
      reason: "helper_payout_setup_incomplete",
    });
  });

  it("reports indeterminate rather than 'not eligible' when the check fails", async () => {
    // Telling a ready helper they are blocked because a fetch dropped is the
    // bug this distinction exists to prevent — it must not be collapsed into a
    // definite refusal.
    invokeMock.mockRejectedValue(new Error("network down"));
    await expect(run()).resolves.toMatchObject({ ok: false, indeterminate: true });
  });
});

// Shown able to fail: make the gate ignore payouts, and the
// "blocks on payouts" test above goes red.
// @mutate src/lib/awardGate.ts | if (!status.connected \|\| !status.details_submitted \|\| status.payouts_enabled !== true) { | if (false) {
