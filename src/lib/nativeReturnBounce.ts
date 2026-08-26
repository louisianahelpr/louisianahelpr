/**
 * Hand a Stripe return back to the native app.
 *
 * THE PROBLEM. On iOS/Android we open Stripe in an in-app browser sheet, so the
 * app survives underneath (see `openExternalUrl`). When payment completes,
 * Stripe redirects that sheet to `success_url` — our own website. Functionally
 * fine, but the user ends up looking at a web page inside a sheet they have to
 * dismiss by hand, and the app behind it doesn't refresh until they do.
 *
 * WHY NOT A UNIVERSAL LINK. iOS deliberately refuses to re-enter an app from a
 * Universal Link opened inside that same app's SFSafariViewController, so the
 * https success_url can never bounce us home on its own. A custom scheme does
 * escape the sheet — but Stripe only accepts http(s) for success_url. Hence the
 * two-step: Stripe → our https page tagged `native=1` → `helpr://…` → the app
 * closes the sheet and routes (see `nativePush.ts`).
 *
 * WHERE THIS RUNS. In the WEBSITE loaded inside the sheet — NOT in the app.
 * That's why it bails out on native: the app itself must never bounce itself.
 *
 * FAIL-SAFE BY DESIGN. If the scheme doesn't resolve (scheme unregistered, an
 * older build, a genuine web user who somehow has `native=1` in their URL), the
 * navigation is simply ignored by the OS and the page renders exactly as it
 * does today. The worst case is the behaviour we already ship — a manual Done
 * tap — never a lost or duplicated payment. The webhook remains the only source
 * of truth for whether money moved.
 */
import { isNativePlatform } from "@/lib/nativeInit";
import { NATIVE_RETURN_SCHEME } from "@/lib/deepLinkRoute";

/** Query flag the edge functions append to `success_url` for native callers. */
export const NATIVE_RETURN_PARAM = "native";

/**
 * If this page was opened as a native payment return, hand off to the app.
 * Returns true when a hand-off was attempted (caller should stop rendering
 * work), false when this is an ordinary web visit.
 */
export function bounceToNativeAppIfReturning(): boolean {
  if (typeof window === "undefined") return false;
  // The app must not bounce itself — only the website-in-a-sheet does this.
  if (isNativePlatform) return false;

  const url = new URL(window.location.href);
  if (url.searchParams.get(NATIVE_RETURN_PARAM) !== "1") return false;

  // Drop the flag so the app doesn't re-bounce after it routes.
  url.searchParams.delete(NATIVE_RETURN_PARAM);

  // `scheme:///path` (three slashes = empty authority) so the URL parses with
  // the route in `pathname`. With two slashes the first segment becomes the
  // HOST and pathname is empty, which the deep-link normalizer can't route.
  const target = `${NATIVE_RETURN_SCHEME}://${url.pathname}${url.search}`;
  window.location.href = target;
  return true;
}
