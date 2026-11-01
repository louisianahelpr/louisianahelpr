import { useLocation, useNavigate, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Signpost } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { report } from "@/lib/errorLogger";
import { usePageMeta } from "@/hooks/usePageMeta";
import PublicLayout from "@/components/marketing/PublicLayout";
import { setNotFoundPathname } from "@/hooks/useAppShellViewport";

/**
 * NotFound — the catch-all `path="*"` route.
 *
 * It now wraps in PublicLayout, so it carries the same marketing Navbar +
 * Footer as /jobs, /help and /legal (owner, 2026-08-24, audit V12). This
 * REVERSES an earlier note here which argued a 404 should stay chrome-less
 * so the two big CTAs were the only way out and the visitor couldn't
 * "wander off into invalid space". The reasoning didn't survive contact with
 * how people actually arrive: a 404 is reached by a stale bookmark, a bad
 * external link, or a typo — the visitor's next move is usually "find the
 * real page", and the two CTAs on offer (back, home) cannot serve that.
 * Search, Jobs, Help and the footer's site map can. It was also the ONE
 * public route with bespoke chrome, so a wrong URL made the site look like
 * it had changed identity at the worst possible moment for trust.
 *
 * The body is the shared EmptyState (spec v2, 2026-10-21): "Go home" is the
 * one primary button, "Go back" a text link under it.
 *
 * On NATIVE, PublicLayout renders AppShell instead of the marketing chrome
 * (no App Store footer inside the app), so the in-app 404 is unaffected.
 */
const NotFound = () => {
  // The SPA serves unknown paths with a 200 status, so the 404 page must
  // be explicitly non-indexable to keep junk URLs out of search results.
  usePageMeta({
    title: "Page not found — Helpr",
    description: "The page you're looking for doesn't exist or has been moved.",
    robots: "noindex",
  });
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    report(new Error(`404 — non-existent route: ${location.pathname}`), {
      severity: "info",
      tags: { source: "NotFound", route: location.pathname },
    });
  }, [location.pathname]);

  // Tell useAppShellViewport that THIS pathname is the catch-all, so it drops
  // the `html.app-shell` 100dvh/overflow:hidden lock. Without it the nav +
  // footer this page now carries are taller than a viewport and everything
  // past the fold — including "Back to Home" on a phone — is unreachable.
  // The route table can't express "every path that isn't a route", so the
  // page reports itself; see setNotFoundPathname.
  useEffect(() => {
    setNotFoundPathname(location.pathname);
    return () => setNotFoundPathname(null);
  }, [location.pathname]);

  return (
    // page-warmth + mesh-gradient-global are NOT repeated here: PublicLayout
    // already paints both, and stacking a second mesh over the first doubled
    // the gradient's opacity.
    //
    // Spec v2 rebuild (audit 2026-10-21, old-design list): the 404 is the ONE
    // empty-state layout (shared EmptyState: circle + olive line icon, title,
    // one muted sentence, one primary button), not a bespoke "Helpr · LA"
    // wordmark over a giant "404" with two Title Case buttons. "Go back" is a
    // plain text link under the one primary button. The title says "Page not
    // found" in the body so e2e/errorScreens.ts's 404 pattern sees the screen.
    <PublicLayout>
      <div className="flex justify-center px-5 py-12 sm:py-20" data-testid="not-found">
        <div className="w-full max-w-[440px] flex">
          {/* The page's one h1 for assistive tech; EmptyState's title is a <p>. */}
          <h1 className="sr-only">Error 404</h1>
          <EmptyState
            variant="inline"
            icon={Signpost}
            title="Page not found"
            body="This page doesn't exist or has moved. The link may be old."
            action={
              <div className="flex flex-col items-center gap-3 w-full">
                <Button asChild variant="primary" size="lg" className="w-full max-w-[280px] rounded-full">
                  <Link to="/">Go home</Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-3 tracking-normal"
                  style={{ color: "hsl(var(--bark))" }}
                  // A bare history.back() is a no-op on a cold deep-link / direct
                  // landing where this 404 is the first history entry — fall back
                  // to home so the link always does something.
                  onClick={() => (window.history.length <= 1 ? navigate("/") : window.history.back())}
                >
                  Go back
                </Button>
              </div>
            }
          />
        </div>
      </div>
    </PublicLayout>
  );
};

export default NotFound;
