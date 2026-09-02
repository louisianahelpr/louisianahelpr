import { lazy, Suspense } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { normalizeDeepLinkUrl } from "@/lib/deepLinkRoute";

// Lazy for the same reason App.tsx keeps it lazy: this component is statically
// imported (it renders a <Navigate> and nothing else, so a chunk of its own
// would cost more than it saves), and a static NotFound here would drag the
// 404 page into the entry bundle for every visitor.
const NotFound = lazy(() => import("./NotFound"));

/**
 * The WEB half of the short-link contract.
 *
 * `public/.well-known/apple-app-site-association` claims `/j/*`, `/u/*`,
 * `/m/*`, `/messages/*` and `/post-job/*`, and `src/lib/deepLinkRoute.ts`
 * maps every one of them onto a real route — but only *inside the app*, off
 * the Capacitor `appUrlOpen` event. `src/App.tsx` registered none of them, so
 * on the web all five fell through to `path="*"` and rendered NotFound.
 *
 * That is the exact case a short link exists for. AASA only routes into the
 * app for someone who already HAS the app; the person a `/j/<id>` link is
 * texted to is, by construction, the person most likely not to have it. They
 * got a 404 — and because Apple hands the URL to Safari silently when the app
 * is absent, nothing anywhere recorded the miss (see the note at the top of
 * `scripts/aasa-link-census.mjs` on why this class of rot is invisible).
 *
 * `deepLinkRoute.ts` already states the invariant this closes: "All allowed
 * paths in AASA must either match an App.tsx route or normalize to one here."
 * It held on native and was false on web.
 *
 * WHY IT REUSES `normalizeDeepLinkUrl` RATHER THAN RE-DECLARING THE TABLE.
 * A second copy of the mapping is a second thing to keep in sync, and the
 * whole failure above is a sync failure. Feeding the browser location back
 * through the one normalizer means the web and the app can only ever agree:
 * `/m/<id>` becomes `/messages?jobId=<id>` in both, query and fragment intact.
 *
 * `normalizeDeepLinkUrl` is total, so two of its answers have to be handled:
 * `null` (a path it refuses to route) and a verbatim pass-through (a path it
 * has no rule for). Redirecting to the latter would be a self-redirect loop,
 * so both render NotFound — the same thing the user saw before, but only for
 * shapes that genuinely have no destination.
 */

/** Any allowlisted host works; the path is all `normalizeDeepLinkUrl` reads. */
const CANONICAL_ORIGIN = "https://louisianahelpr.com";

export default function ShortLinkRedirect() {
  const { pathname, search, hash } = useLocation();
  const here = `${pathname}${search}${hash}`;
  const target = normalizeDeepLinkUrl(`${CANONICAL_ORIGIN}${here}`);

  // `null` = refused (auth/admin/root). Equal to `here` = no rule matched and
  // it passed the path straight back, which as a <Navigate> target is a loop.
  if (!target || target === here) {
    return (
      <Suspense fallback={null}>
        <NotFound />
      </Suspense>
    );
  }

  return <Navigate to={target} replace />;
}
