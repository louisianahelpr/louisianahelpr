/**
 * Where a monitoring script sends its credentials (code scanning,
 * js/file-access-to-http, 2026-10-05).
 *
 * Several scripts read a token (Supabase access token, Stripe key, Vercel
 * token, Sentry token) and send it to `https://api.<vendor>` by default. They
 * also honour an `LH_*_API_BASE` env var, which exists ONLY so a test can point
 * the call at a stub server on this machine. Left unchecked, that variable
 * would send the real token to any host whoever controls the environment names.
 *
 * `apiBase(override, defaultBase)` returns `defaultBase` when no override is
 * set, accepts an override only when it is a plain http(s) URL on loopback
 * (127.0.0.1, localhost or ::1), and throws otherwise. Trailing slashes are
 * dropped so callers can append `/v1/...`.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackBase(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK.has(u.hostname) && !u.username && !u.password;
}

export function apiBase(override, defaultBase) {
  if (override === undefined || override === null || override === "") return defaultBase;
  if (!isLoopbackBase(override)) {
    throw new Error(
      `Refusing to send credentials to ${override}: an LH_*_API_BASE override may only name a loopback stub (http://127.0.0.1:<port>). Unset it to use ${defaultBase}.`,
    );
  }
  return override.replace(/\/+$/, "");
}
