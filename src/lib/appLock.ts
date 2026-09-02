/**
 * appLock — optional Face ID / Touch ID gate over the whole app.
 *
 * WHY THIS EXISTS. The Supabase client is configured with
 * `persistSession: true` + `autoRefreshToken: true` (see
 * integrations/supabase/client.ts), so a returning user is silently
 * re-authenticated on launch and never sees the sign-in screen. That is good
 * UX, but it means ANYONE holding the unlocked phone has the account: payouts,
 * Stripe Connect, instant payout, message history.
 *
 * `biometricGate.requireBiometric()` already protects individual money ACTIONS,
 * which is the right last line of defence. This adds the missing first one: a
 * lock over the app itself, unlocking the already-restored session — the model
 * banking apps use.
 *
 * (Deliberately NOT "Face ID on the sign-in screen": a user who reaches sign-in
 * either has no session to unlock, or explicitly signed out — and reviving a
 * deliberately-ended session with a biometric would defeat signing out.)
 *
 * OPT-IN, and fails OPEN on the *setting*. The lock is off unless the user
 * turns it on, and any failure to *evaluate the opt-in* leaves the app
 * unlocked. Locking someone out of their own account because a preference read
 * failed is a worse outcome than not locking — the account is still protected
 * by the session and by server-side authorization on every write.
 *
 * Once the lock IS on, every *timing* decision fails CLOSED: a missing,
 * unparseable, or future-dated background timestamp locks, and so does a JS
 * context we cannot prove is a continuation of a still-running app process.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FILE WAS REWRITTEN FOR (owner, on device):
 *   "Does not need to lock every time I swipe out."
 *
 * Two independent causes, both fixed here:
 *
 * 1. THE GRACE WINDOW NEVER RAN. The 60s window existed, but the background
 *    timestamp lived in a React ref. On iOS the WKWebView *content process* is
 *    routinely jetsammed while the app is backgrounded and reloaded on resume
 *    — the exact failure `lib/lastRoute.ts` was written for ("No splash screen
 *    appears, so the NATIVE process never died"). Every resume therefore
 *    arrived with a fresh JS context, a null ref, and an unconditional lock.
 *    The timestamp is now persisted through `safeStorage` (localStorage +
 *    Capacitor Preferences / NSUserDefaults), so it survives that teardown.
 *
 *    The old code REFUSED to persist it, on the grounds that a stale timestamp
 *    from just before an app kill would skip the lock on a real cold start.
 *    That objection is answered below, not ignored — see
 *    `isContinuedAppSession`.
 *
 * 2. THE LOCK WAS DRIVEN OFF THE WRONG EVENT. `appStateChange` on iOS is
 *    `UIApplication.didBecomeActive` / `willResignActive` (read
 *    node_modules/@capacitor/app/ios/Sources/AppPlugin/AppPlugin.swift). It
 *    fires for the Notification Centre shade, Control Centre, an incoming-call
 *    banner, a share sheet — and for the Face ID sheet itself. Those are not
 *    backgrounding. The same plugin ALSO emits `pause` (didEnterBackground)
 *    and `resume` (willEnterForeground), which are the real thing. The lock now
 *    keys off pause/resume; `appStateChange` only raises the privacy shield
 *    that keeps account data out of the app-switcher snapshot.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { safeStorage } from "@/lib/safeStorage";
import { isNativePlatform } from "@/lib/nativeInit";

/** safeStorage key for the user's opt-in. Mirrors to Capacitor Preferences so
 *  WebKit eviction can't silently disable the lock. */
export const APP_LOCK_ENABLED_KEY = "helpr_app_lock_enabled";

/** safeStorage key for the chosen grace window, in ms. */
export const APP_LOCK_GRACE_KEY = "helpr_app_lock_grace_ms";

/**
 * safeStorage key for "the app went to the background at". MUST be durable:
 * the whole point is that it outlives a WKWebView content-process teardown.
 * The `helpr_` prefix puts it on safeStorage's Preferences mirror.
 *
 * Unlike `lastRoute`'s key — which deliberately skips the mirror because it is
 * written on every navigation — this is written at most once per background,
 * so the durable write is not churn.
 */
export const APP_LOCK_BACKGROUNDED_AT_KEY = "helpr_app_lock_bg_at";

/**
 * Default grace period for backgrounding.
 *
 * Re-prompting for Face ID every time the user flips to Messages for two
 * seconds — or comes back from the Stripe/Google OAuth hand-off — is hostile,
 * and trains people to switch the lock off entirely, which is strictly worse
 * for the account than a short window.
 *
 * 60s, matching iOS's own "Require Passcode → After 1 minute" tier: long
 * enough to cover an app-switch, copying an address out of Maps, reading a
 * text, or an external auth round-trip; short enough that a phone put down on
 * a table re-locks before it is out of the owner's sight for long.
 */
export const APP_LOCK_GRACE_MS = 60_000;

/**
 * The windows offered in Profile → Security. Kept to three because this is a
 * security control: a long tail of options invites people to pick the loosest
 * one without reading. "Immediately" preserves the old behaviour for anyone
 * who actually wanted it.
 */
export const APP_LOCK_GRACE_OPTIONS = [
  { ms: 0, label: "Immediately" },
  { ms: APP_LOCK_GRACE_MS, label: "After 1 minute" },
  { ms: 5 * 60_000, label: "After 5 minutes" },
] as const;

const ALLOWED_GRACE_MS = new Set<number>(APP_LOCK_GRACE_OPTIONS.map((o) => o.ms));

/**
 * Dev-only harness switch: `?app_lock_demo=1` on a `npm run dev` build makes
 * the gate behave as it does on device, so the background/resume lifecycle can
 * actually be driven and observed in a browser. Mirrors the existing
 * `?debug_auth=1` precedent in `hooks/useAuthReady.ts`.
 *
 * `import.meta.env.DEV` is statically false in every production build, so
 * Rollup drops this branch — it cannot be turned on in the shipped app.
 */
const DEMO_MODE =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("app_lock_demo");

/**
 * Exported so `AppLockGate` can stand in a fake signed-in session while the
 * harness is on — the gate deliberately does nothing for a signed-out visitor,
 * so without this there is no way to exercise it in a browser at all.
 *
 * Dead code in every production build (`import.meta.env.DEV` is a compile-time
 * `false`, so the `&&` chain folds to `false` and Rollup drops the branch).
 */
export const APP_LOCK_DEMO = DEMO_MODE;
export const APP_LOCK_DEMO_EMAIL = "demo@louisianahelpr.test";

/**
 * Is the lock available at all on this platform?
 *
 * Native only in production — there is no device biometric to gate with on the
 * web, and `requireBiometric()` is a pass-through there.
 */
export function isAppLockSupported(): boolean {
  return isNativePlatform || DEMO_MODE;
}

/** True when the user has explicitly enabled the lock. */
export function isAppLockEnabled(): boolean {
  if (!isAppLockSupported()) return false;
  try {
    return safeStorage.getItem(APP_LOCK_ENABLED_KEY) === "1";
  } catch {
    // Fail OPEN on the SETTING — see header.
    return false;
  }
}

export function setAppLockEnabled(enabled: boolean): void {
  try {
    if (enabled) safeStorage.setItem(APP_LOCK_ENABLED_KEY, "1");
    else {
      safeStorage.removeItem(APP_LOCK_ENABLED_KEY);
      // Don't leave a background timestamp behind for a lock that is now off —
      // re-enabling it later must not inherit a stale "you were here 4 seconds
      // ago" and skip the first prompt.
      clearBackgroundedAt();
    }
  } catch {
    /* best-effort */
  }
}

/**
 * The user's chosen grace window, in ms.
 *
 * Anything that isn't one of the offered options — a corrupt value, a value
 * from a future version, a hand-edited preference — falls back to the default
 * rather than being trusted. A caller must never be able to widen the window
 * past what the UI can express.
 */
export function getAppLockGraceMs(): number {
  try {
    const raw = safeStorage.getItem(APP_LOCK_GRACE_KEY);
    if (raw === null) return APP_LOCK_GRACE_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !ALLOWED_GRACE_MS.has(parsed)) return APP_LOCK_GRACE_MS;
    return parsed;
  } catch {
    return APP_LOCK_GRACE_MS;
  }
}

export function setAppLockGraceMs(ms: number): void {
  if (!ALLOWED_GRACE_MS.has(ms)) return;
  try {
    safeStorage.setItem(APP_LOCK_GRACE_KEY, String(ms));
  } catch {
    /* best-effort */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Background timestamp — durable across a WebView content-process teardown.
// ─────────────────────────────────────────────────────────────────────────────

/** Record that the app ACTUALLY went to the background (Capacitor `pause`). */
export function recordBackgroundedAt(now: number = Date.now()): void {
  try {
    safeStorage.setItem(APP_LOCK_BACKGROUNDED_AT_KEY, String(now));
  } catch {
    // A failed write means the next resume reads null, which locks. Fail closed.
  }
}

/** Forget it — on unlock, on sign-out, and when the lock is switched off. */
export function clearBackgroundedAt(): void {
  try {
    safeStorage.removeItem(APP_LOCK_BACKGROUNDED_AT_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * The persisted background timestamp, or null if there isn't a usable one.
 *
 * Null for missing, empty, non-numeric or non-finite values. Callers treat
 * null as "lock" — a timestamp we cannot read is not evidence of anything.
 */
export function readBackgroundedAt(): number | null {
  try {
    const raw = safeStorage.getItem(APP_LOCK_BACKGROUNDED_AT_KEY);
    if (raw === null || raw === "") return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cold start vs. WebView reload.
// ─────────────────────────────────────────────────────────────────────────────

/** sessionStorage key. Deliberately NOT safeStorage: the whole value of this
 *  key is that it does NOT survive the app process dying. */
const APP_SESSION_MARKER_KEY = "helpr_app_lock_session";

/**
 * Is this JS context a CONTINUATION of an app process that was already
 * running, rather than a fresh launch?
 *
 * This is the question the old code declared unanswerable ("a remount is
 * indistinguishable from a cold start from inside the WebView"). It is
 * answerable, with two independent signals, either of which is conclusive
 * because BOTH are false on a genuine launch:
 *
 *   1. A `sessionStorage` marker. sessionStorage is scoped to the WKWebView's
 *      browsing session: it survives `webView.reload()` but is gone when the
 *      app process is killed and a new WKWebView is built. Present ⇒ same app
 *      process.
 *
 *   2. Navigation type `"reload"`. Capacitor's own
 *      `webViewWebContentProcessDidTerminate` calls `webView.reload()`
 *      (node_modules/@capacitor/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift),
 *      so a jetsam recovery reports `reload`. A cold launch loads
 *      `capacitor://localhost/` fresh and reports `navigate`.
 *
 * Signal 2 is a hedge in case WebKit ever stops carrying sessionStorage across
 * a content-process kill; ORing them is safe precisely because neither can be
 * true on a launch, so the OR cannot manufacture continuity out of nothing.
 *
 * Evaluated ONCE at module load — before the marker is written, so the read
 * cannot see its own write — and then frozen for the life of the context.
 */
function detectContinuedAppSession(): boolean {
  let marked = false;
  try {
    marked = sessionStorage.getItem(APP_SESSION_MARKER_KEY) === "1";
    sessionStorage.setItem(APP_SESSION_MARKER_KEY, "1");
  } catch {
    // Private mode / storage disabled — no signal, fall through to nav type.
  }
  if (marked) return true;

  try {
    const entries = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    return entries[0]?.type === "reload";
  } catch {
    // No evidence of continuity ⇒ treat as a cold start ⇒ lock. Fail closed.
    return false;
  }
}

export const isContinuedAppSession: boolean =
  typeof window === "undefined" ? false : detectContinuedAppSession();

// ─────────────────────────────────────────────────────────────────────────────
// Decisions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Should we re-prompt after returning to the foreground?
 *
 * `backgroundedAt` is null on a cold start, which MUST lock (that's the primary
 * case). Otherwise only lock once the grace period has elapsed.
 *
 * A timestamp in the FUTURE means the device clock moved — daylight saving, a
 * manual change, an NTP correction, or someone winding the clock forward to
 * fake a short absence. `now - backgroundedAt` would be negative and would
 * silently pass the window, so it is rejected outright: lock.
 */
export function shouldLockOnResume(
  backgroundedAt: number | null,
  now: number = Date.now(),
  graceMs: number = getAppLockGraceMs(),
): boolean {
  if (!isAppLockEnabled()) return false;
  if (backgroundedAt === null || !Number.isFinite(backgroundedAt)) return true;
  const elapsed = now - backgroundedAt;
  // Future-dated timestamp (clock change) — no credit for time we can't trust.
  if (elapsed < 0) return true;
  return elapsed >= graceMs;
}

/**
 * Should a FRESH JS context come up locked?
 *
 * Called from the gate's initial state and again once durable storage has
 * hydrated. Three outcomes:
 *
 *   - lock off              → false
 *   - genuine cold start    → true, ALWAYS. A relaunched app process
 *                             re-authenticates, whatever timestamp is sitting
 *                             in Preferences. This is the guarantee the old
 *                             "never persist the timestamp" rule was
 *                             protecting, kept intact.
 *   - WebView reload        → defer to the grace window, using the persisted
 *                             timestamp. This is the case the owner was
 *                             hitting on every single swipe-out.
 */
export function shouldLockOnFreshStart(now: number = Date.now()): boolean {
  if (!isAppLockEnabled()) return false;
  if (!isContinuedAppSession) return true;
  return shouldLockOnResume(readBackgroundedAt(), now);
}
