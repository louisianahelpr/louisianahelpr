import { safeStorage, trackKey } from "@/lib/safeStorage";

/**
 * Owner 2026-11-20 (ease batch, item 6): while a sign-up's email is not verified yet, the person can browse and START a
 * job post or listing. Supabase gives an unconfirmed address no session ("confirm email" is on), so to the app they are
 * a guest; this device remembers that a sign-up is waiting on its email, and only the final action that needs an
 * account (posting live, messaging, paying: every one of them goes through /signup) says "Check your email to finish"
 * with a resend, instead of a second sign-up form that cannot work for a registered address.
 *
 * Tracked (trackKey) so it survives the app being closed while the person opens their email; dropped once verified
 * (SignupPending), on "Use a different email", and after 7 days. Guard: src/test/pendingVerificationGates.test.tsx.
 */
const KEY = "helpr.pendingSignup";
trackKey(KEY);
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function rememberPendingSignup(email: string, now: number = Date.now()): void {
  const e = email.trim();
  if (!e) return;
  safeStorage.setItem(KEY, JSON.stringify({ email: e, at: now }));
}

/** The address a sign-up on this device is waiting on, or null (none, unreadable, or older than 7 days). */
export function readPendingSignup(now: number = Date.now()): { email: string } | null {
  try {
    const raw = safeStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { email?: unknown; at?: unknown };
    if (typeof v.email !== "string" || !v.email || typeof v.at !== "number" || now - v.at > MAX_AGE_MS || v.at > now + 60_000) {
      safeStorage.removeItem(KEY);
      return null;
    }
    return { email: v.email };
  } catch {
    // An unreadable record is no pending sign-up: the normal sign-up form shows, which is always safe.
    return null;
  }
}

export function clearPendingSignup(): void {
  safeStorage.removeItem(KEY);
}
