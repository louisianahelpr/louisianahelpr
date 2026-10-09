/**
 * Expired access token + hung network: sign-out still tells the app.
 *
 * Re-review of the 2026-10-09 fix ("I pressed Log Out and nothing happened"):
 * a token refresh started BEFORE sign-out's abort scope (here: the
 * auto-refresh path, a getSession() on an expired token) carries no signal.
 * auth.signOut() waits on that refresh before it would send /logout, so the
 * cap's abort aborts nothing, the floor clears storage by hand, and no
 * SIGNED_OUT ever fires. useAuthReady's snapshot kept the old user: the app
 * "signed in" with no session (on the app, NativeRedirect sent "/" to /home).
 *
 * Real supabase-js client (localStorage, stubbed network, client.ts's
 * global.fetch) and the real useAuthReady hook.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BASE = "https://proj.supabase.co";
const STORAGE_KEY = "sb-proj-auth-token";
// localStorage, as on the web: the floor (clearPersistedAuthToken) clears it by key.
const storage = window.localStorage;
const mem = {
  get: (k: string) => localStorage.getItem(k),
  set: (k: string, v: string) => localStorage.setItem(k, v),
  has: (k: string) => localStorage.getItem(k) !== null,
  clear: () => localStorage.clear(),
};
const userOf = (id: string) => ({ id, aud: "authenticated", role: "authenticated", email: `${id}@example.com`, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
const sessionOf = (id: string, expiresInS = 3600) => ({ access_token: `at-${id}`, refresh_token: `rt-${id}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: userOf(id) });

const holder: { client: SupabaseClient | null } = { client: null };
vi.mock("@/integrations/supabase/client", () => ({
  get supabase() { return holder.client; },
}));
vi.mock("@/integrations/supabase/keychainStorageAdapter", () => ({ clearNativeSessionMirror: vi.fn(async () => {}) }));
vi.mock("@/lib/nativePush", () => ({ unregisterPushOnSignOut: vi.fn(async () => {}) }));
vi.mock("@/lib/lastRoute", () => ({ clearRememberedRoute: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ queryClient: { clear: vi.fn() } }));
vi.mock("@/lib/queryPersister", () => ({ removePersistedClient: vi.fn(async () => {}) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mem.clear();
  holder.client = null;
});

describe("sign-out behind a hung token refresh", () => {
  it("the app's auth snapshot becomes signed out, and a new sign-in afterwards survives", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let answerRefresh: () => void = () => {};
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      sent.push(url.replace(BASE, ""));
      if (url.includes("grant_type=refresh_token")) {
        // Hung, and started with no abort scope open, so it carries no signal.
        expect(init?.signal ?? null).toBeNull();
        return new Promise<Response>((resolve) => { answerRefresh = () => resolve(json(sessionOf("OLD"))); });
      }
      if (url.includes("grant_type=password")) return Promise.resolve(json(sessionOf("NEW")));
      return Promise.resolve(json({}));
    }));

    mem.set(STORAGE_KEY, JSON.stringify(sessionOf("OLD")));
    const { signOutAwareFetch } = await import("@/lib/signOutAbort");
    const client = createClient(BASE, "pk", {
      auth: { storage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: signOutAwareFetch },
    });
    holder.client = client;

    const { useAuthReady } = await import("@/hooks/useAuthReady");
    const { result } = renderHook(() => useAuthReady());
    await waitFor(() => expect(result.current.user?.id).toBe("OLD"));

    // Time passes: the access token expires and a refresh starts and hangs.
    mem.set(STORAGE_KEY, JSON.stringify(sessionOf("OLD", -100)));
    void client.auth.getSession();
    await waitFor(() => expect(sent.some((u) => u.includes("refresh_token"))).toBe(true));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { signOutWithPushCleanup } = await import("./authSignOut");
    let out!: Promise<unknown>;
    await act(async () => {
      out = signOutWithPushCleanup();
      await vi.advanceTimersByTimeAsync(10_000);
      await out;
    });
    vi.useRealTimers();

    // /logout was never sent (it waits on the refresh) and storage is cleared...
    expect(sent.some((u) => u.includes("/logout"))).toBe(false);
    expect(mem.has(STORAGE_KEY)).toBe(false);
    // ...and the app is told: signed out, not "still OLD with no session".
    expect(result.current).toEqual({ user: null, isReady: true });

    // The stale refresh answers late; then the next person signs in.
    await act(async () => { answerRefresh(); await new Promise((r) => setTimeout(r, 20)); });
    const { error } = await client.auth.signInWithPassword({ email: "NEW@example.com", password: "pw" });
    expect(error).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(JSON.parse(mem.get(STORAGE_KEY) ?? "null")?.user?.id).toBe("NEW");
    expect(result.current.user?.id).toBe("NEW");
    spy.mockRestore();
    warn.mockRestore();
  });
});

// @mutate src/lib/authSignOut.ts |     forceSignedOutSnapshot();\n |
// @mutate src/hooks/useAuthReady.ts |   emitAuthSnapshot({ user: null, isReady: true });\n}; |   return;\n};
