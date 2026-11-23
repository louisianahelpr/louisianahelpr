import { track, AhaEvent } from "@/lib/analytics";
import { safeStorage } from "@/lib/safeStorage";
import { ppoTrackingProps } from "@/lib/ppoAttribution";

/**
 * signup_completed for Apple and Google sign-ups (audit DQ-2, 2026-11-23).
 *
 * The only emitter was the email path (src/pages/auth/Signup.tsx), so the 11 of
 * 13 real sign-ups in the week to 11-23 that came through Apple (6) or Google
 * (5) never counted (prod auth.users vs analytics_events_real: 2 events). A
 * social account is created by the sign-in itself, with no form to finish, so
 * the moment the app first sees its session is the completed sign-up.
 *
 * "New account" is read from the user record GoTrue hands back: on the sign-in
 * that CREATED the account, last_sign_in_at is created_at plus a fraction of a
 * second (measured on prod 2026-11-23, the week's 11 social accounts: 0.17 s
 * at most), while a returning person's last_sign_in_at is the current sign-in,
 * long after created_at. Email accounts are left out: Signup.tsx already fires
 * for them, and counting their first verified sign-in too would double them.
 * Linking Apple or Google to an older email account keeps provider "email".
 *
 * Fired once per account on this device (safeStorage), so a SIGNED_IN repeat
 * in the same session window does not count it twice.
 */

/** Well above the measured 0.17 s, far below any real return visit. */
export const NEW_ACCOUNT_WINDOW_MS = 2 * 60_000;

const SOCIAL_PROVIDERS = new Set(["apple", "google"]);
const KEY_PREFIX = "helpr_signup_completed_tracked";

export interface SignupUser {
  id: string;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: unknown } | null;
}

/**
 * And the account itself is young: a stored session read back days later (a
 * reload, or device storage that lost the once-only mark) still carries the
 * creating sign-in's timestamps, so it must not count again.
 */
export const RECENT_ACCOUNT_MS = 30 * 60_000;

/** The provider name when this session is the sign-in that created a social account, else null. */
export function newSocialSignupProvider(user: SignupUser, now: number = Date.now()): "apple" | "google" | null {
  const provider = user.app_metadata?.provider;
  if (typeof provider !== "string" || !SOCIAL_PROVIDERS.has(provider)) return null;
  const created = Date.parse(user.created_at ?? "");
  const signedIn = Date.parse(user.last_sign_in_at ?? "");
  if (!Number.isFinite(created) || !Number.isFinite(signedIn)) return null;
  if (Math.abs(signedIn - created) > NEW_ACCOUNT_WINDOW_MS) return null;
  if (now - created > RECENT_ACCOUNT_MS) return null;
  return provider as "apple" | "google";
}

/** Fires signup_completed once for a new Apple/Google account; a no-op for anything else. */
export function trackSocialSignupCompleted(user: SignupUser): void {
  const provider = newSocialSignupProvider(user);
  if (!provider) return;
  const key = `${KEY_PREFIX}_${user.id}`;
  if (safeStorage.getItem(key)) return;
  safeStorage.setItem(key, "1");
  track(AhaEvent.SignupCompleted, { provider, ...ppoTrackingProps() });
}
