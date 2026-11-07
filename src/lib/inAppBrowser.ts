/**
 * 11-07: Facebook, Messenger and Instagram open shared links in their own built-in browser (an embedded web view).
 * Google refuses OAuth sign-in inside embedded web views (its "disallowed_useragent" policy), so "Continue with Google"
 * cannot work there; email sign-up and Apple still do. Matched by the marks these apps put in the user agent.
 */
const SOCIAL_IN_APP = /\b(FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|MessengerForiOS|MessengerLiteForiOS)\b/;

export function isSocialInAppBrowser(ua: string | null | undefined = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return SOCIAL_IN_APP.test(ua ?? "");
}
