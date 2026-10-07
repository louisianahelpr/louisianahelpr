/**
 * A session's expiry, re-based on THIS device's clock (Q995).
 *
 * GoTrue answers every sign-in and refresh with `expires_in` (seconds) and
 * `expires_at` (a unix time on the SERVER's clock), and auth-js keeps the
 * server's `expires_at` ("a server-provided expires_at takes precedence"). It
 * then decides "expired?" by comparing that against `Date.now()`. On a device
 * whose clock runs ahead, a fresh token always reads as expired: measured on
 * prod 2026-10-07 (Chromium, clock 2 h fast, 15 min on /home): 107 token
 * refreshes, about 7 a minute, against one an hour on a correct clock.
 *
 * The fix is at the one place every session passes through: the auth
 * storage. When a session is written, its `expires_at` is replaced by
 * "now on this device + expires_in" if the two disagree by more than a
 * minute. The access token itself is untouched (the server checks its own
 * `exp` claim); only the client's idea of when to refresh moves onto the
 * clock it compares with. A device with a correct clock is unchanged
 * (the two agree to within a second or two of network time).
 */

/** Disagreement below this is ordinary network latency, not skew. */
export const SKEW_TOLERANCE_S = 60;

/** The session JSON with expires_at re-based on `nowMs`, or the input unchanged. */
export function rebaseSessionExpiry(value: string, nowMs: number = Date.now()): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Silent by design: not JSON means not a session (auth-js also stores
    // plain strings, e.g. the PKCE verifier); store it exactly as given.
    return value;
  }
  if (!parsed || typeof parsed !== "object") return value;
  const s = parsed as { access_token?: unknown; expires_in?: unknown; expires_at?: unknown };
  if (typeof s.access_token !== "string" || typeof s.expires_in !== "number" || typeof s.expires_at !== "number") return value;
  if (!(s.expires_in > 0)) return value;
  const local = Math.round(nowMs / 1000) + s.expires_in;
  if (Math.abs(s.expires_at - local) <= SKEW_TOLERANCE_S) return value;
  return JSON.stringify({ ...(parsed as object), expires_at: local });
}

type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

/**
 * The value to store: a NEW access token gets a device-clock expiry; a re-save
 * of the token already stored keeps the expiry it was stored with. auth-js
 * re-saves the loaded session on updateUser with its ORIGINAL expires_in, so
 * re-basing that one would push a 50-minute-old token out by another hour and
 * stop the refresh it needs (lh-authz-rls review of this change, 2026-10-07).
 */
export function nextStoredSession(prev: string | null, value: string, nowMs: number = Date.now()): string {
  try {
    const p = prev ? (JSON.parse(prev) as { access_token?: unknown; expires_at?: unknown }) : null;
    const v = JSON.parse(value) as { access_token?: unknown; expires_at?: unknown };
    if (p && typeof p.access_token === "string" && p.access_token === v?.access_token && typeof p.expires_at === "number") {
      return p.expires_at === v.expires_at ? value : JSON.stringify({ ...(v as object), expires_at: p.expires_at });
    }
  } catch {
    // Silent by design: a value that is not a session JSON (the PKCE verifier,
    // a corrupt previous entry) is handled by rebaseSessionExpiry below.
  }
  return rebaseSessionExpiry(value, nowMs);
}

/** Wrap an auth storage so every session it stores carries a device-clock expiry. */
export function withDeviceClockExpiry<T extends AuthStorage>(storage: T): AuthStorage {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: async (key, value) => {
      const prev = await storage.getItem(key);
      await storage.setItem(key, nextStoredSession(prev, value));
    },
    removeItem: (key) => storage.removeItem(key),
  };
}
