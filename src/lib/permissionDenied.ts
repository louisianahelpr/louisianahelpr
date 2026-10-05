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
