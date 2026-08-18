import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStripeConnectStatus } from "./useStripeConnectStatus";

const mocks = vi.hoisted(() => {
  const invoke = vi.fn();
  const report = vi.fn();
  const store = new Map<string, string>();
  const currentUser: { user: { id: string } | null; profile: { approval_status: string } | null } = {
    user: { id: "u1" },
    profile: { approval_status: "approved" },
  };
  return { invoke, report, store, currentUser };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mocks.invoke(...args) } },
}));

vi.mock("@/lib/errorLogger", () => ({ report: (...args: unknown[]) => mocks.report(...args) }));

vi.mock("@/lib/safeStorage", () => ({
  safeStorage: {
    getItem: (k: string) => mocks.store.get(k) ?? null,
    setItem: (k: string, v: string) => { mocks.store.set(k, v); },
    removeItem: (k: string) => { mocks.store.delete(k); },
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => mocks.currentUser,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SEED_KEY = "helpr_payouts_enabled_u1";

describe("useStripeConnectStatus", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.report.mockReset();
    mocks.store.clear();
    mocks.currentUser.user = { id: "u1" };
    mocks.currentUser.profile = { approval_status: "approved" };
  });

  it("payouts enabled → nothing to prompt, and remembers it for next cold launch", async () => {
    mocks.invoke.mockResolvedValue({
      data: { connected: true, details_submitted: true, payouts_enabled: true },
      error: null,
    });
    const { result } = renderHook(() => useStripeConnectStatus(), { wrapper });
    await waitFor(() => expect(mocks.store.get(SEED_KEY)).toBe("1"));
    expect(result.current.payoutPrompt).toEqual({ kind: "none" });
  });

  it("payouts not enabled → setup prompt", async () => {
    mocks.invoke.mockResolvedValue({
      data: { connected: true, details_submitted: false, payouts_enabled: false },
      error: null,
    });
    const { result } = renderHook(() => useStripeConnectStatus(), { wrapper });
    await waitFor(() => expect(result.current.payoutPrompt).toEqual({ kind: "setup" }));
    expect(mocks.store.get(SEED_KEY)).toBe("0");
    expect(mocks.invoke).toHaveBeenCalledWith("stripe-connect", { body: { action: "status" } });
  });

  it("a FAILED status call is its own state, never a silent 'none'", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("edge function down") });
    const { result } = renderHook(() => useStripeConnectStatus(), { wrapper });
    await waitFor(() => expect(result.current.payoutPrompt).toEqual({ kind: "error" }));
    expect(mocks.report).toHaveBeenCalled();
    // A failure must not overwrite the remembered answer.
    expect(mocks.store.has(SEED_KEY)).toBe(false);
  });

  it("a malformed response is a failure, not an answer", async () => {
    mocks.invoke.mockResolvedValue({ data: { unexpected: true }, error: null });
    const { result } = renderHook(() => useStripeConnectStatus(), { wrapper });
    await waitFor(() => expect(result.current.payoutPrompt).toEqual({ kind: "error" }));
    expect(mocks.report).toHaveBeenCalled();
  });

  it("reserves the banner's slot while pending ONLY when the last answer said payouts were off", async () => {
    mocks.store.set(SEED_KEY, "0");
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStripeConnectStatus(), { wrapper });
    expect(result.current.payoutPrompt).toEqual({ kind: "reserve" });
  });

  it("does NOT reserve a slot for a user last known to have payouts working", async () => {
    mocks.store.set(SEED_KEY, "1");
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStripeConnectStatus(), { wrapper });
    expect(result.current.payoutPrompt).toEqual({ kind: "none" });
  });

  it("does NOT reserve a slot on a first-ever check (no remembered answer)", async () => {
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStripeConnectStatus(), { wrapper });
    expect(result.current.payoutPrompt).toEqual({ kind: "none" });
  });

  it("never asks Stripe for an account that isn't approved yet", async () => {
    mocks.currentUser.profile = { approval_status: "pending" };
    const { result } = renderHook(() => useStripeConnectStatus(), { wrapper });
    expect(result.current.payoutPrompt).toEqual({ kind: "none" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
