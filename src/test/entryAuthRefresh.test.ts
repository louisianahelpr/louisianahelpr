/**
 * Q1170: a returning web visitor's expired token is refreshed from the ENTRY,
 * and auth-js takes that session instead of refreshing a second time.
 * Measured before (local build, prod data, poster, cwv-lab --expired, 375 Slow
 * 4G + 4x CPU, 2026-10-03): the refresh started only after the app downloaded
 * (/jobs 3899 ms) and LCP was +600-750 ms against a fresh token.
 *
 * The behaviour cases drive the REAL auth-js client (GoTrueClient, the version
 * supabase-js ships) against a token endpoint that records every refresh
 * token it is sent: one refresh in all, and never the same token twice.
 *
 * @mutate src/lib/entryAuthHandoff.ts | return pending.done.then(() => { | return Promise.resolve().then(() => {
 * @mutate src/boot/entryAuthRefresh.ts | if (stored.expires_at * 1000 - Date.now() >= ENTRY_REFRESH_MARGIN_MS) return; | void 0;
 * @mutate src/boot/entryAuthRefresh.ts | isNativeShell()) return; | false) return;
 * @mutate src/boot/entryAuthRefresh.ts | (JSON.parse(now) as Stored).refresh_token !== refreshToken | false
 * @mutate src/boot/entryAuthRefresh.ts | if (Number.isFinite(last) && Date.now() - last < ENTRY_REFRESH_MARK_MS) return; | void 0;
 * @mutate src/integrations/supabase/client.ts | withEntryAuthHandoff(getWebAuthStorage()) | getWebAuthStorage()
 * @mutate src/entry.ts | startEntryAuthRefresh(); | void 0;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GoTrueClient } from "@supabase/supabase-js";
import { ENTRY_AUTH_REFRESH_KEY, startEntryAuthRefresh } from "@/boot/entryAuthRefresh";
import { withEntryAuthHandoff } from "@/lib/entryAuthHandoff";
import { withDeviceClockExpiry } from "@/lib/sessionClockSkew";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

const BASE = "https://proj.supabase.co";
const KEY = "sb-proj-auth-token";
const user = { id: "11111111-1111-1111-1111-111111111111", aud: "authenticated", role: "authenticated", email: "x@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

function storeSession(expiresInS: number, refresh = "rt-0") {
  localStorage.setItem(KEY, JSON.stringify({ access_token: "at-0", refresh_token: refresh, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + expiresInS, user }));
}

/** A token endpoint that rotates refresh tokens and records each one it is sent. */
function tokenServer(opts: { failFirst?: boolean } = {}) {
  const sent: string[] = [];
  let n = 0;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    await new Promise((r) => setTimeout(r, 20));
    if (!url.includes("/token?grant_type=refresh_token")) return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    sent.push(JSON.parse(String(init?.body)).refresh_token);
    if (opts.failFirst && sent.length === 1) throw new TypeError("network down");
    n++;
    return new Response(JSON.stringify({ access_token: `at-${n}`, refresh_token: `rt-${n}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return { fn, sent };
}

/** The app's client as client.ts builds it on the web. */
function appAuth(fetchFn: typeof fetch) {
  return new GoTrueClient({
    url: `${BASE}/auth/v1`,
    storageKey: KEY,
    storage: withDeviceClockExpiry(withEntryAuthHandoff(localStorage)),
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    fetch: fetchFn,
  });
}

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)[ENTRY_AUTH_REFRESH_KEY];
  delete (window as unknown as Record<string, unknown>).Capacitor;
  localStorage.clear();
});

describe("the entry refreshes an expired web token, once (Q1170)", () => {
  it("auth-js takes the entry's session: one refresh in all, no refresh token sent twice", async () => {
    // Can fail: without the hand-off auth-js reads the expired session while
    // the entry's request is in flight and sends the same refresh token again.
    storeSession(-60);
    const server = tokenServer();
    vi.stubGlobal("fetch", server.fn);
    startEntryAuthRefresh();
    const { data } = await appAuth(server.fn as unknown as typeof fetch).getSession();
    expect(server.sent).toEqual(["rt-0"]);
    expect(data.session?.access_token).toBe("at-1");
    expect(JSON.parse(localStorage.getItem(KEY)!).refresh_token).toBe("rt-1");
  });

  it("if the entry's refresh fails, auth-js refreshes exactly as before", async () => {
    storeSession(-60);
    const server = tokenServer({ failFirst: true });
    vi.stubGlobal("fetch", server.fn);
    startEntryAuthRefresh();
    const { data } = await appAuth(server.fn as unknown as typeof fetch).getSession();
    expect(server.sent).toEqual(["rt-0", "rt-0"]); // the lost request, then auth-js's own (the old behaviour)
    expect(data.session?.access_token).toBe("at-1");
  });

  it("a token with time left is not refreshed by the entry", () => {
    storeSession(3000);
    const server = tokenServer();
    vi.stubGlobal("fetch", server.fn);
    startEntryAuthRefresh();
    expect(server.fn).not.toHaveBeenCalled();
    expect((window as unknown as Record<string, unknown>)[ENTRY_AUTH_REFRESH_KEY]).toBeUndefined();
  });

  it("a second tab opened within the window leaves the refresh to auth-js (never the same token twice from here)", () => {
    storeSession(-60);
    const server = tokenServer();
    vi.stubGlobal("fetch", server.fn);
    startEntryAuthRefresh();
    delete (window as unknown as Record<string, unknown>)[ENTRY_AUTH_REFRESH_KEY];
    startEntryAuthRefresh(); // the other tab: same storage, same expired session
    expect(server.fn).toHaveBeenCalledTimes(1);
    expect((window as unknown as Record<string, unknown>)[ENTRY_AUTH_REFRESH_KEY]).toBeUndefined();
  });

  it("the native app's mirrored session is never refreshed here (the Keychain owns it)", () => {
    storeSession(-60);
    (window as unknown as Record<string, unknown>).Capacitor = { getPlatform: () => "ios", isNativePlatform: () => true };
    const server = tokenServer();
    vi.stubGlobal("fetch", server.fn);
    startEntryAuthRefresh();
    expect(server.fn).not.toHaveBeenCalled();
  });

  it("a session written meanwhile (a sign-in or sign-out) is not overwritten", async () => {
    storeSession(-60);
    const server = tokenServer();
    vi.stubGlobal("fetch", server.fn);
    startEntryAuthRefresh();
    storeSession(3000, "rt-someone-else");
    await (window as unknown as Record<string, { done: Promise<void> }>)[ENTRY_AUTH_REFRESH_KEY].done;
    expect(JSON.parse(localStorage.getItem(KEY)!).refresh_token).toBe("rt-someone-else");
  });

  it("the app's web client reads through the hand-off; the entry starts it; the modules agree", () => {
    expect(code("src/integrations/supabase/client.ts")).toMatch(/isNativePlatform\(\)\s*\?\s*keychainStorageAdapter\s*:\s*withEntryAuthHandoff\(getWebAuthStorage\(\)\)/);
    expect(code("src/entry.ts")).toMatch(/startEntryAuthRefresh\(\);/);
    expect(code("src/lib/entryAuthHandoff.ts")).toContain(`const WINDOW_KEY = "${ENTRY_AUTH_REFRESH_KEY}";`);
    const importers = walkSource([resolve(ROOT, "src")])
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /from ["'](@\/boot|\.\/boot|\.\.?\/)[^"']*entryAuthRefresh["']/.test(code(f.replace(ROOT + "/", ""))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(importers).toEqual(["src/entry.ts"]);
    expect(code("src/boot/entryAuthRefresh.ts")).not.toMatch(/^\s*import\s/m);
  });
});
