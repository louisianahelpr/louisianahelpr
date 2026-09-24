/**
 * Deep-link → in-app route normalizer.
 *
 * Universal Links (iOS) and App Links (Android) deliver the full
 * https://louisianahelpr.com/<path>?<query> URL to the running app. The
 * Capacitor `appUrlOpen` listener in `nativePush.ts` strips the host and
 * hands the remainder to React Router via `navigate()`.
 *
 * Every link we mint is already a real `src/App.tsx` route (Q194), so this
 * module no longer translates paths: it filters hosts, refuses auth/admin/root
 * and keeps the query and fragment. Kept separate so it is
 * unit-testable without spinning up React Router, and so the AASA file
 * (`public/.well-known/apple-app-site-association`) and the JS routing
 * stay in lock-step — the same set of paths is claimed in AASA and
 * normalized here.
 *
 * All allowed paths in AASA must either match an `App.tsx` route or
 * normalize to one here. Anything else falls through to NotFound, which
 * is a worse share experience than the link not deep-linking at all.
 */

/**
 * Hosts whose URLs we are willing to consume as Universal Links.
 *
 * Must stay in sync with the `applinks:` entries in
 * `ios/App/App/App.entitlements`. iOS only delivers `appUrlOpen` events
 * for hosts declared there, but we also enforce in JS so a misconfigured
 * test build or an Android quirk can't smuggle in a foreign host.
 */
/**
 * The app's own URL scheme, registered in ios/App/App/Info.plist. Declared here
 * rather than alongside the bounce helper so this module stays dependency-light
 * and unit-testable without pulling in Capacitor.
 */
export const NATIVE_RETURN_SCHEME = "helpr";

const ALLOWED_DEEP_LINK_HOSTS = new Set<string>([
  "louisianahelpr.com",
  "www.louisianahelpr.com",
]);

/**
 * Translate the path+query of an inbound Universal Link to the
 * equivalent in-app React Router route. Returns `null` if the URL
 * should be ignored (foreign host, root path, or a path we explicitly
 * don't deep-link into the app).
 *
 * Examples:
 *   /jobs/abc      → /jobs/abc
 *   /user/xyz     → /user/xyz
 *   /messages     → /messages
 *   /legal        → /legal
 *   /post-job     → /post-job
 *   /legal#refunds → /legal#refunds   (the fragment is preserved — see below)
 *   /             → null  (cold-launch sentinel, handled elsewhere)
 *   /auth/...    → null  (Supabase OAuth callback must stay in browser)
 */
export function normalizeDeepLinkUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  // The app's own custom scheme (`helpr:///payment-success?…`) is how a Stripe
  // return escapes the in-app browser sheet — iOS refuses to re-enter an app
  // from a Universal Link opened inside that same app's SFSafariViewController,
  // so the https success_url bounces through the scheme instead (see
  // src/lib/nativeReturnBounce.ts). It carries no host by construction, so the
  // host allowlist below would reject it. The scheme is NOT exclusive: any app
  // or web page can open helpr:///anything, and iOS hands it to us. That is
  // safe only because it can reach nothing a normal in-app link could not, and
  // the route it exists for (PaymentSuccess) only READS job state — it never
  // writes (src/test/nativeReturnSchemeIsUntrusted.test.ts).
  const isNativeReturnScheme = url.protocol === `${NATIVE_RETURN_SCHEME}:`;

  if (!isNativeReturnScheme && !ALLOWED_DEEP_LINK_HOSTS.has(url.host)) return null;

  // Strip trailing slash so /jobs/ and /jobs match the same branch.
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const search = url.search; // includes leading "?" or empty

  // The FRAGMENT has to survive. This function used to rebuild every result as
  // `${path}${search}` and silently drop `url.hash`, which is not cosmetic:
  //
  //   * Supabase auth puts its tokens in the fragment. The recovery mail is
  //     <project>.supabase.co/auth/v1/verify?...&redirect_to=.../reset-password
  //     (supabase/functions/auth-email-hook/index.ts) and the redirect lands as
  //     /reset-password#access_token=…&type=recovery. ResetPassword.tsx reads
  //     `window.location.hash` directly (line ~64). Dropping the hash would
  //     hand it an empty fragment.
  //   * In-page anchors. /legal IS claimed in AASA, and
  //     src/components/policy/CollapsedPolicy.tsx expands + scrolls to a
  //     section purely off `window.location.hash`. A shared
  //     …/legal#cancellations link opened on device landed at the top of the
  //     page with the anchor thrown away — the only LIVE symptom of this bug,
  //     since the auth paths are excluded in AASA precisely because of it.
  //
  // `URL.hash` includes the leading "#", or is "" when absent — so appending
  // it unconditionally is a no-op for the overwhelmingly common hash-less link.
  const hash = url.hash;

  // Root deep links collapse to "no deep link" — cold launch already
  // computes the right home destination via resolveNativeLaunchRoute.
  if (path === "/" || path === "") return null;

  // Never auto-route auth callbacks or admin into the app. AASA already
  // excludes these; the JS guard is belt-and-suspenders.
  if (path.startsWith("/auth/") || path.startsWith("/admin")) return null;

  // NO SHORT-LINK TABLE (Q194, owner 2026-09-23: "The old address shouldn't
  // be redirects, it should be direct"). `/j/:id`, `/u/:id`, `/m/:id`,
  // `/messages/:id`, `/legal/:tab` and `/post-job/*` used to be rewritten here
  // onto their real routes. Nothing we ship ever minted one (no source, SQL
  // function, email template or stored notification/message on prod), so the
  // table, the AASA claims and the web routes went together.

  // Everything else: pass through verbatim. React Router will match it
  // (e.g. /jobs/:id, /user/:userId, /messages, /legal) or fall through
  // to the NotFound boundary.
  return `${path}${search}${hash}`;
}
