import type { OAuthRedirectError } from "@/lib/oauthRedirectError";
import { SELL_ONE_PATH } from "@/lib/declutter/sellChooser";
import { wordInLang } from "@/lib/i18n/inLang";

/**
 * Reads a one-shot sessionStorage note (another screen left it for Login) and clears it, so a refresh does not repeat
 * the line. Silent by design in the catch: sessionStorage throws in private mode, and the note only decides whether
 * an explanatory line shows; not showing it is the correct degradation, with nothing for anyone to act on.
 */
export function takeOneShotFlag(key: string, value: string): boolean {
  try {
    const hit = sessionStorage.getItem(key) === value;
    if (hit) sessionStorage.removeItem(key);
    return hit;
  } catch {
    // Silent by design: sessionStorage throws in private mode, and this note only decides whether an explanatory
    // line shows on Login. Not showing it is the correct degradation; there is nothing for anyone to act on.
    return false;
  }
}

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
  /** ?reason= on the Login URL: "apply" from an open job's Log in (guestLogInUrl). */
  reason?: string | null;
}) {
  const declutterPage = o.bouncedFromGatedRoute ? gatedPageNotice(o.redirect, o.reason) : null;
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
      ? SESSION_LOST_NOTICE
      : o.signedOutForInactivity
      ? INACTIVITY_NOTICE
      : o.arrivedFromSignup
        ? "If that email already has an account, log in below. Forgot your password? Reset it and you'll be back in."
        : o.bouncedFromGatedRoute
          ? declutterPage ?? GENERIC_PAGE_NOTICE
          : null;
  // Polish audit 11-27 #4: the notice no longer carries its own "Create an account" link (the tabs above the form
  // say it), so there is no sign-up lead to compute; every gated line is one short "Log in to …" sentence.
  // Audit 11-21 (P27): the notice wore a clock for every reason, which read as a time-out on a plain login wall. Only
  // the two signed-out lines are about time; the rest get an info mark (Login picks the icon from this).
  const timedOut = notice === SESSION_LOST_NOTICE || notice === INACTIVITY_NOTICE;
  return { accountChoice, notice, timedOut };
}

const SESSION_LOST_NOTICE = "You were signed out on this browser. Log back in and we'll take you right back to where you were.";
const INACTIVITY_NOTICE = "You were signed out after 30 minutes of inactivity. Log back in to pick up where you left off.";
/** Polish audit 11-27 #4: one short line per page, the same "Log in to …" pattern everywhere. */
const GENERIC_PAGE_NOTICE = "Log in to see that page.";
/** Log in from an open job a guest was reading (guestLogInUrl): it is public, so never "only visible to". */
export const JOB_APPLY_NOTICE = "Log in to apply for this job.";
export const JOB_LINK_NOTICE = "This job is only visible to the person who posted it and the person doing it. Log in and we'll take you straight back to it.";

/**
 * F080 (owner UI audit 11-09): most gated pages said a generic "That page needs an account" over the Log in form,
 * while Declutter Sell named the page and led with Create an account. Every gated page now says what it is, the same
 * way: "Posting a job needs a free account." + Create an account / Log in. Declutter keeps its own lines (AUD31-16).
 */
const GATED_PAGE_LINES: readonly [prefix: string, line: string][] = [
  ["/post-job", "Log in to post a job."],
  ["/shops", "Log in to see Shops."],
  ["/jobs", "Log in to see your jobs."],
  ["/profile", "Log in to see your profile."],
  ["/home", "Log in to see your Home."],
  // Audit 11-21 (P27): /posts said the generic "That page needs a free account."
  ["/posts", "Log in to see your posts."],
];

/**
 * F252 (audit 11-10): /payment-success and /complete-profile are only reached by someone who already has an account
 * (back from Stripe; mid sign-up), so "Create an account" was the wrong lead. These say log in, and Login does not
 * lead with Create an account for them.
 */
const RETURNING_PAGE_LINES: readonly [prefix: string, line: string][] = [
  ["/payment-success", "Log in to see your payment."],
  ["/complete-profile", "Log in to finish your profile."],
  // F418 (audit 11-10): a link into /messages comes from a message email, notice or a member's own app, so the
  // person holding it already has an account. Log in leads.
  ["/messages", "Log in to see your messages."],
  // Audit 11-21 (P27): /tips/:id and /quotes/* links come from a member's own notifications (a tip prompt after a
  // job, a quote asked for or received), so the holder already has an account. They led with Create an account.
  ["/tips", "Log in to send your tip."],
  ["/quotes", "Log in to see your quote."],
];

export function gatedPageNotice(redirect: string | null | undefined, reason?: string | null): string | null {
  const declutter = declutterGatedNotice(redirect);
  if (declutter || !redirect) return declutter;
  const path = new URL(redirect, "https://x.invalid").pathname;
  // Audit 11-21 (P1): Log in from an OPEN job (the guest page or preview, guestLogInUrl's reason=apply) said the job
  // was private. Only the not-public branch (JobDetail's sign-in bounce, no reason) gets JOB_LINK_NOTICE.
  if (reason === "apply" && /^\/jobs\/[0-9a-f-]{36}$/i.test(path)) return JOB_APPLY_NOTICE;
  // F286a (audit 11-10): a link to one job that is not public (hired, done, cancelled) comes from the
  // job's own poster or Helpr, who already has an account. Lead with Log in, not Create an account.
  if (/^\/jobs\/[0-9a-f-]{36}$/i.test(path)) return JOB_LINK_NOTICE;
  const first = `/${path.split("/")[1] ?? ""}`;
  const returning = RETURNING_PAGE_LINES.find(([prefix]) => prefix === first)?.[1];
  if (returning) return returning;
  return GATED_PAGE_LINES.find(([prefix]) => prefix === first)?.[1] ?? null;
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
  if (url.pathname.startsWith("/declutter/item/")) return "Log in to see this item.";
  // Every Sell address (the one-item form, a bunch, the chooser) starts with the one-item form's path.
  if (url.pathname.startsWith(SELL_ONE_PATH)) return "Log in to sell on Declutter.";
  // Audit 11-10 F359l: the settings page and the moving-sale planner say what they are.
  if (url.pathname.startsWith("/declutter/settings")) return "Log in to see your Declutter settings.";
  if (url.pathname.startsWith("/declutter/move")) return "Log in to plan a moving sale.";
  const tab = url.searchParams.get("tab");
  if (tab === "buying") return "Log in to see your Declutter orders.";
  if (tab === "selling") return "Log in to see your Declutter listings.";
  return "Log in to use Declutter.";
}

/**
 * Design audit areas 11-18 #1: the notice in the reader's language. Each English sentence above (the whole notice, or
 * a page line plus BACK_TO_IT / LOG_BACK_IN) is swapped for its Spanish (esPublic "ln.*"); a sentence with no Spanish
 * (an OAuth error, the connect line) stays as it is. English readers get the notice unchanged.
 */
const NOTICE_KEYS: readonly [english: string, key: string][] = [
  ["This job is only visible to the person who posted it and the person doing it. Log in and we'll take you straight back to it.", "ln.jobLink"],
  ["Log in to apply for this job.", "ln.jobApply"],
  ["Log in to post a job.", "ln.g.postJob"],
  ["Log in to see Shops.", "ln.g.shops"],
  ["Log in to see your jobs.", "ln.g.jobs"],
  ["Log in to see your profile.", "ln.g.profile"],
  ["Log in to see your Home.", "ln.g.home"],
  ["Log in to see your posts.", "ln.g.posts"],
  ["Log in to see your payment.", "ln.r.payment"],
  ["Log in to finish your profile.", "ln.r.profile"],
  ["Log in to see your messages.", "ln.r.messages"],
  ["Log in to send your tip.", "ln.r.tips"],
  ["Log in to see your quote.", "ln.r.quotes"],
  ["Log in to see this item.", "ln.d.item"],
  ["Log in to sell on Declutter.", "ln.d.sell"],
  ["Log in to see your Declutter settings.", "ln.d.settings"],
  ["Log in to plan a moving sale.", "ln.d.move"],
  ["Log in to see your Declutter orders.", "ln.d.buying"],
  ["Log in to see your Declutter listings.", "ln.d.selling"],
  ["Log in to use Declutter.", "ln.d.any"],
  ["Log in to see that page.", "ln.pageNeeds"],
  ["You were signed out on this browser. Log back in and we'll take you right back to where you were.", "ln.sessionLost"],
  ["You were signed out after 30 minutes of inactivity. Log back in to pick up where you left off.", "ln.inactivity"],
  ["If that email already has an account, log in below. Forgot your password? Reset it and you'll be back in.", "ln.fromSignup"],
];

export function loginNoticeInLang(notice: string): string {
  let out = notice;
  for (const [english, key] of NOTICE_KEYS) if (out.includes(english)) out = out.replace(english, wordInLang(key, english));
  return out;
}
