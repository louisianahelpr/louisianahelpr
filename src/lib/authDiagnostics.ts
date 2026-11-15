/**
 * What the two "the session went away" reports need to say WHY (Q1596).
 *
 * MEASURED 2026-10-14 (Sentry JAVASCRIPT-3H, auth logs): the 10-13 23:01Z
 * session loss was the WEBSITE in Mobile Safari on an iPhone, 27 s after the
 * email-confirm link, with no /logout and no refresh on the server. The 10-09
 * cases match (minutes after an email-confirm landing). The reports that fired
 * ("Unexpected sign-out", "Session lost on a signed-in screen") could not say
 * whether the page had just consumed a sign-in link, what the auth client did
 * since load, or whether it ran inside another app's browser (a real member
 * signed up with Apple inside Facebook's in-app browser on 2026-10-14). This
 * module records those three things, and never the token itself.
 *
 * The landing hint and the event log are captured by authLanding.ts, which
 * main.tsx imports THIRD (before the Supabase client can strip the URL); this
 * file builds the report from them, and loads only when a report is sent.
 */

import { authEventsSinceLoad, landingAuthHint, loadedAt } from "@/lib/authLanding";

export {
  landingAuthHint,
  noteAuthEventForDiagnostics,
  readLandingAuthHint,
  resetAuthEventsForTest,
  setLandingAuthHintForTest,
  type LandingAuthHint,
} from "@/lib/authLanding";

const IN_APP_BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "facebook"],
  [/Instagram/i, "instagram"],
  [/MessengerForiOS|\bOrca-Android\b/i, "messenger"],
  [/musical_ly|BytedanceWebview|TikTok/i, "tiktok"],
  [/Snapchat/i, "snapchat"],
  [/\bLine\//i, "line"],
  [/LinkedInApp/i, "linkedin"],
  [/Twitter/i, "twitter"],
  [/GSA\//i, "google-app"],
  [/\bPinterest\b/i, "pinterest"],
];

/**
 * Best guess at "another app's built-in browser", from the user agent only.
 * A HINT for diagnostics: such browsers keep their own (sometimes short-lived)
 * storage, so a session saved there can vanish when the sheet closes.
 */
export function inAppBrowserHint(ua: string): string | null {
  for (const [re, name] of IN_APP_BROWSERS) if (re.test(ua)) return name;
  return null;
}

/** Everything a session-loss report carries. No token values, no email. */
export function authDiagnostics(): Record<string, unknown> {
  let ua = "";
  let standalone: boolean | null = null;
  try {
    ua = typeof navigator === "undefined" ? "" : navigator.userAgent ?? "";
    standalone =
      typeof window === "undefined" || typeof window.matchMedia !== "function"
        ? null
        : window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    // Diagnostics only: a throwing navigator or matchMedia leaves the fields empty; the report still goes out.
  }
  const landing = landingAuthHint();
  return {
    landingHadAuthToken: landing.hadAuthToken,
    landingAuthKind: landing.kind,
    landingLinkType: landing.linkType,
    landingPath: landing.path,
    authEventsSinceLoad: authEventsSinceLoad(),
    inAppBrowser: inAppBrowserHint(ua),
    standalone,
    msSinceLoad: loadedAt(),
  };
}
