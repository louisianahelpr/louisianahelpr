import type { OAuthRedirectError } from "@/lib/oauthRedirectError";

/**
 * The one notice line above the Login form, and the Q446 account choice.
 * A sign-in that found no account asks the one-account question in a dialog
 * (SocialAuthButtons), not in this slot; "I already have an account" arrives
 * here as ?connect= (log in, then connect).
 */
export function loginNotice(o: {
  oauthError: OAuthRedirectError | null;
  connect: string | null;
  signedOutForInactivity: boolean;
  /** The device lost its session on a signed-in screen (ProtectedRoute). */
  sessionLost?: boolean;
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
      : connectName
      ? `Log in to the account you already have. Next you'll connect ${connectName} to it, so that button opens this same account from now on.`
      : o.sessionLost
      ? "You were signed out on this browser. Log back in and we'll take you right back to where you were."
      : o.signedOutForInactivity
      ? "You were signed out after 30 minutes of inactivity. Log back in to pick up where you left off."
      : o.arrivedFromSignup
        ? "If that email already has an account, log in below. Forgot your password? Reset it and you'll be back in."
        : o.bouncedFromGatedRoute
          ? "That page needs an account. Log in and we'll take you straight back to it."
          : null;
  return { accountChoice, notice };
}
