/**
 * usePayoutSetupHireAllowed (owner decision 2026-10-25: payout setup only
 * after a hire), the REAL hook (src/test/setup.ts defaults it to "hired" for
 * every other test). It asks payout_setup_hire_allowed_for_me for the signed-in
 * member and FAILS CLOSED: an error, a missing function (PGRST202), any
 * answer but a literal true, signed out, and while loading all read false.
 *
 * @mutate src/hooks/usePayoutSetupHireAllowed.ts |   return data === true; |   return data !== false;
 * @mutate src/hooks/usePayoutSetupHireAllowed.ts |       return unwrap(res) === true; |       return true;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.unmock("@/hooks/usePayoutSetupHireAllowed");

let signedIn = true;
vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: signedIn ? { id: "member-1" } : null, isReady: true, ready: true, session: null }),
}));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { usePayoutSetupHireAllowed } from "@/hooks/usePayoutSetupHireAllowed";

function hook() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => usePayoutSetupHireAllowed(), { wrapper });
}
const settle = async () => waitFor(() => expect(rpc).toHaveBeenCalled());

beforeEach(() => {
  signedIn = true;
  rpc.mockReset();
});

describe("usePayoutSetupHireAllowed", () => {
  it("true only when the server says true, for the signed-in member", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const { result } = hook();
    expect(result.current, "false while loading").toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(rpc).toHaveBeenCalledWith("payout_setup_hire_allowed_for_me");
  });

  it("false when the server says no", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const { result } = hook();
    await settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(false);
  });

  it("false on an error (fails closed)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    const { result } = hook();
    await settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(false);
  });

  it("false while the function is not deployed yet (PGRST202)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.payout_setup_hire_allowed_for_me" } });
    const { result } = hook();
    await settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(false);
  });

  it("false for an answer that is not a literal true", async () => {
    rpc.mockResolvedValue({ data: "true", error: null });
    const { result } = hook();
    await settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(false);
  });

  it("signed out: false and nothing asked", async () => {
    signedIn = false;
    const { result } = hook();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
