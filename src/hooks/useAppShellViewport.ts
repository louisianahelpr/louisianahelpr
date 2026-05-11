import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Routes that use document-scroll (long-form content, SEO landing pages).
 * Everything else gets the fixed app-shell viewport lock applied to <html>.
 */
const DOCUMENT_SCROLL_ROUTES = [
  "/",

  "/for-business",

  "/legal",
  "/terms",
  "/privacy",
  "/rules",
  "/data-rights",

  "/jobs", // public marketing /jobs (uses Navbar + long page)
  "/support",

  // Auth + onboarding flow — only the TALL multi-step / multi-card pages
  // stay on document scroll so users can reach fields below the fold.
  // Short auth pages (Login, ForgotPassword, etc.) use the viewport
  // lock so iOS doesn't rubber-band the body around content that fits.
  "/signup",
  "/complete-profile",
  "/account-pending",

  // In-app pages built around a tall `min-h-screen` layout. Without
  // document scroll the html-level lock clips anything below the fold —
  // Profile's tab list, Activity's job stream, PostJob's multi-step form,
  // etc. Pages that have their own internal scroll container (Dashboard,
  // Schedule, Availability, SavedHelpers, Messages) deliberately stay
  // OFF this list so the bottom nav stays pinned.
  "/profile",
  "/user",        // /user/:userId
  "/my-jobs",
  "/my-posts",
  "/activity",
  "/post-job",
  "/job-history",
  "/business",    // /business/team
];

const isDocumentScrollRoute = (pathname: string) => {
  return DOCUMENT_SCROLL_ROUTES.some((route) =>
    route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`),
  );
};

/**
 * Toggles the `app-shell` class on <html> based on the current route.
 * When present, the html/body/#root are locked to 100dvh with overflow:hidden,
 * forcing pages to use AppShell's internal scroll container.
 */
export const useAppShellViewport = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const html = document.documentElement;
    if (isDocumentScrollRoute(pathname)) {
      html.classList.remove("app-shell");
    } else {
      html.classList.add("app-shell");
    }
    return () => {
      // Don't strip on unmount — the next route effect will set it correctly.
    };
  }, [pathname]);
};
