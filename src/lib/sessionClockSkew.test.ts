/**
 * Q995: a device clock that runs ahead must not turn every fresh token into an
 * "expired" one. Measured on prod 2026-10-07 (Chromium, clock +2 h, 15 min on
 * /home): 107 token refreshes, ~7 a minute, against one an hour.
 *
 * The behaviour case drives the REAL auth-js client (GoTrueClient, the
 * version supabase-js ships) on a clock two hours ahead of the "server": with
 * the storage wrapped, one refresh and then the session holds; without it,
 * every getSession() refreshes again.
 *
 * @mutate src/lib/sessionClockSkew.ts | if (Math.abs(s.expires_at - local) <= SKEW_TOLERANCE_S) return value; | return value;
 * @mutate src/lib/sessionClockSkew.ts | if (p && typeof p.access_token === "string" && p.access_token === v?.access_token && typeof p.expires_at === "number") { | if (false) {
 * @mutate src/integrations/supabase/client.ts | storage: withDeviceClockExpiry(Capacitor.isNativePlatform() ? keychainStorageAdapter : withEntryAuthHandoff(getWebAuthStorage())), | storage: Capacitor.isNativePlatform() ? keychainStorageAdapter : withEntryAuthHandoff(getWebAuthStorage()),
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GoTrueClient } from "@supabase/supabase-js";
import { nextStoredSession, rebaseSessionExpiry, withDeviceClockExpiry, SKEW_TOLERANCE_S } from "./sessionClockSkew";

const SERVER_NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const SKEW_MS = 2 * 3600 * 1000;
const KEY = "sb-test-auth-token";

function session(serverNowMs: number) {
  return {
    access_token: `at-${serverNowMs}`,
    refresh_token: `rt-${serverNowMs}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.round(serverNowMs / 1000) + 3600,
    user: { id: "11111111-1111-1111-1111-111111111111", aud: "authenticated", role: "authenticated", email: "x@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

/** Runs `n` getSession() calls on a device clock SKEW_MS ahead; returns the refresh count. */
async function refreshesOnFastClock(wrap: boolean, n: number): Promise<number> {
  vi.useFakeTimers({ now: SERVER_NOW + SKEW_MS, toFake: ["Date"] });
  const mem = memStorage();
  mem.setItem(KEY, JSON.stringify(session(SERVER_NOW)));
  let refreshes = 0;
  let serverClock = SERVER_NOW;
  const fetchStub = vi.fn(async (url: string) => {
    if (String(url).includes("/token")) {
      refreshes++;
      serverClock += 1000;
      return new Response(JSON.stringify(session(serverClock)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const client = new GoTrueClient({
    url: "https://auth.example.test",
    storageKey: KEY,
    storage: wrap ? withDeviceClockExpiry(mem) : mem,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    fetch: fetchStub as unknown as typeof fetch,
  });
  for (let i = 0; i < n; i++) {
    const { data } = await client.getSession();
    expect(data.session, "the session must survive").not.toBeNull();
    vi.setSystemTime(Date.now() + 60_000);
  }
  return refreshes;
}

describe("session expiry follows the device clock (Q995)", () => {
  afterEach(() => vi.useRealTimers());

  it("re-bases a skewed expires_at on the device clock, from expires_in", () => {
    const now = SERVER_NOW + SKEW_MS;
    const out = JSON.parse(rebaseSessionExpiry(JSON.stringify(session(SERVER_NOW)), now));
    expect(out.expires_at).toBe(Math.round(now / 1000) + 3600);
    expect(out.access_token).toBe(`at-${SERVER_NOW}`);
  });

  it("leaves a correct clock, non-sessions and malformed values alone", () => {
    const v = JSON.stringify(session(SERVER_NOW));
    expect(rebaseSessionExpiry(v, SERVER_NOW + (SKEW_TOLERANCE_S - 5) * 1000)).toBe(v);
    expect(rebaseSessionExpiry("not json", SERVER_NOW)).toBe("not json");
    expect(rebaseSessionExpiry(JSON.stringify({ user: { id: "x" } }), SERVER_NOW)).toBe(JSON.stringify({ user: { id: "x" } }));
  });

  it("a re-save of the token already stored keeps its expiry (no extension on a correct clock)", () => {
    // auth-js updateUser re-saves the loaded session with its ORIGINAL
    // expires_in: a 50-minute-old token must not get another hour.
    const issued = session(SERVER_NOW);
    const later = SERVER_NOW + 50 * 60_000;
    const resaved = JSON.parse(nextStoredSession(JSON.stringify(issued), JSON.stringify({ ...issued, user: { ...issued.user, email: "y@example.com" } }), later));
    expect(resaved.expires_at).toBe(issued.expires_at);
    // A NEW token is re-based as usual.
    const fresh = session(SERVER_NOW);
    const next = JSON.parse(nextStoredSession(JSON.stringify(issued), JSON.stringify({ ...fresh, access_token: "at-new" }), SERVER_NOW + SKEW_MS));
    expect(next.expires_at).toBe(Math.round((SERVER_NOW + SKEW_MS) / 1000) + 3600);
  });

  it("the real auth-js client's updateUser re-save does not extend a token (correct clock)", async () => {
    vi.useFakeTimers({ now: SERVER_NOW + 50 * 60_000, toFake: ["Date"] });
    const mem = memStorage();
    const stored = session(SERVER_NOW);
    mem.setItem(KEY, JSON.stringify(stored));
    const fetchStub = vi.fn(async () => new Response(JSON.stringify(stored.user), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = new GoTrueClient({ url: "https://auth.example.test", storageKey: KEY, storage: withDeviceClockExpiry(mem), autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, fetch: fetchStub as unknown as typeof fetch });
    await client.updateUser({ data: { senior_mode: true } });
    expect(JSON.parse(mem.raw.get(KEY)!).expires_at).toBe(stored.expires_at);
  });

  it("the real auth-js client refreshes once on a fast clock, not on every read", async () => {
    // Can fail: without the wrapper every read after the first refresh still
    // sees an "expired" token and refreshes again (the measured storm).
    const without = await refreshesOnFastClock(false, 5);
    vi.useRealTimers();
    const withWrap = await refreshesOnFastClock(true, 5);
    expect(without).toBeGreaterThanOrEqual(5);
    expect(withWrap).toBe(1);
  });

  it("the app's Supabase client stores sessions through the wrapper", () => {
    const src = readFileSync(join(__dirname, "..", "integrations", "supabase", "client.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/storage:\s*withDeviceClockExpiry\(/);
  });
});
