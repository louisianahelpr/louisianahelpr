import { useLocation } from "react-router-dom";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { redactInviteToken } from "@/lib/redactInviteToken";

/**
 * The route PATTERN Speed Insights groups a visit under, so `/user/abc` and `/user/xyz` aggregate into one row, and a
 * secret in the path (a Secret Santa reveal token, a Rentals invite token, a shared wish list's code) never reaches
 * Vercel as a route (holiday audit D M5, 11-20). Keep in sync with AnimatedRoutes in src/App.tsx. Exported for its test.
 */
export function speedInsightsRoute(pathname: string): string {
  if (pathname.startsWith("/user/")) return "/user/:userId";
  if (pathname.startsWith("/gift-guides/secret-santa/")) return "/gift-guides/secret-santa/:code/:token";
  if (pathname.startsWith("/gift-guides/list/")) return "/gift-guides/list/:code";
  if (pathname.startsWith("/rentals/invite/")) return "/rentals/invite/:token";
  return pathname;
}

// Vercel Speed Insights mounted INSIDE BrowserRouter so it can read the
// current location. Without this, the package can't see React Router's
// state and buckets every visit under "Unknown" in the dashboard, which
// makes per-route slicing of LCP/INP/CLS impossible. Moved out of
// App.tsx 2026-10-07 (component-size ratchet, Q1028). Each vital's `url`
// goes through redactInviteToken too, as PostHog's and Sentry's do.
export const SpeedInsightsRouted = () => {
  const location = useLocation();
  return <SpeedInsights route={speedInsightsRoute(location.pathname)} beforeSend={(e) => ({ ...e, url: redactInviteToken(e.url) })} />;
};
