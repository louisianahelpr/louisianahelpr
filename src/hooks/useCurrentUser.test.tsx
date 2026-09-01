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
  const channelMock = vi.fn((..._args: unknown[]) => {
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
    expect(result.current.adminStatus).toBe("admin");
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
    // A CONFIRMED non-admin — the role query answered, it just answered "no".
    expect(result.current.adminStatus).toBe("not_admin");
  });

  // ── Role lookup that cannot answer: "unknown" is not "not an admin" ───────
  //
  // The regression: the role lookup was wrapped in `.catch(() => false)`, so a
  // slow or failing `user_roles` response was reported as a confirmed
  // non-admin. AdminRoute reads that and redirects to /dashboard, so a real
  // admin on a bad connection is silently told they have no admin rights —
  // with no way to tell a permissions problem from a network one. Reproduced
  // against prod on 2026-08-31 with the role row present.
  describe("undetermined admin state", () => {
    it("reports adminStatus='unknown' (not 'not_admin') when the role query errors", async () => {
      mocks.authReadyState.user = { id: "u1" };
      mocks.authReadyState.isReady = true;
      mocks.profileMaybeSingle.mockResolvedValue({
        data: { user_id: "u1", full_name: "Lexi" },
        error: null,
      });
      mocks.rolesMaybeSingle.mockResolvedValue({
        data: null,
        error: { message: "network error" },
      });

      const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.adminStatus).toBe("unknown");
      // Fail CLOSED: an undetermined check grants nothing.
      expect(result.current.isAdmin).toBe(false);
      // ...but the profile still loads — the role failure must never blank
      // the account screen (the older regression this catch exists for).
      expect(result.current.profile?.full_name).toBe("Lexi");
    });

    it("reports adminStatus='unknown' when the role query is slower than the 10s timeout", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mocks.authReadyState.user = { id: "u1" };
        mocks.authReadyState.isReady = true;
        mocks.profileMaybeSingle.mockResolvedValue({
          data: { user_id: "u1", full_name: "Lexi" },
          error: null,
        });
        // A slow network, not a broken one: the request is in flight and the
        // row IS there — it simply has not come back inside the budget. This
        // is the exact prod shape (response body confirmed [{"role":"admin"}]).
        mocks.rolesMaybeSingle.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ data: { role: "admin" }, error: null }), 30_000);
            }),
        );

        const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(11_000);
        });

        // Gate on the SETTLED state first. `adminStatus` is legitimately
        // "unknown" on the loading render too, so asserting it without this
        // would pass vacuously against the old `.catch(() => false)` code.
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.adminStatus).toBe("unknown");
        expect(result.current.isAdmin).toBe(false);
        // The old behaviour was indistinguishable from this:
        //   adminStatus would have been "not_admin" and AdminRoute would have
        //   redirected with no explanation.
      } finally {
        vi.useRealTimers();
      }
    });

    it("is retryable: refresh() resolves 'unknown' to 'admin' once the network recovers", async () => {
      mocks.authReadyState.user = { id: "u1" };
      mocks.authReadyState.isReady = true;
      mocks.profileMaybeSingle.mockResolvedValue({
        data: { user_id: "u1", full_name: "Lexi" },
        error: null,
      });
      mocks.rolesMaybeSingle.mockResolvedValue({
        data: null,
        error: { message: "network error" },
      });

      const { result } = renderHook(() => useCurrentUser(), { wrapper: wrap });
      // Settled-state gate — see the note in the timeout test above.
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.adminStatus).toBe("unknown");

      // Network comes back; the retry affordance re-runs the check.
      mocks.rolesMaybeSingle.mockResolvedValue({ data: { role: "admin" }, error: null });
      await act(async () => {
        await result.current.refresh();
      });

      await waitFor(() => expect(result.current.adminStatus).toBe("admin"));
      expect(result.current.isAdmin).toBe(true);
    });
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

  it("surfaces isError=true and isLoading=false when the profile fetch fails", async () => {
    // Regression test for the PR #303 follow-up: if useQuery errors after
    // its retries, the hook must NOT stay isLoading=true forever (which
    // previously caused ProtectedRoute to fall through its gate and render
    // unguarded children for banned/denied users).
    //
    // The production hook sets `retry: 2`, so a real failure takes ~7s of
    // backoff. The test doesn't need to validate React Query's retry
    // behavior — only that, once the query has *settled* in an error
    // state, our `isError` is surfaced and `isLoading` flips to false.
    // Drive that state directly through the cache.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const localWrap = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    mocks.authReadyState.user = { id: "u1" };
    mocks.authReadyState.isReady = true;
    mocks.profileMaybeSingle.mockRejectedValue(new Error("boom"));
    mocks.rolesMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useCurrentUser(), { wrapper: localWrap });

    await waitFor(
      () => expect(result.current.isError).toBe(true),
      { timeout: 8000 },
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.profile).toBeNull();
  }, 10000);

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
