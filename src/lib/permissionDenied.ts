/**
 * Permission-denied detection, dependency-free so errorLogger can import it.
 *
 * A 42501 on a read is what a bundle built before a grant was narrowed gets
 * (src/lib/clientCompat.ts). errorLogger.report() announces every one with
 * PERMISSION_DENIED_EVENT so the update path (src/lib/staleClient.ts on web,
 * useVersionCheck on native) re-checks at once instead of leaving the user on
 * "We couldn't load this".
 */
/**
 * Postgres's own grant refusal: what an old bundle gets for a withheld column,
 * table or function. Keyed on the MESSAGE, not the code alone: 42501 is also
 * what an RLS WITH CHECK failure ("new row violates row-level security
 * policy") and the app's own RPC "not allowed" raises use (65 public functions
 * raise it on prod, lh-authz-rls review 2026-10-05). Those are ordinary
 * refusals, not a stale bundle, and must not trigger a reload.
 */
export const isPermissionDenied = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && /permission denied for (table|column|relation|view|function|sequence|schema)\b/i.test(msg);
};

/** Fired (on window) whenever a permission-denied error is reported. */
export const PERMISSION_DENIED_EVENT = "helpr:permission-denied";

/** Announce a permission-denied error. Never throws. */
export function announcePermissionDenied(err: unknown): void {
  if (!isPermissionDenied(err)) return;
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT));
  } catch {
    /* CustomEvent unavailable (very old engine): the focus/resume checks still run. */
  }
}

/**
 * SESSION-LOSS NOISE (Q1596, lead decision 2026-11-02). Once ProtectedRoute
 * has confirmed the session is gone and reported "Session lost on a signed-in
 * screen", every read that screen still has in flight goes out with the anon
 * key and is refused as "permission denied". Those refusals are the session
 * loss, already reported once, not separate errors: measured on prod
 * 2026-10-19, 10-22 and 10-30, each "Session lost" row came in one batch with
 * 1-3 denials each on up to 9 tables/functions from the same client.
 *
 * So, from the moment the loss is marked until a new sign-in on this document,
 * report() drops permission-denied errors. Scoped to this client (module
 * state, one document) and this session (cleared by SIGNED_IN; the redirect to
 * Log In reloads the page, which clears it too). A denial while the session is
 * live is never marked, so it still reports.
 */
let sessionLostMarked = false;

/** ProtectedRoute calls this when it reports a confirmed session loss. */
export function markSessionLost(): void {
  sessionLostMarked = true;
}

/** A new session (SIGNED_IN): denials report again. */
export function clearSessionLost(): void {
  sessionLostMarked = false;
}

/** True for a permission-denied error that follows a confirmed session loss. */
export const isSessionLossNoise = (err: unknown): boolean => sessionLostMarked && isPermissionDenied(err);
