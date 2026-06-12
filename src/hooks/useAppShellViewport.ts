import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isNativePlatform } from "@/lib/nativeInit";

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

  "/verify",      // /verify/:helperId — public helper verification card
  "/local-guide", // local pricing guide — public marketing page
  "/jobs", // public marketing /jobs (uses Navbar + long page)
  "/support",

  // Auth + onboarding flow — any AuthShell-based page that may exceed
  // the viewport height on small devices (iPhone SE) or in landscape
  // belongs here. AuthShell uses `min-h-screen` document scroll; if the
  // route is NOT in this list, `html.app-shell { overflow: hidden }`
  // clips anything below the fold and the user can't reach it. Login is
  // deliberately OFF this list — it's tuned to fit a single non-scrolling
  // viewport (see Login.tsx's compact spacing).
  "/signup",
  "/signup-pending",
  "/complete-profile",
  // NOTE: /account-pending deliberately stays OFF this list. AccountPending
  // renders via AppShell — its content is a single fixed-height centered
  // card (`flex items-center justify-center`), not long-form scrolling
  // onboarding. AppShell's internal scroll handles the rare overflow case,
  // and html-locking it keeps the page's shell choice and this list in
  // agreement (a mismatch lets html overscroll bleed into AppShell).
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
  "/user",         // /user/:userId — UserProfile (PageHeader + min-h-screen)
  "/post-job",     // PostJob (PageHeader + min-h-screen)
  "/job-history",  // JobHistory (PageHeader + min-h-screen)
  "/business",     // BusinessTeam (PageHeader + min-h-screen)
  "/admin",        // Admin dashboard (min-h-screen document-scroll + sidebar)
  "/community",        // Community feed (PageHeader + min-h-screen document-scroll)
  "/pay-it-forward",  // Pay It Forward credit marketplace — long-form document-scroll
  "/subscription", // Subscription tiers — long-form min-h-screen document-scroll
  "/str-settings", // Rental host automation — long-form min-h-screen document-scroll
  "/family",      // Family & care dashboard + accept-invite (min-h-screen document-scroll)

  // Community discovery pages — long-form, document-scroll SEO content
  "/parishes",   // Parish directory listing all 8 supported parishes
  "/parish",     // /parish/:slug — individual parish community pages
  "/wrapped",    // Helpr Wrapped year-in-review
  "/impact",     // Public impact transparency page — long-form, document-scroll
];

// On NATIVE only, the Legal page renders via AppShell (internal scroll) to
// dodge the iOS document-scroll bug where a `position: fixed` header detaches
// during momentum scrolling and lets content ghost into the notch. So on
// native it must be html-locked like every other AppShell page. On web it
// stays long-form document-scroll for SEO.
const NATIVE_APP_SHELL_ROUTES = ["/legal"];

const isDocumentScrollRoute = (pathname: string) => {
  if (
    isNativePlatform &&
    NATIVE_APP_SHELL_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`),
    )
  ) {
    return false;
  }
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
