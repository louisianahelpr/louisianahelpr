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
  /** F281a: this browser has held a session before (hadSessionOnThisBrowser). A bounce from a gated route is then a
   *  lapsed member's, not a guest's: the session-lost line, leading with Log in, not Create an account. */
  hadSessionHere?: boolean;
  arrivedFromSignup: boolean;
  bouncedFromGatedRoute: boolean;
  /** Where the bounced guest was going (already checked by safeInternalRedirect). */
  redirect?: string | null;
}) {
  const declutterPage = o.bouncedFromGatedRoute ? gatedPageNotice(o.redirect) : null;
  const accountChoice = o.oauthError?.choice ? { ...o.oauthError.choice, provider: o.oauthError.provider } : null;
  const connectName = o.connect === "apple" ? "Apple" : o.connect === "google" ? "Google" : o.connect === "any" ? "Apple or Google" : null;
  const notice =
    o.oauthError && !accountChoice
      ? o.oauthError.message
      : accountChoice
      ? null // the dialog says it; "That page needs an account" (the /home bounce) would not fit
      : connectName
      ? `Log in to the account you already have. Next you'll connect ${connectName} to it, so that button opens this same account from now on.`
      : o.sessionLost || (o.bouncedFromGatedRoute && o.hadSessionHere)
      ? "You were signed out on this browser. Log back in and we'll take you right back to where you were."
      : o.signedOutForInactivity
      ? "You were signed out after 30 minutes of inactivity. Log back in to pick up where you left off."
      : o.arrivedFromSignup
        ? "If that email already has an account, log in below. Forgot your password? Reset it and you'll be back in."
        : o.bouncedFromGatedRoute
          ? declutterPage ?? `That page needs a free account. ${BACK_TO_IT}`
          : null;
  // AUD31-16: a guest who followed a Declutter link is most likely new, so the notice leads with Create an account.
  // F080 (owner UI audit 11-09): every gated page does the same (the Sell pattern), with its own line.
  // F252: the returning-member lines (payment, finish profile) end with LOG_BACK_IN, so they do not lead with sign-up.
  // F286a: a private job link is the poster's or Helpr's, so it leads with Log in too.
  const leadWithSignup = o.bouncedFromGatedRoute && notice !== null && notice !== JOB_LINK_NOTICE && notice.endsWith(BACK_TO_IT);
  return { accountChoice, notice, leadWithSignup };
}

const BACK_TO_IT = "Create an account, or log in and we'll take you straight back to it.";
/** F286a: the one gated line that does not end with BACK_TO_IT, so the form leads with Log in. */
export const JOB_LINK_NOTICE = "This job is only visible to the person who posted it and the person doing it. Log in and we'll take you straight back to it.";

/**
 * F080 (owner UI audit 11-09): most gated pages said a generic "That page needs an account" over the Log in form,
 * while Declutter Sell named the page and led with Create an account. Every gated page now says what it is, the same
 * way: "Posting a job needs a free account." + Create an account / Log in. Declutter keeps its own lines (AUD31-16).
 */
const GATED_PAGE_LINES: readonly [prefix: string, line: string][] = [
  ["/post-job", "Posting a job needs a free account."],
  ["/tips", "Sending a tip needs a free account."],
  ["/shops", "Shops needs a free account."],
  ["/messages", "Your messages need an account."],
  ["/jobs", "Your jobs need an account."],
  ["/profile", "Your profile needs an account."],
  ["/home", "Your home page needs an account."],
];

/**
 * F252 (audit 11-10): /payment-success and /complete-profile are only reached by someone who already has an account
 * (back from Stripe; mid sign-up), so "Create an account" was the wrong lead. These say log in, and Login does not
 * lead with Create an account for them.
 */
const RETURNING_PAGE_LINES: readonly [prefix: string, line: string][] = [
  ["/payment-success", "Log in to see your payment."],
  ["/complete-profile", "Log in to finish your profile."],
];
const LOG_BACK_IN = "We'll take you straight back to it.";

export function gatedPageNotice(redirect: string | null | undefined): string | null {
  const declutter = declutterGatedNotice(redirect);
  if (declutter || !redirect) return declutter;
  const path = new URL(redirect, "https://x.invalid").pathname;
  // F286a (audit 11-10): a link to one job that is not public (hired, done, cancelled) comes from the
  // job's own poster or Helpr, who already has an account. Lead with Log in, not Create an account.
  if (/^\/jobs\/[0-9a-f-]{36}$/i.test(path)) return JOB_LINK_NOTICE;
  const first = `/${path.split("/")[1] ?? ""}`;
  const returning = RETURNING_PAGE_LINES.find(([prefix]) => prefix === first)?.[1];
  if (returning) return `${returning} ${LOG_BACK_IN}`;
  const line = GATED_PAGE_LINES.find(([prefix]) => prefix === first)?.[1];
  return line ? `${line} ${BACK_TO_IT}` : null;
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
  const back = BACK_TO_IT;
  if (url.pathname.startsWith("/declutter/item/")) return `That's an item for sale on Declutter, neighbors selling what they don't need. ${back}`;
  // Every Sell address (the one-item form, a bunch, the chooser) starts with the one-item form's path.
  if (url.pathname.startsWith(SELL_ONE_PATH)) return `Selling on Declutter needs an account. ${back}`;
  // Audit 11-10 F359l: the settings page and the moving-sale planner were "That's Declutter..." too; they say what they are.
  if (url.pathname.startsWith("/declutter/settings")) return `Your Declutter settings need an account. ${back}`;
  if (url.pathname.startsWith("/declutter/move")) return `Planning a moving sale? That needs an account. ${back}`;
  const tab = url.searchParams.get("tab");
  if (tab === "buying") return `Your Declutter orders need an account. ${back}`;
  if (tab === "selling") return `Your Declutter listings need an account. ${back}`;
  return `That's Declutter, neighbors selling what they don't need. ${back}`;
}
