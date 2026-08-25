import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { setStatusBarStyle } from "@/lib/nativeInit";

/**
 * Status-bar content style per route.
 *
 * iOS / Android display the OS status bar (clock, battery, signal) above
 * the web view. Its glyphs come in two contrast modes:
 *
 *   * "dark"  → dark glyphs on a LIGHT background (the OS calls this
 *               "default" / "light content style"). Use on parchment /
 *               cream / cream-on-white pages.
 *   * "light" → light glyphs on a DARK background. Use on dark hero
 *               sections, dark photo backdrops, brand-color full-bleed
 *               pages.
 *
 * The current design is overwhelmingly light surfaces (premium-page
 * parchment), so the platform default is `"dark"` content. Routes that
 * render a dark full-bleed hero opt-in via the explicit map below.
 *
 * The mapping is a longest-prefix table because a route like
 * `/legal?tab=privacy` is still legal (light), and `/user/:userId` is
 * still UserProfile (light hero card, light page background). If you
 * add a route with a dark hero, add it here — do NOT call
 * `setStatusBarStyle` from inside the page component (that would
 * scatter the source of truth and let one page forget to reset on
 * unmount).
 *
 * Web is a no-op (browsers don't expose status-bar styling); the
 * underlying `setStatusBarStyle` helper already guards on
 * `isNativePlatform`.
 */
type StatusBarContent = "dark" | "light";

const ROUTE_OVERRIDES: Array<{ prefix: string; content: StatusBarContent }> = [
  // No dark-hero routes today — every current page renders on a light
  // parchment background. Add entries here when a dark hero ships, e.g.:
  //   { prefix: "/onboarding/tour", content: "light" },
  //   { prefix: "/admin",           content: "light" },  // dark sidebar shell
];

const DEFAULT_CONTENT: StatusBarContent = "dark";

const resolveContent = (pathname: string): StatusBarContent => {
  // Longest-prefix match so a more specific route can override a parent.
  let best: { length: number; content: StatusBarContent } | null = null;
  for (const { prefix, content } of ROUTE_OVERRIDES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best.length) {
        best = { length: prefix.length, content };
      }
    }
  }
  return best?.content ?? DEFAULT_CONTENT;
};

/**
 * Apply the correct iOS / Android status-bar content style for the
 * current route. Call once at the app root (alongside the other
 * `SessionManager`-style hooks in App.tsx). Re-fires on every route
 * change.
 */
export const useStatusBarStyle = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const content = resolveContent(pathname);
    // Fire-and-forget. The underlying helper swallows errors so a
    // single failed call never crashes the navigation.
    void setStatusBarStyle(content);
  }, [pathname]);
};
