/**
 * Deep-link → in-app route normalizer.
 *
 * Universal Links (iOS) and App Links (Android) deliver the full
 * https://louisianahelpr.com/<path>?<query> URL to the running app. The
 * Capacitor `appUrlOpen` listener in `nativePush.ts` strips the host and
 * hands the remainder to React Router via `navigate()`.
 *
 * Some link shapes we ship in shares / SMS / email don't 1:1 map to the
 * routes defined in `src/App.tsx`:
 *
 *   - Short share links — `/j/:id` (job), `/u/:id` (user), `/m/:id`
 *     (message thread) — we don't want long ugly URLs in SMS, but the
 *     App Router only knows `/jobs/:id`, `/user/:id`, `/messages`.
 *   - `/post-job/draft/:id` style sub-paths that should still land on
 *     `/post-job`.
 *
 * This module owns the translation table. Kept separate so it is
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
 *   /j/abc         → /jobs/abc
 *   /user/xyz     → /user/xyz
 *   /u/xyz        → /user/xyz
 *   /messages     → /messages
 *   /m/abc        → /messages?jobId=abc
 *   /legal        → /legal
 *   /legal/terms  → /legal?tab=terms
 *   /post-job     → /post-job
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
  // host allowlist below would reject it; the scheme is only deliverable to us
  // because it is registered in our own Info.plist, which is the same trust
  // boundary the allowlist provides for https links.
  const isNativeReturnScheme = url.protocol === `${NATIVE_RETURN_SCHEME}:`;

  if (!isNativeReturnScheme && !ALLOWED_DEEP_LINK_HOSTS.has(url.host)) return null;

  // Strip trailing slash so /jobs/ and /jobs match the same branch.
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const search = url.search; // includes leading "?" or empty

  // Root deep links collapse to "no deep link" — cold launch already
  // computes the right home destination via resolveNativeLaunchRoute.
  if (path === "/" || path === "") return null;

  // Never auto-route auth callbacks or admin into the app. AASA already
  // excludes these; the JS guard is belt-and-suspenders.
  if (path.startsWith("/auth/") || path.startsWith("/admin")) return null;

  // Short user link → canonical /user/:id route.
  const uMatch = /^\/u\/([^/]+)$/.exec(path);
  if (uMatch) return `/user/${uMatch[1]}${search}`;

  // Short job link → /jobs/:id, which is a real route (JobDetail, App.tsx).
  // The previous comment here said the route did not exist yet and the user
  // would land on the in-app 404 — that stopped being true once JobDetail
  // shipped, and it misled anyone reasoning about short-link behaviour.
  const jMatch = /^\/j\/([^/]+)$/.exec(path);
  if (jMatch) return `/jobs/${jMatch[1]}${search}`;

  // Short message-thread link → /messages?jobId=:id (the existing
  // Messages page reads `jobId` + `userId` query params to auto-open a
  // thread; see src/pages/Messages.tsx).
  // Accept BOTH the short `/m/:id` form and the long `/messages/:id` form.
  // The AASA file claims `/messages/*` (and its components block documents it
  // as "Messages thread deep link"), but App.tsx only defines `/messages` —
  // there is no `/messages/:id` route — and this normalizer had no branch for
  // it, so a shared thread link fell through to the verbatim pass-through and
  // landed on the in-app 404. That violated this module's own contract above:
  // every AASA-claimed path must match an App.tsx route or normalize to one.
  const mMatch = /^\/(?:m|messages)\/([^/]+)$/.exec(path);
  if (mMatch) {
    const params = new URLSearchParams(search);
    params.set("jobId", mMatch[1]);
    return `/messages?${params.toString()}`;
  }

  // /legal/:tab → /legal?tab=:tab (mirrors the in-app /terms, /privacy,
  // /rules redirects already defined in App.tsx).
  const legalMatch = /^\/legal\/([^/]+)$/.exec(path);
  if (legalMatch) {
    const params = new URLSearchParams(search);
    if (!params.has("tab")) params.set("tab", legalMatch[1]);
    const qs = params.toString();
    return qs ? `/legal?${qs}` : "/legal";
  }

  // /post-job/* sub-paths (e.g. draft restore) → just /post-job for now.
  // PostJob owns its own internal step state; the sub-path is reserved
  // for future deep-restore behavior.
  if (path === "/post-job" || path.startsWith("/post-job/")) {
    return `/post-job${search}`;
  }

  // Everything else: pass through verbatim. React Router will match it
  // (e.g. /jobs/:id, /user/:userId, /messages, /legal) or fall through
  // to the NotFound boundary.
  return `${path}${search}`;
}
