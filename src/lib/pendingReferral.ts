/**
 * A friend's referral code carried across an Apple or Google sign-up (owner
 * 2026-10-25: "make sure there's a place to enter the referral code"). The
 * `?ref=` on the sign-up or log-in link is saved here before the provider
 * redirect, and the "Got a friend's code?" card (EnterReferralCodeCard)
 * starts filled with it. Storage only pre-fills a field: the server decides
 * everything (public.claim_my_referral_code).
 */
export const PENDING_REF_KEY = "lh_pending_ref";

/** Remember a `?ref=` code so an Apple or Google sign-up can claim it after the redirect. */
export function rememberReferralFromUrl(search: string): void {
  const code = new URLSearchParams(search).get("ref")?.trim().toUpperCase();
  if (!code) return;
  try {
    localStorage.setItem(PENDING_REF_KEY, code);
  } catch {
    // Silent by design: without storage the person can still type the code on the Referrals tab.
  }
}

/** The saved code, or "" (unreadable storage only means the field starts empty). */
export function readPendingReferral(): string {
  try {
    return localStorage.getItem(PENDING_REF_KEY) ?? "";
  } catch {
    // Silent by design: unreadable storage only means the field starts empty.
    return "";
  }
}

/** Forget the saved code once it is recorded (or the account already has one). */
export function clearPendingReferral(): void {
  try {
    localStorage.removeItem(PENDING_REF_KEY);
  } catch {
    // Silent by design: a leftover key only pre-fills this field.
  }
}
