/**
 * Refresh a returning visitor's expired access token from the ENTRY, beside
 * the app's own download (Q1170).
 *
 * Measured 2026-10-03 (local build, prod data, poster, scripts/perf/cwv-lab.mjs
 * --expired, 375 Slow 4G + 4x CPU): supabase-js refreshes an expired token
 * only once the app has downloaded, and every first-screen read waits for it:
 * /home refresh 4485-5310 ms, LCP +600 ms; /jobs +750 ms. A visitor back after
 * an hour away always has an expired token, so this is the common return.
 *
 * So the entry starts the same request auth-js would send (POST
 * /auth/v1/token?grant_type=refresh_token with the stored refresh token),
 * writes the new session where auth-js keeps it, and leaves a promise on
 * `window`. The app's web auth storage (src/lib/entryAuthHandoff.ts) makes
 * auth-js's FIRST read of the session wait for that promise, so auth-js finds
 * a fresh session and never sends the used refresh token a second time
 * (refresh tokens rotate: a second use is the server's reuse case).
 *
 * WEB ONLY. The native app keeps its session in the Keychain and mirrors it
 * into localStorage; refreshing that copy here would rotate the token out from
 * under the Keychain. Any Capacitor platform other than "web" returns at once.
 *
 * NOTHING outside the entry may import this file (routePreload's rule: no
 * imports, or the entry drags a shared chunk); the window key is copied in
 * src/lib/entryAuthHandoff.ts and src/test/entryAuthRefresh.test.ts holds the
 * two equal.
 */

export const ENTRY_AUTH_REFRESH_KEY = "__lhEntryAuthRefresh";
/** auth-js refreshes a session this close to expiry (EXPIRY_MARGIN_MS, 3 x 30 s). */
const ENTRY_REFRESH_MARGIN_MS = 90_000;
/** One entry refresh per this window across tabs (see the marker below). */
const ENTRY_REFRESH_MARK_KEY = "lh_entry_refresh_at";
const ENTRY_REFRESH_MARK_MS = 15_000;

type Stored = { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown };
type Fresh = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; user?: unknown };

function isNativeShell(): boolean {
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap) return location.protocol === "capacitor:";
  try {
    return cap.isNativePlatform?.() === true || (typeof cap.getPlatform === "function" && cap.getPlatform() !== "web");
  } catch {
    /* a half-initialised bridge: treat it as native, never refresh its copy */
    return true;
  }
}

/** Called by the entry. No-op unless a web visitor's stored token is (nearly) expired. */
export function startEntryAuthRefresh(): void {
  if (typeof fetch !== "function" || isNativeShell()) return;
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base || !apikey) return;
  const key = `sb-${new URL(base).hostname.split(".")[0]}-auth-token`;
  let stored: Stored;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    stored = JSON.parse(raw) as Stored;
  } catch {
    /* storage blocked or corrupt: auth-js deals with it as it always did */
    return;
  }
  const refreshToken = stored.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken || typeof stored.expires_at !== "number") return;
  if (stored.expires_at * 1000 - Date.now() >= ENTRY_REFRESH_MARGIN_MS) return;
  // Several tabs restored at once would each send the SAME refresh token from
  // here; one late enough is the server's reuse case, which revokes the login
  // (lh-authz-rls review). The first tab marks the attempt; the others leave
  // the refresh to auth-js, which reads the first tab's new session.
  try {
    const last = Number(localStorage.getItem(ENTRY_REFRESH_MARK_KEY));
    if (Number.isFinite(last) && Date.now() - last < ENTRY_REFRESH_MARK_MS) return;
    localStorage.setItem(ENTRY_REFRESH_MARK_KEY, String(Date.now()));
  } catch {
    /* storage blocked: we could not read the session either */
    return;
  }

  // No client-side timeout: aborting a request the server may already have
  // answered would leave auth-js holding a used refresh token. auth-js's own
  // refresh has no timeout either; the wait is the same wait, started earlier.
  const done = fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey, Authorization: `Bearer ${apikey}`, "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then(async (r) => {
      if (!r.ok) return; // revoked or used: auth-js finds the old session and signs out as before
      const s = (await r.json()) as Fresh;
      if (typeof s.access_token !== "string" || typeof s.refresh_token !== "string" || typeof s.expires_in !== "number" || !s.user) return;
      // Only replace the session this refresh was for: if anything else wrote
      // one meanwhile (another tab signed in or out), leave it alone.
      const now = localStorage.getItem(key);
      if (!now || (JSON.parse(now) as Stored).refresh_token !== refreshToken) return;
      // expires_at on the DEVICE clock, as the Q995 storage wrapper stores it.
      localStorage.setItem(key, JSON.stringify({ ...s, expires_at: Math.round(Date.now() / 1000) + s.expires_in }));
    })
    // A failed refresh is not an error here: auth-js tries again itself.
    .catch(() => undefined);
  (window as unknown as Record<string, unknown>)[ENTRY_AUTH_REFRESH_KEY] = { key, done };
}
