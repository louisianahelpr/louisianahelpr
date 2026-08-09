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
 * OPT-IN, and fails OPEN. The lock is off unless the user turns it on, and any
 * failure to *evaluate* the setting leaves the app unlocked. Locking someone out
 * of their own account because a preference read failed is a worse outcome than
 * not locking — the account is still protected by the session and by
 * server-side authorization on every write.
 */
import { safeStorage } from "@/lib/safeStorage";
import { isNativePlatform } from "@/lib/nativeInit";

/** safeStorage key for the user's opt-in. Mirrors to Capacitor Preferences so
 *  WebKit eviction can't silently disable the lock. */
export const APP_LOCK_ENABLED_KEY = "helpr_app_lock_enabled";

/**
 * Grace period for backgrounding. Re-prompting for Face ID every time the user
 * flips to Messages for two seconds — or comes back from the Stripe/Google OAuth
 * hand-off — is hostile, and would make the lock the first thing people turn off.
 *
 * 60s is long enough to cover an app-switch or an external auth round-trip, short
 * enough that a phone left on a table re-locks quickly.
 */
export const APP_LOCK_GRACE_MS = 60_000;

/** True when the user has explicitly enabled the lock. Native-only. */
export function isAppLockEnabled(): boolean {
  if (!isNativePlatform) return false;
  try {
    return safeStorage.getItem(APP_LOCK_ENABLED_KEY) === "1";
  } catch {
    // Fail OPEN — see header.
    return false;
  }
}

export function setAppLockEnabled(enabled: boolean): void {
  try {
    if (enabled) safeStorage.setItem(APP_LOCK_ENABLED_KEY, "1");
    else safeStorage.removeItem(APP_LOCK_ENABLED_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Should we re-prompt after returning to the foreground?
 *
 * `backgroundedAt` is null on a cold start, which MUST lock (that's the primary
 * case). Otherwise only lock once the grace period has elapsed.
 */
export function shouldLockOnResume(
  backgroundedAt: number | null,
  now: number = Date.now(),
): boolean {
  if (!isAppLockEnabled()) return false;
  if (backgroundedAt === null) return true;
  return now - backgroundedAt >= APP_LOCK_GRACE_MS;
}
