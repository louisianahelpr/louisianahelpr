import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProfile, fetchProfile, useInvalidateProfile } from "./useProfile";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

const sampleRow = {
  user_id: "user-1",
  full_name: "Marie Beaumont",
  email: "marie@example.com",
  avatar_url: null,
  ban_status: null,
  approval_status: "approved",
  idv_status: "verified",
  created_at: "2026-01-01T00:00:00Z",
  bio: null,
  location: "New Orleans",
  onboarding_fee_paid: true,
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}

describe("fetchProfile", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it("queries profiles table with the right column list and user_id filter", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const result = await fetchProfile("user-1");
    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(selectMock).toHaveBeenCalledWith(expect.stringContaining("user_id"));
    expect(selectMock).toHaveBeenCalledWith(expect.stringContaining("full_name"));
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual(sampleRow);
  });

  it("returns null when no row found", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const result = await fetchProfile("missing-user");
    expect(result).toBeNull();
  });

  it("throws when supabase returns an error", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: new Error("RLS denied") });
    await expect(fetchProfile("user-1")).rejects.toThrow("RLS denied");
  });
});

describe("useProfile", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it("does not fetch when userId is null", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProfile(null), { wrapper });
    // Wait a tick — should still be idle/disabled
    await new Promise((r) => setTimeout(r, 10));
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
  });

  it("does not fetch when userId is undefined", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const { wrapper } = makeWrapper();
    renderHook(() => useProfile(undefined), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("fetches and returns the profile when userId is provided", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProfile("user-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(sampleRow));
    expect(fromMock).toHaveBeenCalledWith("profiles");
  });

  it("surfaces errors via the query result", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProfile("user-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useInvalidateProfile", () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it("invalidates the profile query slot for the given user", async () => {
    maybeSingleMock.mockResolvedValue({ data: sampleRow, error: null });
    const { wrapper, client } = makeWrapper();

    const { result: profileResult } = renderHook(() => useProfile("user-1"), { wrapper });
    await waitFor(() => expect(profileResult.current.data).toEqual(sampleRow));
    expect(fromMock).toHaveBeenCalledTimes(1);

    const { result: invalidateResult } = renderHook(() => useInvalidateProfile(), { wrapper });
    // After invalidate, react-query re-fetches; with our 0 staleTime, it should fire immediately.
    await act(async () => {
      await invalidateResult.current("user-1");
    });
    await waitFor(() => expect(fromMock).toHaveBeenCalledTimes(2));
    // Sanity: invalidate hit the right key
    expect(client.getQueryState(["profile", "user-1"])).toBeDefined();
  });
});
