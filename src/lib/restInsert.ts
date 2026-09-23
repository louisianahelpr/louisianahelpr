/**
 * Insert rows through PostgREST with a plain `fetch` — no supabase-js.
 *
 * Telemetry (error_logs, analytics_events) must not depend on a lazily loaded
 * chunk: the browser caches a failed dynamic import for the whole document,
 * so one transient failure of the supabase-client chunk used to drop every
 * later report and event in that session (Q161, Q162). `fetch` is always
 * there. The request mirrors what postgrest-js `insert()` sends.
 */

/** fetch keepalive refuses bodies over 64 KiB; stay under it with margin. */
const KEEPALIVE_MAX_BYTES = 60_000;

/**
 * The signed-in user's access token, if storage holds an unexpired one.
 * supabase-js keeps the session under `sb-<project-ref>-auth-token`.
 */
function storedAccessToken(supabaseUrl: string): string | null {
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: unknown; expires_at?: unknown } | null;
    const token = parsed?.access_token;
    if (typeof token !== "string" || !token) return null;
    // An expired token is refused with 401, and the whole batch with it.
    const expiresAt = typeof parsed?.expires_at === "number" ? parsed.expires_at : 0;
    if (expiresAt && expiresAt * 1000 <= Date.now() + 5_000) return null;
    return token;
  } catch {
    // Storage blocked or unparseable: send as anon, which both insert
    // policies allow. Not reported: this runs inside the reporter itself.
    return null;
  }
}

/**
 * POST `rows` to `table`. `rowsFor(asUser)` builds the body for the auth the
 * request is actually sent with: true = the stored session token, false = the
 * publishable key (anon). Tables whose insert policy pins `user_id` to
 * auth.uid() must drop user_id when `asUser` is false, or RLS refuses the whole
 * batch (the Q110 class). Returns the final HTTP status, or 0 when nothing
 * could be sent (no config / network error). Never throws.
 */
export async function postRows<T>(
  table: string,
  columns: readonly string[],
  rowsFor: (asUser: boolean) => T[],
): Promise<number> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!supabaseUrl || !key || typeof fetch !== "function") return 0;
  const cols = columns.map((c) => `"${c}"`).join(",");
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}?columns=${encodeURIComponent(cols)}`;
  const send = (bearer: string, asUser: boolean) => {
    const body = JSON.stringify(rowsFor(asUser));
    return fetch(url, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        "Content-Profile": "public",
      },
      body,
      // Lets a flush that starts as the page goes away still complete.
      keepalive: body.length < KEEPALIVE_MAX_BYTES,
    });
  };
  try {
    const token = storedAccessToken(supabaseUrl);
    let res = await send(token ?? key, token != null);
    // A token the server no longer accepts: the rows are still worth having,
    // so send once more as anon.
    if (res.status === 401 && token) res = await send(key, false);
    return res.status;
  } catch {
    // Network failure. The caller counts status 0 as a failed batch; it is
    // never reported, because reporting a telemetry failure through the
    // telemetry path would recurse on itself.
    return 0;
  }
}
