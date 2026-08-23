/**
 * Synchronous "is there probably a session?" probe — WITHOUT importing
 * Supabase.
 *
 * Why this exists: the marketing routes (`/`, `/for-business`) must redirect a
 * signed-in visitor into the app, but answering "is this visitor signed in?"
 * properly means `useCurrentUser()`, which drags `@supabase/supabase-js`
 * (~206 KiB raw / ~53 KiB gzipped) onto the landing page's critical path. That
 * cost is the whole reason `NativeRedirect` was split into its own lazy chunk
 * in the first place — a signed-OUT visitor, i.e. the entire audience the
 * landing page exists for, must never pay it.
 *
 * So the gate is two-stage. This probe answers cheaply and synchronously
 * ("there is no persisted token, this is definitely a guest — render the
 * landing page now, fetch nothing"), and only when it says *maybe* does the
 * real, Supabase-backed check load in its own chunk.
 *
 * It is deliberately a HINT, never an authorization decision:
 *   - false is trustworthy (no token → no session).
 *   - true is a maybe (the token may be expired, revoked, or for a signed-out
 *     account). Every `true` is re-checked by `useCurrentUser()` before
 *     anything actually happens.
 * Nothing is granted on the strength of this function — the only thing it
 * decides is whether to download a chunk and hold a paint for a beat.
 *
 * Supabase v2 persists under `sb-<projectRef>-auth-token`. We scan for the
 * shape rather than hardcoding the project ref, matching the existing readers
 * in src/lib/errorLogger.ts and src/lib/analytics.ts.
 */
export const hasPersistedAuthToken = (): boolean => {
  try {
    if (typeof localStorage === "undefined") return false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) return true;
    }
  } catch {
    // Storage can throw outright in private mode / hardened browsers. Treat an
    // unreadable store as "no token": the cost of guessing wrong is that a
    // signed-in visitor sees the landing page (annoying), whereas guessing
    // "maybe" for everyone would put the Supabase chunk back on every guest's
    // LCP path (the regression this whole file exists to avoid).
  }
  return false;
};
