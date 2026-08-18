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
      // No override on this mocked row -> 0, so seat_limit is the tier base.
      extra_seats: 0,
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

  // The "4+" in the Enterprise pricing row is `businesses.extra_seats`
  // (migration 20260818150000): negotiated seats added on top of the tier base.
  // The client MUST match `business_seat_limit_for_tier(seat_tier) +
  // COALESCE(extra_seats, 0)` or the seat meter and the invite gate go back to
  // disagreeing with the trigger that actually binds.
  describe("extra_seats override", () => {
    const hydrate = async (businesses: Record<string, unknown>) => {
      mocks.fromMock.mockClear();
      mocks.useAuthReadyMock.mockReturnValue({ user: { id: "u1" }, isReady: true });
      mocks.maybeSingleMock.mockResolvedValue({
        data: { business_id: "b1", role: "owner", businesses: { id: "b1", name: "x", owner_id: "u1", ...businesses } },
        error: null,
      });
      const { result, unmount } = renderHook(() => useMyBusiness(), { wrapper: wrap });
      await waitFor(() => expect(result.current.business).not.toBeNull());
      const business = result.current.business;
      unmount();
      return business;
    };

    it("a 6-seat Enterprise deal: tier 4 + 2 extra = 6 (the bug this fixes)", async () => {
      const business = await hydrate({ seat_tier: "enterprise", extra_seats: 2 });
      expect(business?.extra_seats).toBe(2);
      expect(business?.seat_limit).toBe(6);
    });

    it("the override rides on top of ANY tier, not just enterprise", async () => {
      expect((await hydrate({ seat_tier: "starter", extra_seats: 3 }))?.seat_limit).toBe(4);
      expect((await hydrate({ seat_tier: "crew", extra_seats: 1 }))?.seat_limit).toBe(3);
    });

    it("a missing or null override is 0, so nothing changes for the other businesses", async () => {
      expect((await hydrate({ seat_tier: "team" }))?.seat_limit).toBe(3);
      expect((await hydrate({ seat_tier: "team", extra_seats: null }))?.seat_limit).toBe(3);
      expect((await hydrate({ seat_tier: "team", extra_seats: 0 }))?.extra_seats).toBe(0);
    });

    it("a negative or non-numeric override fails CLOSED to the tier base", async () => {
      // A DB CHECK refuses negatives, so this only fires if that constraint is
      // ever dropped or PostgREST hands back something unexpected — in which
      // case the UI must not silently SUBTRACT seats the customer paid for.
      expect((await hydrate({ seat_tier: "team", extra_seats: -5 }))?.seat_limit).toBe(3);
      expect((await hydrate({ seat_tier: "team", extra_seats: "junk" }))?.seat_limit).toBe(3);
    });
  });

  it("does NOT fire the query when isReady is false (gates DB calls behind auth)", () => {
    mocks.useAuthReadyMock.mockReturnValue({ user: null, isReady: false });
    renderHook(() => useMyBusiness(), { wrapper: wrap });
    expect(mocks.fromMock).not.toHaveBeenCalled();
  });
});
