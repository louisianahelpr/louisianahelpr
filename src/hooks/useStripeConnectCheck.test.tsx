import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useStripeConnectCheck, type StripeConnectCheckResult } from "./useStripeConnectCheck";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

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
    expect(outcome.reason).toMatch(/Unable to verify/i);
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
    expect(outcome.reason).toMatch(/Unable to verify/i);
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
