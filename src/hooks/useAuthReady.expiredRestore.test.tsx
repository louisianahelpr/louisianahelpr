// A RETURNING VISITOR'S FIRST SCREEN NEVER WAITS ON THE TOKEN REFRESH (Q1158 / Q1170, 2026-11-22).
//
// prod-audit 45000593002 (mobile lab, Slow 4G + 4x CPU, expired-token test in
// e2e/web-vitals/first-screens.spec.ts): /home LCP 4256 ms fresh, 19504 ms with
// an expired token; /messages 1936 -> 18824. The refresh failed on the network
// (the lab's write block refuses it, as a flaky link does), auth-js retried for
// ~25 s, and useAuthReady stayed un-ready until AUTH_RESTORE_GRACE_MS (15 s):
// ProtectedRoute held its skeleton, then bounced a member to Log In.
//
// The class: no first-screen render may await a token refresh. useAuthReady is
// the one gate every signed-in first screen waits on (ProtectedRoute blocks only
// on `isLoading && !user`, useCurrentUser's isLoading starts `!isReady`), so it
// is driven here with getSession() hanging exactly as it does while auth-js
// refreshes: the snapshot must be ready with the stored user at once, and each
// outcome of the refresh must land where it should.
//
// PROVEN RED (by hand, 2026-11-22): on the pre-fix useAuthReady.ts "ready at once"
// fails (isReady false until 15 s), and so does every @mutate below.
// BLIND TO: real auth-js timing (getSession is a mock); the lab budget measures that.
// @mutate src/hooks/useAuthReady.ts | if (restoredUser) { | if (false) {
// @mutate src/hooks/useAuthReady.ts | if (!timedOut && !storedSessionStillRefreshable()) markReady(null); | if (!timedOut && !storedSessionStillRefreshable()) void 0;
// @mutate src/hooks/useAuthReady.ts | if (stored.expires_at * 1000 - Date.now() >= REFRESH_MARGIN_MS) return null; | void REFRESH_MARGIN_MS;
// @mutate src/hooks/useAuthReady.ts | if (isNativeShell()) return null; | void isNativeShell;
// @mutate src/hooks/useAuthReady.ts | if (typeof stored?.refresh_token !== "string" \|\| !stored.refresh_token) return null; | void 0;

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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

const KEY = `sb-${new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split(".")[0]}-auth-token`;
const storedUser = { id: "member-1", email: "member@example.com" } as unknown as User;
const nowS = () => Math.floor(Date.now() / 1000);
const stored = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ access_token: "old", refresh_token: "r1", expires_at: nowS() - 60, user: storedUser, ...over });
const refreshed = (): Session =>
  ({ user: storedUser, access_token: "new", refresh_token: "r2", expires_in: 3600, expires_at: nowS() + 3600, token_type: "bearer" }) as unknown as Session;

let authCallback: ((event: string, session: Session | null) => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  onAuthStateChangeMock.mockReset();
  getSessionMock.mockReset();
  authCallback = null;
  onAuthStateChangeMock.mockImplementation((cb: typeof authCallback) => {
    authCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

/** Mount the hook and let the bootstrap's microtasks run, with NO timer advanced (t = 0). */
async function mountAtZero() {
  const { useAuthReady } = await import("./useAuthReady");
  const hook = renderHook(() => useAuthReady());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return hook;
}

describe("useAuthReady: an expired stored session (the refresh in flight)", () => {
  it("is ready at once with the stored user while the refresh hangs (never waits the 15 s grace)", async () => {
    localStorage.setItem(KEY, stored());
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { result } = await mountAtZero();
    expect(result.current.isReady).toBe(true);
    expect(result.current.user?.id).toBe("member-1");
    // Still the member after the old grace horizons pass with the refresh still hanging.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(result.current).toEqual({ isReady: true, user: expect.objectContaining({ id: "member-1" }) });
  });

  it("an expiring token (inside auth-js's 90 s margin) is restored too: getSession refreshes it first", async () => {
    localStorage.setItem(KEY, stored({ expires_at: nowS() + 30 }));
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { result } = await mountAtZero();
    expect(result.current.isReady).toBe(true);
    expect(result.current.user?.id).toBe("member-1");
  });

  it("refreshed: getSession hands over the same member", async () => {
    localStorage.setItem(KEY, stored());
    let answer: (v: unknown) => void = () => {};
    getSessionMock.mockReturnValue(new Promise((r) => { answer = r; }));
    const { result } = await mountAtZero();
    expect(result.current.user?.id).toBe("member-1");
    await act(async () => {
      answer({ data: { session: refreshed() } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ isReady: true, user: expect.objectContaining({ id: "member-1" }) });
  });

  it("refused (revoked or already used): auth-js's SIGNED_OUT turns the snapshot signed out", async () => {
    localStorage.setItem(KEY, stored());
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { result } = await mountAtZero();
    expect(result.current.user?.id).toBe("member-1");
    expect(authCallback).not.toBeNull();
    act(() => {
      localStorage.removeItem(KEY);
      authCallback?.("SIGNED_OUT", null);
    });
    expect(result.current).toEqual({ isReady: true, user: null });
  });

  it("failed on the network: getSession answers null, the session is still stored, the member stays signed in", async () => {
    localStorage.setItem(KEY, stored());
    getSessionMock.mockResolvedValue({ data: { session: null }, error: new Error("Failed to fetch") });
    const { result } = await mountAtZero();
    act(() => authCallback?.("INITIAL_SESSION", null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(result.current).toEqual({ isReady: true, user: expect.objectContaining({ id: "member-1" }) });
  });

  it("the stored session vanished with no SIGNED_OUT: getSession's null is believed (signed out)", async () => {
    localStorage.setItem(KEY, stored());
    let answer: (v: unknown) => void = () => {};
    getSessionMock.mockReturnValue(new Promise((r) => { answer = r; }));
    const { result } = await mountAtZero();
    expect(result.current.user?.id).toBe("member-1");
    await act(async () => {
      localStorage.removeItem(KEY);
      answer({ data: { session: null } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ isReady: true, user: null });
  });
});

describe("useAuthReady: sessions the restore leaves to getSession (unchanged path)", () => {
  it("a token with life left waits for getSession as before", async () => {
    localStorage.setItem(KEY, stored({ expires_at: nowS() + 3600 }));
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { result } = await mountAtZero();
    expect(result.current.isReady).toBe(false);
  });

  it("the native app (Keychain is its store) waits for getSession as before", async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
    localStorage.setItem(KEY, stored());
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { result } = await mountAtZero();
    expect(result.current.isReady).toBe(false);
  });

  it.each([
    ["no refresh token", { refresh_token: "" }],
    ["no user id", { user: { email: "x@example.com" } }],
    ["no expiry", { expires_at: undefined }],
  ])("a stored session with %s is never restored", async (_name, over) => {
    localStorage.setItem(KEY, stored(over));
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { result } = await mountAtZero();
    expect(result.current.isReady).toBe(false);
  });

  it("a guest (nothing stored) waits for getSession as before", async () => {
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { result } = await mountAtZero();
    expect(result.current.isReady).toBe(false);
  });
});
