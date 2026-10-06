import type { OAuthRedirectError } from "@/lib/oauthRedirectError";

/**
 * The one notice line above the Login form, and the Q446 account choice.
 * A sign-in that found no account asks the one-account question in a dialog
 * (SocialAuthButtons), not in this slot; "I already have an account" arrives
 * here as ?connect= (log in, then connect).
 */
/**
 * One-shot note left by SocialAuthButtons when the account-choice dialog's code
 * failed to download: the app's stale-download recovery then reloads the page,
 * which loses the question, so this flag (a timestamp, no account data) lets
 * Log In say why the person is back here. Read once; ignored after 2 minutes.
 */
export const ACCOUNT_CHOICE_RETRY_KEY = "helpr_account_choice_retry";
const ACCOUNT_CHOICE_RETRY_MAX_AGE_MS = 2 * 60 * 1000;

export function markAccountChoiceRetry(): void {
  try {
    sessionStorage.setItem(ACCOUNT_CHOICE_RETRY_KEY, String(Date.now()));
  } catch {
    // Silent by design: storage blocked (private mode). Only the explanatory
    // line after the reload is lost; the next tap still asks the question.
  }
}

export function takeAccountChoiceRetry(now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(ACCOUNT_CHOICE_RETRY_KEY));
    sessionStorage.removeItem(ACCOUNT_CHOICE_RETRY_KEY);
    return Number.isFinite(at) && at > 0 && now - at < ACCOUNT_CHOICE_RETRY_MAX_AGE_MS;
  } catch {
    // Silent by design: storage blocked; no note to show, nothing to act on.
    return false;
  }
}

export function loginNotice(o: {
  oauthError: OAuthRedirectError | null;
  accountChoiceRetry?: boolean;
  connect: string | null;
  signedOutForInactivity: boolean;
  arrivedFromSignup: boolean;
  bouncedFromGatedRoute: boolean;
}) {
  const accountChoice = o.oauthError?.choice ? { ...o.oauthError.choice, provider: o.oauthError.provider } : null;
  const connectName = o.connect === "apple" ? "Apple" : o.connect === "google" ? "Google" : o.connect === "any" ? "Apple or Google" : null;
  const notice =
    o.oauthError && !accountChoice
      ? o.oauthError.message
      : accountChoice
      ? null // the dialog says it; "That page needs an account" (the /home bounce) would not fit
      : o.accountChoiceRetry
      ? "We couldn't finish that sign-in, so no account was made. Tap Apple or Google again to continue."
      : connectName
      ? `Log in to the account you already have. Next you'll connect ${connectName} to it, so that button opens this same account from now on.`
      : o.signedOutForInactivity
      ? "You were signed out after 30 minutes of inactivity. Log back in to pick up where you left off."
      : o.arrivedFromSignup
        ? "If that email already has an account, log in below. Forgot your password? Reset it and you'll be back in."
        : o.bouncedFromGatedRoute
          ? "That page needs an account. Log in and we'll take you straight back to it."
          : null;
  return { accountChoice, notice };
}
