/**
 * A capped sign-out is CANCELLED, so it cannot wipe the next sign-in.
 *
 * Review of the 2026-10-09 fix ("I pressed Log Out and nothing happened"):
 * racing auth.signOut() against a timer abandoned the /logout request. When it
 * failed later, auth-js's _signOut ran _removeSession() over whatever session
 * was stored then — a fresh sign-in included — and until then no SIGNED_OUT
 * had fired, so the app still held the old user.
 *
 * Driven on the REAL supabase-js client (memory storage, stubbed network),
 * built with the same `global.fetch` client.ts passes: /logout hangs, the cap
 * fires, a new user signs in, the old request then fails. The new session must
 * survive, and exactly one SIGNED_OUT must fire, before the new SIGNED_IN.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { blankComments } from "@/test/helpers/blankNonCode";

const BASE = "https://proj.supabase.co";
const STORAGE_KEY = "sb-proj-auth-token";
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const userOf = (id: string) => ({ id, aud: "authenticated", role: "authenticated", email: `${id}@example.com`, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
const sessionOf = (id: string) => ({ access_token: `at-${id}`, refresh_token: `rt-${id}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: userOf(id) });

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

describe("a capped sign-out cannot wipe the next sign-in", () => {
  it("cancels the hung /logout: SIGNED_OUT once, then the new user's session survives the old request failing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let failLateLogout: () => void = () => {};
    const logoutCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/auth/v1/logout")) {
        logoutCalls.push(url);
        // Like a real fetch on a hung line: it settles only if aborted, or
        // when the line finally drops (failLateLogout).
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          failLateLogout = () => reject(new TypeError("Failed to fetch"));
        });
      }
      if (url.includes("/auth/v1/token?grant_type=password")) return Promise.resolve(json(sessionOf("NEW")));
      return Promise.resolve(json({}));
    }));

    mem.set(STORAGE_KEY, JSON.stringify(sessionOf("OLD")));
    const { signOutAwareFetch } = await import("@/lib/signOutAbort");
    const client = createClient(BASE, "pk", {
      auth: { storage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: signOutAwareFetch },
    });
    holder.client = client;
    const events: string[] = [];
    client.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION") events.push(`${event}:${session?.user.id ?? "none"}`);
    });
    await client.auth.getSession();
    await new Promise((r) => setTimeout(r, 0));
    events.length = 0; // the OLD session's own load events are not under test

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { signOutWithPushCleanup, SIGN_OUT_CAP_MS, ABORT_SETTLE_CAP_MS } = await import("./authSignOut");
    const out = signOutWithPushCleanup();
    await vi.advanceTimersByTimeAsync(SIGN_OUT_CAP_MS + ABORT_SETTLE_CAP_MS);
    const result = await out;
    vi.useRealTimers();
    expect(logoutCalls).toHaveLength(1);
    expect(result.error).toBeTruthy();
    // Signed out while the dialog is still up, not later.
    expect(events).toEqual(["SIGNED_OUT:none"]);

    // The next person signs in; only then does the old /logout's line drop.
    const signIn = client.auth.signInWithPassword({ email: "NEW@example.com", password: "pw" });
    failLateLogout();
    const { error } = await signIn;
    expect(error).toBeNull();
    await new Promise((r) => setTimeout(r, 20));

    expect(JSON.parse(mem.get(STORAGE_KEY) ?? "null")?.user?.id).toBe("NEW");
    expect(events.filter((e) => e.startsWith("SIGNED_OUT"))).toHaveLength(1);
    expect(events.indexOf("SIGNED_OUT:none")).toBeLessThan(events.indexOf("SIGNED_IN:NEW"));
    spy.mockRestore();
  });

  it("the wrapper is inert outside a sign-out, and client.ts builds the client with it", async () => {
    const seen: (AbortSignal | undefined | null)[] = [];
    vi.stubGlobal("fetch", vi.fn((_: RequestInfo | URL, init?: RequestInit) => { seen.push(init?.signal); return Promise.resolve(json({})); }));
    const { signOutAwareFetch, beginSignOutAbortScope, endSignOutAbortScope } = await import("@/lib/signOutAbort");
    const init = { method: "GET" };
    await signOutAwareFetch(`${BASE}/auth/v1/user`, init);
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(`${BASE}/auth/v1/user`, init);
    const scope = beginSignOutAbortScope();
    await signOutAwareFetch(`${BASE}/rest/v1/jobs`, init);
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(`${BASE}/rest/v1/jobs`, init);
    await signOutAwareFetch(`${BASE}/auth/v1/logout`, init);
    expect(seen[seen.length - 1]).toBe(scope.signal);
    endSignOutAbortScope(scope);
    await signOutAwareFetch(`${BASE}/auth/v1/logout`, init);
    expect(seen[seen.length - 1]).toBeUndefined();
    const src = blankComments(readFileSync(resolve(process.cwd(), "src/integrations/supabase/client.ts"), "utf8"));
    expect(src).toMatch(/global:\s*\{\s*fetch:\s*signOutAwareFetch\s*\}/);
  });
});

// @mutate src/lib/authSignOut.ts |     scope.abort(); |
// @mutate src/integrations/supabase/client.ts |   global: { fetch: signOutAwareFetch }, |
// @mutate src/lib/signOutAbort.ts |   if (!scope \|\| !urlOf(input).includes("/auth/v1/")) return fetch(input, init); |   return fetch(input, init);
