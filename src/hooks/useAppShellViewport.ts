import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isNativePlatform } from "@/lib/nativeInit";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { useAuthReady } from "@/hooks/useAuthReady";

/**
 * Routes that use document-scroll (long-form content, SEO landing pages).
 * Everything else gets the fixed app-shell viewport lock applied to <html>.
 */
const DOCUMENT_SCROLL_ROUTES = [
  "/",

  "/legal",
  "/terms",
  "/privacy",
  "/rules",

  "/jobs", // public marketing /jobs (uses Navbar + long page)
  "/support",

  // Accessibility settings. Its own file comment already declares it a
  // document-scroll page ("plain min-h-screen wrapper, no AppShell"), but it
  // was never added here — so the `html.app-shell { overflow: hidden }` lock
  // described below applied to it and clipped everything past the fold. On
  // the accessibility screen, of all of them.
  // Same omission, found by the same sweep: a min-h-screen settings page with
  // no AppShell and no entry here.
  "/auto-tip",

  // Auth + onboarding flow — any AuthShell-based page that may exceed
  // the viewport height on small devices (iPhone SE) or in landscape
  // belongs here. AuthShell uses `min-h-screen` document scroll; if the
  // route is NOT in this list, `html.app-shell { overflow: hidden }`
  // clips anything below the fold and the user can't reach it. Login is
  // ON this list too: on a short desktop/landscape viewport its card
  // exceeds the fold, and off the list the overflow:hidden lock stranded
  // the form with no way to scroll.
  "/login",
  "/signup",
  "/signup-pending",
  "/complete-profile",
  // /account-pending renders via AuthShell (`min-h-screen` document scroll),
  // unified with the other three account-state screens. Its verification
  // center (hero + progress + 4-step checklist + banner + actions) can
  // exceed the viewport on small devices, so it must be ON this list — off
  // it, `html.app-shell { overflow: hidden }` would clip the actions below
  // the fold and strand the user.
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
  "/user",         // /user/:userId — UserProfile (PageHeader + min-h-screen)
  "/post-job",     // PostJob (PageHeader + min-h-screen)
  "/admin",        // Admin dashboard (min-h-screen document-scroll + sidebar)
  "/gift-card",       // Gift Card — long-form document-scroll
  "/subscription", // Subscription tiers — long-form min-h-screen document-scroll
  "/str-settings", // Rental host automation — long-form min-h-screen document-scroll
  "/family",      // Family & care dashboard + accept-invite (min-h-screen document-scroll)
  "/pets",        // My Pets — split-column desktop, document-scroll wrapper
  "/home-history", // HomeHistory (PageHeader + min-h-screen document-scroll)
  "/work-record",  // WorkRecord (PageHeader + min-h-screen document-scroll)

  // Community discovery pages — long-form, document-scroll SEO content
  "/wrapped",    // Helpr Wrapped year-in-review
  "/benefits",    // Benefits marketplace — partner perks (document-scroll)

  // Public vertical landing pages (PageHeader + min-h-screen document-scroll)

  // Public marketing / informational pages (document-scroll)
  "/help",         // Help Center — static FAQ / support page
];

// On NATIVE only, the Legal page renders via AppShell (internal scroll) to
// dodge the iOS document-scroll bug where a `position: fixed` header detaches
// during momentum scrolling and lets content ghost into the notch. So on
// native it must be html-locked like every other AppShell page. On web it
// stays long-form document-scroll for SEO.
const NATIVE_APP_SHELL_ROUTES = ["/legal"];

/**
 * The pathname currently rendering the `path="*"` catch-all (NotFound), or
 * null. Reported by NotFound itself via `setNotFoundPathname`.
 *
 * Why this can't be a list entry: DOCUMENT_SCROLL_ROUTES is matched against
 * the pathname, and the 404's "path" is every string that is NOT a declared
 * route — unknowable from the pathname alone without duplicating the whole
 * router table here (which would then drift silently, the failure mode
 * auditCatalogRoutes.test.ts exists to catch). The page is the only thing that
 * knows it is the 404, so the page says so.
 *
 * It matters because since 2026-08-24 (audit V12) NotFound renders inside
 * PublicLayout — marketing Navbar + Footer — which is far taller than a
 * viewport. Left under `html.app-shell { overflow: hidden }`, the footer and
 * usually the "Back to Home" button sit below the fold with no way to scroll
 * to them: a dead end on the page whose entire job is to be an exit.
 */
let notFoundPathname: string | null = null;
/** Re-runs the class-toggling effect below. Set while the hook is mounted. */
let reapplyShellClasses: (() => void) | null = null;

export const setNotFoundPathname = (pathname: string | null) => {
  if (notFoundPathname === pathname) return;
  notFoundPathname = pathname;
  // Push, don't wait to be polled: the hook lives in a SIBLING component of
  // <Routes> (App.tsx's SessionManager), so relying on React's effect ordering
  // between the two would make correctness depend on their JSX order. This
  // re-applies the classes immediately, whichever effect ran first.
  reapplyShellClasses?.();
};

export const isDocumentScrollRoute = (pathname: string) => {
  // The 404 catch-all is document-scroll — see setNotFoundPathname above.
  if (notFoundPathname === pathname) return true;
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
 * Minimum viewport width (px) at which the desktop-web multi-column layout
 * kicks in. Matches Tailwind's `lg` breakpoint so `lg:` utilities and this
 * gate stay in lockstep.
 */
/* 900, not 1024. The desktop website — left rail, wide layout — used to begin
   at 1024, which meant a docked browser pane (commonly 600-1020px) never
   qualified and always got the phone/tablet treatment. Lowered so a normal
   split-screen window gets the real desktop site.

   MUST stay in sync with `lg` in tailwind.config.ts and with the twin copy of
   this query in the other hook. If the JS gate and the `lg:` utilities
   disagree, the shell paints desktop chrome while the components inside it
   are still laying out for mobile. */
export const WEB_DESKTOP_QUERY = "(min-width: 900px)";

/**
 * Toggles the `app-shell` class on <html> based on the current route.
 * When present, the html/body/#root are locked to 100dvh with overflow:hidden,
 * forcing pages to use AppShell's internal scroll container.
 *
 * ALSO toggles a `web-desktop` class on <html> when the app is running in a
 * wide *browser* viewport (NOT the native iOS/Android shell). This is the
 * single gate the desktop multi-column website layout hangs off of:
 *
 *   web-desktop  ⟺  !isNativePlatform  &&  matchMedia('(min-width: 900px)')
 *
 * `isNativePlatform` is a module constant resolved from
 * `Capacitor.isNativePlatform()` at boot, so in the packaged iOS/Android app
 * it is `true` and `web-desktop` can NEVER be set — the native UI is byte-for-
 * byte identical to today. On a phone-width browser the media query is false,
 * so mobile-web is also unchanged. Only a wide browser viewport gets the new
 * desktop chrome + columns. The listener tracks live viewport resizes so the
 * class flips when a desktop browser window is narrowed past the breakpoint.
 */
export const useAppShellViewport = () => {
  const { pathname } = useLocation();
  const { user } = useAuthReady();

  useEffect(() => {
    const apply = () => {
      const html = document.documentElement;
      if (isDocumentScrollRoute(pathname)) {
        html.classList.remove("app-shell");
      } else {
        html.classList.add("app-shell");
      }
      // Mirror the DesktopSidebarNav's own visibility gate onto <html> so the
      // CSS that insets pages from the fixed left rail turns on/off with the
      // rail itself. The gate MUST include `!!user`, exactly like the rail's
      // render gate (DesktopSidebarNav) and the marketing Navbar's step-aside
      // gate — otherwise a guest-reachable rail route (e.g. /browse, which
      // bounces authed users away, so its visitor is ALWAYS logged out) insets
      // the shell 248px for a rail that never renders, leaving a dead gutter.
      // app-shell pages inset via .app-shell-frame; document-scroll pages via
      // the #root rule — both keyed off this class, so both stay in lockstep.
      html.classList.toggle("desktop-rail", isDesktopRailRoute(pathname) && !!user);
    };
    apply();
    // Published so NotFound's `setNotFoundPathname` can re-apply the moment it
    // reports itself, regardless of which component's effect ran first.
    reapplyShellClasses = apply;
    return () => {
      // Don't strip the classes on unmount — the next route effect will set
      // them correctly. Only the re-apply hook is released.
      if (reapplyShellClasses === apply) reapplyShellClasses = null;
    };
  }, [pathname, user]);

  // Web-desktop detection. Independent of route (the chrome/layout applies on
  // every signed-in fixed-shell page), so it lives in its own effect that runs
  // once and self-updates via the matchMedia change event.
  useEffect(() => {
    const html = document.documentElement;

    // Hard gate: native app is NEVER web-desktop. Bail before touching the
    // class so a native build can't accidentally flip it via any code path.
    if (isNativePlatform || typeof window.matchMedia !== "function") {
      html.classList.remove("web-desktop");
      return;
    }

    const mql = window.matchMedia(WEB_DESKTOP_QUERY);
    const apply = (matches: boolean) => {
      html.classList.toggle("web-desktop", matches);
    };
    apply(mql.matches);

    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    // addEventListener is the modern API; older Safari needs addListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);
};
