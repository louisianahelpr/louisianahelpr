/**
 * Last-route memory, for native resume.
 *
 * THE BUG THIS EXISTS FOR (owner-reported, on device): pull down the
 * notification shade, come back, and the app is on /dashboard instead of the
 * screen you were reading. No splash screen appears, so the NATIVE process
 * never died — what died is the WKWebView content process. iOS jetsams it
 * while the app is backgrounded and reloads it on resume, which re-runs all
 * our JS from the web entrypoint. That entrypoint is always `/`, so
 * `resolveNativeLaunchRoute()` does its job perfectly and sends the
 * (signed-in) user to /dashboard. The router is not broken; it simply has no
 * memory of where the user was.
 *
 * A remount is indistinguishable from a cold start from inside the WebView —
 * the same reason AppLockGate refuses to persist its background timestamp.
 * So rather than trying to detect the resume, we just remember the route and
 * let a freshness window decide: a reload seconds after the user was reading
 * /messages restores /messages; opening the app cold the next morning gets
 * the dashboard, which is what you want anyway.
 *
 * Storage note: the key deliberately does NOT use the `helpr_` prefix.
 * safeStorage mirrors prefixed keys into Capacitor Preferences
 * (NSUserDefaults), and this is written on EVERY navigation — a durable
 * write per route change is real disk churn for a value that only ever needs
 * to outlive a WebView reload. localStorage already survives content-process
 * termination, which is the entire failure mode being handled.
 */
import { safeStorage } from "@/lib/safeStorage";

const KEY = "lh_last_route";

/**
 * How stale a remembered route may be and still be restored.
 *
 * Tuned for the failure mode: a jetsam-and-reload happens within seconds or
 * minutes of backgrounding. Long enough to cover a real errand, short enough
 * that "open the app the next day" still lands on the dashboard.
 */
const RESTORE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Routes that must never be restored.
 *
 * Two different reasons, both of which bite:
 *   - Auth and profile-gating routes are STATES, not places. Restoring
 *     /reset-password after its token expired, or /complete-profile after the
 *     profile was completed, drops the user somewhere they cannot leave.
 *   - One-shot confirmation screens (/payment-success) are tied to a
 *     transaction that already finished. Re-showing "payment complete" on a
 *     resume reads as a second charge.
 */
const NEVER_RESTORE = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/complete-profile",
  "/account-pending",
  "/account-denied",
  "/account-banned",
  "/payment-success",
];

/** Is this a path worth coming back to? */
export function isRestorablePath(path: string): boolean {
  if (!path) return false;

  // Match on the PATHNAME only. Comparing the raw string would let
  // "/login?redirect=/messages" past the exclusion list — it is neither equal
  // to "/login" nor prefixed by "/login/" — and auth routes carry query
  // params more often than not.
  const pathname = path.split(/[?#]/)[0];

  // "/" is the launch entrypoint itself — restoring it would be a no-op at
  // best and a redirect loop at worst.
  if (!pathname || pathname === "/") return false;

  // Exact match or a genuine child segment. A bare startsWith would also
  // reject "/logins-report" for sharing five letters with "/login".
  return !NEVER_RESTORE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Remember where the user is. Called on every navigation.
 *
 * Takes the full path INCLUDING search params: the app leans on query state
 * for tabs (/profile?tab=security, /legal?tab=terms), so dropping the search
 * would restore the right page with the wrong panel open — a subtler version
 * of the same bug.
 */
export function rememberRoute(pathWithSearch: string): void {
  if (!isRestorablePath(pathWithSearch)) return;
  try {
    safeStorage.setItem(KEY, JSON.stringify({ p: pathWithSearch, t: Date.now() }));
  } catch {
    /* route memory is a convenience — never break navigation over it */
  }
}

/**
 * The route to restore, or null.
 *
 * Returns null rather than throwing on anything unexpected: a corrupt value
 * should land the user on the dashboard, not on an error boundary.
 */
export function readRestorableRoute(now: number = Date.now()): string | null {
  try {
    const raw = safeStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { p, t } = parsed as { p?: unknown; t?: unknown };
    if (typeof p !== "string" || typeof t !== "number") return null;
    // A timestamp from the future means a clock change, not a fresh route.
    if (t > now) return null;
    if (now - t > RESTORE_WINDOW_MS) return null;
    if (!isRestorablePath(p)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Forget the remembered route (sign-out). */
export function clearRememberedRoute(): void {
  try {
    safeStorage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}
