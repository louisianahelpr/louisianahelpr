import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The cache wipe on sign-out, tested by BEHAVIOUR.
 *
 * This exists because the wipe was unreachable in production and every test in
 * the repo passed anyway. `queryClient.clear()` and `removePersistedClient()`
 * are the only two calls in the whole codebase that stop the next person on a
 * shared device rehydrating the previous user's data, and they lived inside
 * `main.tsx`'s analytics bootstrap: behind five dynamic imports, behind a
 * first-interaction gate, inside a `try` with an empty `catch`. `vite.config.ts`
 * names those chunks `sentry-*.js` and `posthog-*.js`, so a content blocker was
 * enough to remove the listener entirely — and sign-out still looked normal.
 *
 * So these assertions are on OBSERVED CALLS, never on where the code sits.
 */

const signOut = vi.fn(async (_options?: unknown) => ({ error: null }));
const getSession = vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } }));
const clear = vi.fn();
const removePersistedClient = vi.fn(async () => {});
const unregisterPushOnSignOut = vi.fn(async () => {});
const clearRememberedRoute = vi.fn();
const order: string[] = [];
const clearNativeSessionMirror = vi.fn(async () => {});
vi.mock("@/integrations/supabase/keychainStorageAdapter", () => ({ clearNativeSessionMirror }));

// A client on which EVERY call hangs: any property is the same proxy, any call
// returns it, and awaiting it never settles (`then` never calls back). That
// covers getSession(), signOut(), and a .from().delete().eq() chain alike.
const hanging: { on: boolean } = { on: false };
const neverSettles: unknown = new Proxy(function () {}, {
  get: (_t, prop) => (prop === "then" ? () => { /* never settles */ } : neverSettles),
  apply: () => neverSettles,
});
vi.mock("@/integrations/supabase/client", () => {
  const working = {
    auth: {
      getSession: () => getSession(),
      signOut: (o?: unknown) => {
        order.push("signOut");
        return signOut(o as never);
      },
    },
  };
  return {
    supabase: new Proxy(working, {
      get: (target, prop) => (hanging.on ? (neverSettles as Record<PropertyKey, unknown>)[prop] : target[prop as keyof typeof target]),
    }),
  };
});
vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    clear: () => {
      order.push("clear");
      clear();
    },
  },
}));
vi.mock("@/lib/queryPersister", () => ({
  removePersistedClient: () => {
    order.push("removePersisted");
    return removePersistedClient();
  },
}));
vi.mock("@/lib/nativePush", () => ({ unregisterPushOnSignOut }));
vi.mock("@/lib/lastRoute", () => ({ clearRememberedRoute }));
const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report }));

beforeEach(() => {
  order.length = 0;
  clearNativeSessionMirror.mockClear();
  vi.clearAllMocks();
});

describe("signOutWithPushCleanup", () => {
  it("wipes both caches", async () => {
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(removePersistedClient).toHaveBeenCalledTimes(1);
  });

  it("a plain Log Out ends THIS device's session only; Sign Out Everywhere stays global", async () => {
    // supabase-js defaults to scope "global": a phone Log Out used to sign the
    // web out too (verified live, 2026-09-12).
    const { signOutWithPushCleanup } = await import("./authSignOut");
    signOut.mockClear();
    await signOutWithPushCleanup();
    expect(signOut).toHaveBeenLastCalledWith({ scope: "local" });
    await signOutWithPushCleanup({ scope: "global" });
    expect(signOut).toHaveBeenLastCalledWith({ scope: "global" });
  });

  it("wipes AFTER signOut, so an in-flight query cannot repopulate with a live session", async () => {
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(order.indexOf("signOut")).toBeLessThan(order.indexOf("clear"));
    expect(order.indexOf("signOut")).toBeLessThan(order.indexOf("removePersisted"));
  });

  it("still signs out, and still wipes, when push cleanup throws", async () => {
    unregisterPushOnSignOut.mockRejectedValueOnce(new Error("offline"));
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("LOGS rather than swallows when the persisted delete fails — a silent failure here IS the leak", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    removePersistedClient.mockRejectedValueOnce(new Error("idb blocked"));
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await expect(signOutWithPushCleanup()).resolves.toBeDefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ── "i had to click log out twice to actually log out" (owner, 2026-09-11) ──
  // Both branches below left `sb-<ref>-auth-token` in localStorage, which is
  // what MarketingRedirect reads — so the post-sign-out `navigate("/")` fed
  // the user straight back into the app, and only the second click stuck.
  const TOKEN_KEY = "sb-fncmgoasalhdgfwzhsqa-auth-token";

  it("clears the persisted session when auth.signOut() RETURNS an error (auth-js can return early without removing it)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: "x" }));
    signOut.mockResolvedValueOnce({ error: { name: "AuthApiError", message: "network" } as never });
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(spy).toHaveBeenCalled();
    // The app's Keychain mirror too, or the next launch restores the session.
    expect(clearNativeSessionMirror).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("clears the persisted session when auth.signOut() THROWS (NavigatorLockAcquireTimeoutError), and does not rethrow", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: "x" }));
    signOut.mockRejectedValueOnce(new Error("NavigatorLockAcquireTimeoutError"));
    const { signOutWithPushCleanup } = await import("./authSignOut");
    // The throw is what stopped every caller's `navigate()` from ever running.
    await expect(signOutWithPushCleanup()).resolves.toBeDefined();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    spy.mockRestore();
  });

  it("a Keychain delete that never settles cannot stop sign-out finishing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      clearNativeSessionMirror.mockImplementationOnce(() => new Promise<void>(() => { /* bridge never answers */ }));
      signOut.mockResolvedValueOnce({ error: { name: "AuthApiError", message: "network" } as never });
      const { signOutWithPushCleanup } = await import("./authSignOut");
      let done = false;
      const p = signOutWithPushCleanup().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(1_500);
      await p;
      expect(done).toBe(true);
      expect(clear).toHaveBeenCalled();
      // ...and the miss is said out loud: the next launch may restore the session.
      expect(spy.mock.calls.some((c) => /Keychain clear did not finish/.test(String(c[0])))).toBe(true);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  // ── "I pressed Log Out and nothing happened" (owner, 2026-10-09) ──
  // Sign-out awaited getUser(), the push_tokens delete and POST /logout with no
  // limit. Here EVERY supabase call and the push unregister never settle, and
  // sign-out must still finish, inside its caps, and still clear this device.
  it("finishes when every supabase call and the push unregister hang", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    hanging.on = true;
    try {
      unregisterPushOnSignOut.mockImplementation(() => new Promise<void>(() => { /* never settles */ }));
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: "x" }));
      const { signOutWithPushCleanup, PUSH_CLEANUP_CAP_MS, SIGN_OUT_CAP_MS, ABORT_SETTLE_CAP_MS } = await import("./authSignOut");
      let done = false;
      const p = signOutWithPushCleanup().then((r) => { done = true; return r; });
      // push 2 s + signOut 3 s + the cancelled signOut's 0.5 s to settle.
      await vi.advanceTimersByTimeAsync(PUSH_CLEANUP_CAP_MS + SIGN_OUT_CAP_MS + ABORT_SETTLE_CAP_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const result = await p;
      expect(done).toBe(true);
      // A capped /logout counts as a failed sign-out, so the floor ran.
      expect(result.error).toBeTruthy();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(clear).toHaveBeenCalledTimes(1);
      expect(removePersistedClient).toHaveBeenCalledTimes(1);
      // Each cap that fired is REPORTED, not only logged.
      await vi.dynamicImportSettled();
      const tags = report.mock.calls.map((c) => (c[1] as { tags: Record<string, string> }).tags);
      expect(tags).toEqual(expect.arrayContaining([{ area: "push", op: "signOutCap" }, { area: "auth", op: "signOutCap" }]));
      expect(report.mock.calls.every((c) => (c[1] as { severity: string }).severity === "warning")).toBe(true);
    } finally {
      hanging.on = false;
      unregisterPushOnSignOut.mockReset();
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("caps a push unregister that never settles even when the session read answers", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      unregisterPushOnSignOut.mockImplementationOnce(() => new Promise<void>(() => { /* never settles */ }));
      const { signOutWithPushCleanup, PUSH_CLEANUP_CAP_MS } = await import("./authSignOut");
      let done = false;
      const p = signOutWithPushCleanup().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(PUSH_CLEANUP_CAP_MS);
      await p;
      expect(done).toBe(true);
      expect(unregisterPushOnSignOut).toHaveBeenCalledWith("u1");
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(spy.mock.calls.some((c) => /push-token cleanup did not finish/.test(String(c[0])))).toBe(true);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("Sign Out Everywhere past its cap is an ERROR, never success (the other devices were not confirmed)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      signOut.mockImplementationOnce(() => new Promise(() => { /* /logout never answers */ }));
      const { signOutWithPushCleanup, SIGN_OUT_CAP_MS, ABORT_SETTLE_CAP_MS } = await import("./authSignOut");
      const p = signOutWithPushCleanup({ scope: "global" });
      await vi.advanceTimersByTimeAsync(SIGN_OUT_CAP_MS + ABORT_SETTLE_CAP_MS);
      const result = await p;
      expect(signOut).toHaveBeenCalledWith({ scope: "global" });
      expect(result.error).toBeTruthy();
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("Sign Out Everywhere with no session on this device is an error and sends nothing (auth-js would answer success)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockResolvedValueOnce({ data: { session: null } } as never);
    const { signOutWithPushCleanup } = await import("./authSignOut");
    const result = await signOutWithPushCleanup({ scope: "global" });
    expect(result.error).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
    // ...while a plain Log Out with no session is still the ordinary path.
    getSession.mockResolvedValueOnce({ data: { session: null } } as never);
    await signOutWithPushCleanup();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    spy.mockRestore();
  });

  it("an on-disk cache wipe that never settles cannot hold sign-out; the in-memory wipe still ran", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      removePersistedClient.mockImplementationOnce(() => new Promise<void>(() => { /* IndexedDB blocked */ }));
      const { signOutWithPushCleanup, CACHE_WIPE_CAP_MS } = await import("./authSignOut");
      let done = false;
      const p = signOutWithPushCleanup().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(CACHE_WIPE_CAP_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toBe(true);
      expect(clear).toHaveBeenCalledTimes(1);
      await vi.dynamicImportSettled();
      expect(report.mock.calls.some((c) => (c[1] as { tags: Record<string, string> }).tags.area === "cache")).toBe(true);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("reads the user id from the local session, never a getUser() round trip", async () => {
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(unregisterPushOnSignOut).toHaveBeenCalledWith("u1");
  });

  it("leaves THIS device's session alone for scope:'others' — that sign-out is about other devices", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: "x" }));
    signOut.mockResolvedValueOnce({ error: { name: "AuthApiError", message: "network" } as never });
    const { signOutOtherDevices } = await import("./authSignOut");
    await signOutOtherDevices();
    expect(localStorage.getItem(TOKEN_KEY)).not.toBeNull();
    localStorage.removeItem(TOKEN_KEY);
    spy.mockRestore();
  });

  it("does not import sentry or posthog — the wipe must not ride on analytics", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/lib/authSignOut.ts"), "utf8");
    // The coupling IS the bug this file exists for, so it is asserted directly.
    expect(src).not.toMatch(/from\s+["'][^"']*(sentry|posthog)/i);
  });
});

// The floor under a failed sign-out. Without this call the `sb-*-auth-token`
// key survives both of auth.signOut()'s silent failure modes, MarketingRedirect
// fast-paths off it, and the post-sign-out navigate("/") feeds the user
// straight back in still signed in — "i had to click log out twice".
// @mutate src/lib/authSignOut.ts | clearPersistedAuthToken(); | void 0;
// @mutate src/lib/authSignOut.ts |       clearNativeSessionMirror().then(() => "done" as const, () => "done" as const), |       Promise.resolve("done" as const),
// @mutate src/lib/authSignOut.ts |     if (outcome === "capped") { |     if (false) {

// The caps (owner, 2026-10-09: "I pressed Log Out and nothing happened").
// Uncapped, a /logout or a push cleanup that never answers leaves sign-out
// pending for good and the hang tests above never finish.
// @mutate src/lib/authSignOut.ts | const outcome = await capped(work, SIGN_OUT_CAP_MS); | const outcome = await work;
// @mutate src/lib/authSignOut.ts | if (settled === CAPPED \|\| !settled?.error) return { error: cappedError as never }; | if (settled === CAPPED) return { error: null } as never;
// @mutate src/lib/authSignOut.ts | if (options.scope === "global" && hadSession === false) { | if (false) {
// @mutate src/lib/authSignOut.ts | if ((await capped(diskWipe, CACHE_WIPE_CAP_MS)) === CAPPED) { | if ((await diskWipe) === undefined && false) {
// @mutate src/lib/authSignOut.ts |     .then(({ report }) => report(new Error(message), { severity: "warning", tags: { area, op: "signOutCap" } })) |     .then(() => undefined)
// @mutate src/lib/authSignOut.ts | if ((await capped(pushCleanup, PUSH_CLEANUP_CAP_MS)) === CAPPED) { | if ((await pushCleanup) === undefined && false) {
// @mutate src/lib/authSignOut.ts | const { data } = await supabase.auth.getSession(); | const { data: { user } } = await supabase.auth.getUser(); const data = { session: { user } };

// "others" keeps THIS device signed in, so nothing of this device is torn down.
// @mutate src/lib/authSignOut.ts | const { error } = await supabase.auth.signOut({ scope: "others" }); | const { error } = await signOutWithPushCleanup();
describe("signOutWithPushCleanup and Cache Storage (Q1174)", () => {
  const cachesDelete = vi.fn(async (_name: string) => true);
  beforeEach(() => {
    vi.stubGlobal("caches", { delete: cachesDelete });
    cachesDelete.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes the legacy api-cache, so a shared device cannot show the previous account's rows offline", async () => {
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(cachesDelete).toHaveBeenCalledWith("api-cache");
  });

  it("still deletes it when the query-cache wipe throws, and when Cache Storage itself throws sign-out still finishes", async () => {
    const { signOutWithPushCleanup } = await import("./authSignOut");
    clear.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(signOutWithPushCleanup()).resolves.toBeDefined();
    expect(cachesDelete).toHaveBeenCalledWith("api-cache");
    cachesDelete.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(signOutWithPushCleanup()).resolves.toBeDefined();
    expect(removePersistedClient).toHaveBeenCalled();
  });
});

describe("signOutOtherDevices", () => {
  it("revokes other sessions and leaves this device's push token, route and cache alone", async () => {
    const { signOutOtherDevices } = await import("./authSignOut");
    expect(await signOutOtherDevices()).toBe(true);
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(unregisterPushOnSignOut).not.toHaveBeenCalled();
    expect(clearRememberedRoute).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(removePersistedClient).not.toHaveBeenCalled();
  });
  it("reports failure on an error or a throw", async () => {
    const { signOutOtherDevices } = await import("./authSignOut");
    signOut.mockResolvedValueOnce({ error: { message: "x" } } as never);
    expect(await signOutOtherDevices()).toBe(false);
    signOut.mockRejectedValueOnce(new Error("lock"));
    expect(await signOutOtherDevices()).toBe(false);
  });
});
