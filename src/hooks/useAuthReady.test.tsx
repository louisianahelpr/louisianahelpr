// useAuthReady is the foundation under every auth gate in the app:
// ProtectedRoute, useCurrentUser, every admin surface. Bugs here cause
// the whole app to either flash a login screen on every cold-start
// (false unauth) or hang forever on the splash skeleton.
//
// Module has heavy global state — singleton bootstrap flag, listener
// set, snapshot ref — so each test uses vi.resetModules() + dynamic
// import to get a fresh instance.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Session, User } from "@supabase/supabase-js";

const onAuthStateChangeMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      getSession: () => getSessionMock(),
    },
  },
}));

const fakeUser: User = { id: "user-1", email: "test@example.com" } as unknown as User;
const fakeSession: Session = {
  user: fakeUser,
  access_token: "token",
  refresh_token: "rtoken",
  expires_in: 3600,
  expires_at: Date.now() / 1000 + 3600,
  token_type: "bearer",
} as unknown as Session;

let capturedAuthCallback: ((event: string, session: Session | null) => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  onAuthStateChangeMock.mockReset();
  getSessionMock.mockReset();
  capturedAuthCallback = null;

  // Capture the callback registered by useAuthReady so tests can fire events
  onAuthStateChangeMock.mockImplementation((cb: typeof capturedAuthCallback) => {
    capturedAuthCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

async function loadHook() {
  return await import("./useAuthReady");
}

describe("useAuthReady — cold start", () => {
  it("returns isReady=true with the session user when getSession resolves with a session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: fakeSession } });

    const { useAuthReady } = await loadHook();
    const { result } = renderHook(() => useAuthReady());

    // Initially not ready (synchronous render before effects fire)
    // Then ready after getSession resolves
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.user).toEqual(fakeUser);
  });

  it("returns isReady=true with user=null when getSession resolves with no session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    const { useAuthReady } = await loadHook();
    const { result } = renderHook(() => useAuthReady());

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.user).toBeNull();
  });

  it("falls back to ready=true via the safety timeout when getSession hangs", async () => {
    vi.useFakeTimers();
    // getSession never resolves
    getSessionMock.mockReturnValue(new Promise(() => {}));

    const { useAuthReady } = await loadHook();
    const { result } = renderHook(() => useAuthReady());

    expect(result.current.isReady).toBe(false);

    // Advance past the 2500ms internal race timeout AND the 2750ms
    // outer safety timeout. Wrapping in act() so listener-driven
    // setState calls are batched correctly.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2800);
    });

    expect(result.current.isReady).toBe(true);
    vi.useRealTimers();
  });
});

describe("useAuthReady — auth state changes", () => {
  it("transitions to ready+user when onAuthStateChange fires SIGNED_IN", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    const { useAuthReady } = await loadHook();
    const { result } = renderHook(() => useAuthReady());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(capturedAuthCallback).toBeTruthy();
    act(() => {
      capturedAuthCallback?.("SIGNED_IN", fakeSession);
    });

    await waitFor(() => expect(result.current.user).toEqual(fakeUser));
    expect(result.current.isReady).toBe(true);
  });

  it("transitions to user=null when onAuthStateChange fires SIGNED_OUT", async () => {
    getSessionMock.mockResolvedValue({ data: { session: fakeSession } });

    const { useAuthReady } = await loadHook();
    const { result } = renderHook(() => useAuthReady());
    await waitFor(() => expect(result.current.user).toEqual(fakeUser));

    act(() => {
      capturedAuthCallback?.("SIGNED_OUT", null);
    });

    await waitFor(() => expect(result.current.user).toBeNull());
    expect(result.current.isReady).toBe(true);
  });

  it("INITIAL_SESSION with no session does NOT prematurely flip ready", async () => {
    // getSession hangs so we control the readiness via the callback alone
    getSessionMock.mockReturnValue(new Promise(() => {}));

    const { useAuthReady } = await loadHook();
    const { result } = renderHook(() => useAuthReady());

    expect(result.current.isReady).toBe(false);

    // Per the implementation comment: INITIAL_SESSION with null session
    // is the "still loading" intermediate event. It must NOT flip ready
    // — only getSession or the safety timeout should.
    act(() => {
      capturedAuthCallback?.("INITIAL_SESSION", null);
    });

    // Allow microtasks to flush
    await Promise.resolve();
    expect(result.current.isReady).toBe(false);
  });

  it("INITIAL_SESSION WITH a session DOES flip ready", async () => {
    getSessionMock.mockReturnValue(new Promise(() => {}));

    const { useAuthReady } = await loadHook();
    const { result } = renderHook(() => useAuthReady());

    act(() => {
      capturedAuthCallback?.("INITIAL_SESSION", fakeSession);
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.user).toEqual(fakeUser);
  });
});

describe("useAuthReady — multi-subscriber + singleton", () => {
  it("multiple components subscribed see the same snapshot", async () => {
    getSessionMock.mockResolvedValue({ data: { session: fakeSession } });

    const { useAuthReady } = await loadHook();
    const { result: r1 } = renderHook(() => useAuthReady());
    const { result: r2 } = renderHook(() => useAuthReady());

    await waitFor(() => {
      expect(r1.current.isReady).toBe(true);
      expect(r2.current.isReady).toBe(true);
    });
    expect(r1.current.user).toEqual(fakeUser);
    expect(r2.current.user).toEqual(fakeUser);
  });

  it("onAuthStateChange is registered exactly once across many subscribers", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    const { useAuthReady } = await loadHook();
    renderHook(() => useAuthReady());
    renderHook(() => useAuthReady());
    renderHook(() => useAuthReady());

    // Bootstrap is a singleton — no matter how many components subscribe,
    // we register the auth callback exactly once.
    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
  });
});
