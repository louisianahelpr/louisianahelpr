import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => {
  const maybeSingleMock = vi.fn();
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: maybeSingleMock,
  };
  const fromMock = vi.fn((..._args: unknown[]) => builder);
  const useAuthReadyMock = vi.fn();
  return { maybeSingleMock, fromMock, useAuthReadyMock };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => mocks.fromMock(...args) },
}));
vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => mocks.useAuthReadyMock(),
}));

import { useMyBusiness } from "./useMyBusiness";

const wrap = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("useMyBusiness", () => {
  beforeEach(() => {
    mocks.maybeSingleMock.mockReset();
    mocks.fromMock.mockClear();
    mocks.useAuthReadyMock.mockReset();
  });

  it("returns business=null and isLoading=true while auth not ready", () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: null, isReady: false });
    const { result } = renderHook(() => useMyBusiness(), { wrapper: wrap });
    expect(result.current.business).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("returns business=null and isLoading=false when auth ready but no user", () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: null, isReady: true });
    const { result } = renderHook(() => useMyBusiness(), { wrapper: wrap });
    expect(result.current.business).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("returns null when the user has no active business membership", async () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: { id: "u1" }, isReady: true });
    mocks.maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useMyBusiness(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.business).toBeNull();
  });

  it("returns null when the query errors", async () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: { id: "u1" }, isReady: true });
    mocks.maybeSingleMock.mockResolvedValue({ data: null, error: new Error("rls denied") });
    const { result } = renderHook(() => useMyBusiness(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.business).toBeNull();
  });

  it("hydrates the business membership for an OWNER (is_owner=true)", async () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: { id: "u1" }, isReady: true });
    mocks.maybeSingleMock.mockResolvedValue({
      data: {
        business_id: "b1",
        role: "owner",
        businesses: { id: "b1", name: "Lexi LLC", owner_id: "u1", seat_tier: "team" },
      },
      error: null,
    });
    const { result } = renderHook(() => useMyBusiness(), { wrapper: wrap });
    await waitFor(() => expect(result.current.business).not.toBeNull());
    expect(result.current.business).toEqual({
      business_id: "b1",
      business_name: "Lexi LLC",
      role: "owner",
      is_owner: true,
      seat_tier: "team",
      seat_limit: 3,
      extended_role: "owner",
      require_approval_above: null,
      require_2fa: false,
      default_payment_method_id: null,
      monthly_budget: null,
      monthly_budget_alert_at: null,
      // verification_status defaults to 'none' when the mocked businesses
      // row omits it (fresh-signup + pre-migration parity).
      verification_status: "none",
    });
  });

  it("hydrates a MEMBER (is_owner=false because owner_id != user.id)", async () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: { id: "u2" }, isReady: true });
    mocks.maybeSingleMock.mockResolvedValue({
      data: {
        business_id: "b1",
        role: "member",
        businesses: { id: "b1", name: "Lexi LLC", owner_id: "u1", seat_tier: "crew" },
      },
      error: null,
    });
    const { result } = renderHook(() => useMyBusiness(), { wrapper: wrap });
    await waitFor(() => expect(result.current.business?.role).toBe("member"));
    expect(result.current.business?.is_owner).toBe(false);
    expect(result.current.business?.seat_limit).toBe(2);
  });

  it("falls back to seat_tier='starter' when the businesses row has no tier", async () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: { id: "u1" }, isReady: true });
    mocks.maybeSingleMock.mockResolvedValue({
      data: {
        business_id: "b1",
        role: "owner",
        businesses: { id: "b1", name: "x", owner_id: "u1", seat_tier: null },
      },
      error: null,
    });
    const { result } = renderHook(() => useMyBusiness(), { wrapper: wrap });
    await waitFor(() => expect(result.current.business).not.toBeNull());
    expect(result.current.business?.seat_tier).toBe("starter");
    expect(result.current.business?.seat_limit).toBe(1);
  });

  it("maps every known seat tier to its correct limit", async () => {
    const cases: Array<["starter" | "crew" | "team" | "enterprise", number]> = [
      ["starter", 1],
      ["crew", 2],
      ["team", 3],
      ["enterprise", 4],
    ];
    for (const [tier, expected] of cases) {
      mocks.fromMock.mockClear();
      mocks.maybeSingleMock.mockResolvedValue({
        data: {
          business_id: "b1",
          role: "owner",
          businesses: { id: "b1", name: "x", owner_id: "u1", seat_tier: tier },
        },
        error: null,
      });
      mocks.useAuthReadyMock.mockReturnValue({ user: { id: "u1" }, isReady: true });
      const { result, unmount } = renderHook(() => useMyBusiness(), { wrapper: wrap });
      await waitFor(() => expect(result.current.business?.seat_tier).toBe(tier));
      expect(result.current.business?.seat_limit).toBe(expected);
      unmount();
    }
  });

  it("does NOT fire the query when isReady is false (gates DB calls behind auth)", () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: null, isReady: false });
    renderHook(() => useMyBusiness(), { wrapper: wrap });
    expect(mocks.fromMock).not.toHaveBeenCalled();
  });
});
