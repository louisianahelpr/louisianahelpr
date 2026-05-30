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

  // Auth + onboarding flow — any AuthShell-based page that may exceed
  // the viewport height on small devices (iPhone SE) or in landscape
  // belongs here. AuthShell uses `min-h-screen` document scroll; if the
  // route is NOT in this list, `html.app-shell { overflow: hidden }`
  // clips anything below the fold and the user can't reach it. Only
  // genuinely-short auth pages that always fit (Login at the moment)
  // may safely stay off this list.
  "/signup",
  "/signup-pending",
  "/complete-profile",
  "/account-pending",
  "/account-denied",
  "/account-banned",
  "/forgot-password",
  "/reset-password",
  // Post-checkout confirmation — AuthShell (`min-h-screen` document scroll)
  // with a tall lifecycle list + CTA. Off this list, `html.app-shell`'s
  // `overflow: hidden` clipped the "Back to dashboard" button below the
  // fold on iPhone SE, leaving the user stranded on the screen.
  "/payment-success",

  // In-app pages built around a `min-h-screen` document-scroll layout
  // (PageHeader + tall content). Pages that render via AppShell /
  // PageScaffold (Dashboard, Profile, Activity / My Jobs / My Posts,
  // Schedule, Availability, SavedHelpers, Messages) deliberately stay
  // OFF this list — their AppShell already provides an internal scroll
  // container, and double-locking would let html overscroll bleed into
  // AppShell's scroll surface (iOS double-rubber-band).
  "/user",        // /user/:userId — UserProfile (PageHeader + min-h-screen)
  "/post-job",    // PostJob (PageHeader + min-h-screen)
  "/job-history", // JobHistory (PageHeader + min-h-screen)
  "/business",    // BusinessTeam (PageHeader + min-h-screen)
  "/admin",       // Admin dashboard (min-h-screen document-scroll + sidebar)
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
