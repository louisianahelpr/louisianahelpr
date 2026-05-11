import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Hoisted mocks
const mocks = vi.hoisted(() => {
  // Profile + roles query mocks
  const profileMaybeSingle = vi.fn();
  const rolesMaybeSingle = vi.fn();
  // .from(...) returns a builder; .select().eq()...maybeSingle() resolves.
  // We need to differentiate "profiles" vs "user_roles" calls.
  const fromMock = vi.fn((table: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle:
        table === "profiles"
          ? profileMaybeSingle
          : table === "user_roles"
          ? rolesMaybeSingle
          : vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    return builder;
  });

  // Realtime channel mock — capture handler so tests can fire INSERT/UPDATE
  // events on the profile row and assert the cache invalidates.
  const subscribeMock = vi.fn().mockReturnValue(undefined);
  const onMock = vi.fn();
  const removeChannelMock = vi.fn();
  let channelHandler: (() => void) | null = null;
  const channelMock = vi.fn(() => {
    const channel = {
      on: (
        _eventType: string,
        _config: unknown,
        handler: () => void,
      ) => {
        channelHandler = handler;
        return channel;
      },
      subscribe: () => channel,
    };
    onMock();
    subscribeMock();
    return channel;
  });

  // Auth-ready mock
  const authReadyState: { user: { id: string } | null; isReady: boolean } = {
    user: null,
    isReady: false,
  };

  return {
    profileMaybeSingle,
    rolesMaybeSingle,
    fromMock,
    channelMock,
    subscribeMock,
    onMock,
    removeChannelMock,
    channelHandlerRef: { get: () => channelHandler, reset: () => { channelHandler = null; } },
    authReadyState,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mocks.fromMock(args[0] as string),
    channel: (...args: unknown[]) => mocks.channelMock(...args),
    removeChannel: (...args: unknown[]) => mocks.removeChannelMock(...args),
  },
}));

vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => mocks.authReadyState,
}));

import { useCurrentUser } from "./useCurrentUser";

const wrap = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("useCurrentUser", () => {
  beforeEach(() => {
    mocks.profileMaybeSingle.mockReset();
    mocks.rolesMaybeSingle.mockReset();
    mocks.fromMock.mockClear();
    mocks.channelMock.mockClear();
    mocks.subscribeMock.mockClear();
    mocks.onMock.mockClear();
    mocks.removeChannelMock.mockReset();
    mocks.channelHandlerRef.reset();
    mocks.authReadyState.user = null;
    mocks.authReadyState.isReady = false;
  });

  it("returns isLoading=true while auth is not ready", () => {
    mocks.authReadyState.user = null;
    mocks.authReadyState.isReady = false;
    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  it("returns isLoading=false when auth resolved AND no user (signed-out)", () => {
    mocks.authReadyState.user = null;
    mocks.authReadyState.isReady = true;
    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("does NOT query profile/roles when there's no user", () => {
    mocks.authReadyState.user = null;
    mocks.authReadyState.isReady = true;
    renderHook(() => useCurrentUser(), { wrapper: wrap });
    // Only the channel subscription is gated by user.id, so neither
    // .from() (profile/roles) nor .channel() should be called.
    expect(mocks.fromMock).not.toHaveBeenCalled();
    expect(mocks.channelMock).not.toHaveBeenCalled();
  });

  it("hydrates profile + isAdmin when user is signed in and admin", async () => {
    mocks.authReadyState.user = { id: "u1" };
    mocks.authReadyState.isReady = true;
    mocks.profileMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", full_name: "Lexi", approval_status: "approved" },
      error: null,
    });
    mocks.rolesMaybeSingle.mockResolvedValue({
      data: { role: "admin" },
      error: null,
    });

    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile?.full_name).toBe("Lexi");
    expect(result.current.isAdmin).toBe(true);
  });

  it("hydrates profile with isAdmin=false for non-admin users", async () => {
    mocks.authReadyState.user = { id: "u1" };
    mocks.authReadyState.isReady = true;
    mocks.profileMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", full_name: "Lexi" },
      error: null,
    });
    mocks.rolesMaybeSingle.mockResolvedValue({
      data: null, // no admin row
      error: null,
    });

    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
  });

  it("subscribes to a postgres_changes channel for the user's profile row", async () => {
    mocks.authReadyState.user = { id: "u1" };
    mocks.authReadyState.isReady = true;
    mocks.profileMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.rolesMaybeSingle.mockResolvedValue({ data: null, error: null });

    renderHook(() => useCurrentUser(), { wrapper: wrap });
    await waitFor(() => expect(mocks.channelMock).toHaveBeenCalledOnce());
    // Channel name includes the user id + a UUID nonce
    const channelName = mocks.channelMock.mock.calls[0][0] as string;
    expect(channelName).toMatch(/^profile-self-u1-/);
  });

  it("re-fetches profile when the realtime channel fires (admin flips status)", async () => {
    mocks.authReadyState.user = { id: "u1" };
    mocks.authReadyState.isReady = true;
    mocks.profileMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", full_name: "Lexi", approval_status: "pending" },
      error: null,
    });
    mocks.rolesMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
    await waitFor(() => expect(result.current.profile).toBeTruthy());
    expect(result.current.profile?.approval_status).toBe("pending");

    // Now the admin "approves" the user — realtime fires, refetch returns
    // the updated row.
    mocks.profileMaybeSingle.mockResolvedValue({
      data: { user_id: "u1", full_name: "Lexi", approval_status: "approved" },
      error: null,
    });

    await act(async () => {
      mocks.channelHandlerRef.get()?.();
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    await waitFor(() =>
      expect(result.current.profile?.approval_status).toBe("approved"),
    );
  });

  it("removes the channel on unmount", async () => {
    mocks.authReadyState.user = { id: "u1" };
    mocks.authReadyState.isReady = true;
    mocks.profileMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.rolesMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { unmount } = renderHook(() => useCurrentUser(), { wrapper: wrap });
    await waitFor(() => expect(mocks.channelMock).toHaveBeenCalledOnce());
    unmount();
    expect(mocks.removeChannelMock).toHaveBeenCalledOnce();
  });

  it("returns a refresh() that invalidates the user query", async () => {
    mocks.authReadyState.user = { id: "u1" };
    mocks.authReadyState.isReady = true;
    let profileCallCount = 0;
    mocks.profileMaybeSingle.mockImplementation(async () => {
      profileCallCount += 1;
      return {
        data: { user_id: "u1", full_name: `Lexi v${profileCallCount}` },
        error: null,
      };
    });
    mocks.rolesMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
    await waitFor(() => expect(result.current.profile?.full_name).toBe("Lexi v1"));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.profile?.full_name).toBe("Lexi v2"));
  });

  it("refresh() is a no-op when there's no user", async () => {
    mocks.authReadyState.user = null;
    mocks.authReadyState.isReady = true;
    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
    await act(async () => {
      await result.current.refresh();
    });
    // No throw, no error. Just verify it didn't try to query.
    expect(mocks.fromMock).not.toHaveBeenCalled();
  });
});
