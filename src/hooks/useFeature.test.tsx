import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * useFeature fails closed: false while auth or the read is pending, on an RPC
 * error, on any answer but `true`, and when signed out (no RPC at all).
 */
// @mutate src/hooks/useFeature.ts | return isReady && !!uid && isSuccess && data === true; | return data !== false;
// @mutate src/hooks/useFeature.ts |     enabled: isReady && !!uid, |     enabled: true,

const rpc = vi.fn();
const auth = { user: { id: "u1" } as { id: string } | null, isReady: true };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));

import { useFeature } from "./useFeature";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  rpc.mockReset();
  auth.user = { id: "u1" };
  auth.isReady = true;
});

describe("useFeature", () => {
  it("is true only when the server answers true, and false while it is loading", async () => {
    let resolve!: (v: unknown) => void;
    rpc.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useFeature("switch_canary"), { wrapper });
    expect(result.current).toBe(false);
    resolve({ data: true, error: null });
    await waitFor(() => expect(result.current).toBe(true));
    expect(rpc).toHaveBeenCalledWith("feature_enabled_for", { p_key: "switch_canary" });
  });

  it("is false on an RPC error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } });
    const { result } = renderHook(() => useFeature("switch_canary"), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(false);
  });

  it("is false for a non-boolean answer", async () => {
    rpc.mockResolvedValue({ data: "true", error: null });
    const { result } = renderHook(() => useFeature("switch_canary"), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(false);
  });

  it("is false and asks nothing when signed out or auth is not ready", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    auth.user = null;
    const a = renderHook(() => useFeature("switch_canary"), { wrapper });
    auth.user = { id: "u1" };
    auth.isReady = false;
    const b = renderHook(() => useFeature("switch_canary"), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
