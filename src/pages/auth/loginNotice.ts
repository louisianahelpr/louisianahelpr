import type { OAuthRedirectError } from "@/lib/oauthRedirectError";
import { SELL_ONE_PATH } from "@/lib/declutter/sellChooser";

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
  /** Where the bounced guest was going (already checked by safeInternalRedirect). */
  redirect?: string | null;
}) {
  const declutterPage = o.bouncedFromGatedRoute ? declutterGatedNotice(o.redirect) : null;
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
          ? declutterPage ?? "That page needs an account. Log in and we'll take you straight back to it."
          : null;
  // AUD31-16: a guest who followed a Declutter link is most likely new, so the notice leads with Create an account.
  const leadWithSignup = declutterPage !== null && notice === declutterPage;
  return { accountChoice, notice, leadWithSignup };
}

/**
 * AUD31-16 (audit 2026-10-31, Guests on Declutter pages): a guest opening a shared Declutter link was told only "That
 * page needs an account" over "Welcome back, neighbor.", with nothing saying what the page was. It names the page.
 */
export function declutterGatedNotice(redirect: string | null | undefined): string | null {
  if (!redirect) return null;
  const url = new URL(redirect, "https://x.invalid");
  // The first path segment, so "/declutter" and everything under it match, and "/declutterx" does not.
  if (url.pathname.split("/")[1] !== "declutter") return null;
  const back = "Create an account, or log in and we'll take you straight back to it.";
  if (url.pathname.startsWith("/declutter/item/")) return `That's an item for sale on Declutter, neighbors selling what they don't need. ${back}`;
  // Every Sell address (the one-item form, a bunch, the chooser) starts with the one-item form's path.
  if (url.pathname.startsWith(SELL_ONE_PATH)) return `Selling on Declutter needs an account. ${back}`;
  const tab = url.searchParams.get("tab");
  if (tab === "buying") return `Your Declutter orders need an account. ${back}`;
  if (tab === "selling") return `Your Declutter listings need an account. ${back}`;
  return `That's Declutter, neighbors selling what they don't need. ${back}`;
}
