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
 * It imports nothing (no Supabase): main.tsx imports it THIRD, so the landing
 * URL is read before the Supabase client module can detect and strip it.
 */

type LandingAuthKind = "code" | "access_token" | "token_hash" | "error";

export interface LandingAuthHint {
  /** True when the URL this page loaded with carried a sign-in token of any kind. */
  hadAuthToken: boolean;
  /** Which kind; never the value. */
  kind: LandingAuthKind | null;
  /** The `type=` the link named (signup, magiclink, recovery, ...), when it named one. */
  linkType: string | null;
  /** Path only, no query or fragment (both can hold the token). */
  path: string;
}

/** Read the landing URL's auth shape. Pure; never returns a token value. */
export function readLandingAuthHint(search: string, hash: string, path: string): LandingAuthHint {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const has = (k: string) => q.has(k) || h.has(k);
  let kind: LandingAuthKind | null = null;
  if (has("access_token")) kind = "access_token";
  else if (has("code")) kind = "code";
  else if (has("token_hash")) kind = "token_hash";
  else if (has("error_code") || has("error_description")) kind = "error";
  const rawType = q.get("type") ?? h.get("type");
  const linkType = rawType && /^[a-z_]{1,24}$/.test(rawType) ? rawType : null;
  return { hadAuthToken: kind !== null && kind !== "error", kind, linkType, path };
}

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

const loadedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? () => Math.round(performance.now()) : () => 0;

let landing: LandingAuthHint = { hadAuthToken: false, kind: null, linkType: null, path: "" };
try {
  if (typeof window !== "undefined" && window.location) {
    landing = readLandingAuthHint(window.location.search, window.location.hash, window.location.pathname);
  }
} catch {
  // Diagnostics only: an unreadable location leaves the empty hint.
}

/** The landing hint captured once, at module evaluation. */
export function landingAuthHint(): LandingAuthHint {
  return landing;
}

/** Test seam: replace the captured landing hint. */
export function setLandingAuthHintForTest(next: LandingAuthHint): void {
  landing = next;
}

const MAX_EVENTS = 16;
const events: Array<{ event: string; ms: number }> = [];

/** Record one auth event (event name and ms since page load), newest last, last 16 kept. */
export function noteAuthEventForDiagnostics(event: string, ms: number = loadedAt()): void {
  events.push({ event, ms });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Test seam. */
export function resetAuthEventsForTest(): void {
  events.length = 0;
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
  return {
    landingHadAuthToken: landing.hadAuthToken,
    landingAuthKind: landing.kind,
    landingLinkType: landing.linkType,
    landingPath: landing.path,
    authEventsSinceLoad: events.slice(),
    inAppBrowser: inAppBrowserHint(ua),
    standalone,
    msSinceLoad: loadedAt(),
  };
}
