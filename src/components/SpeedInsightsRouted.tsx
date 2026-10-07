import { useLocation } from "react-router-dom";
import { SpeedInsights } from "@vercel/speed-insights/react";

// Vercel Speed Insights mounted INSIDE BrowserRouter so it can read the
// current location. Without this, the package can't see React Router's
// state and buckets every visit under "Unknown" in the dashboard, which
// makes per-route slicing of LCP/INP/CLS impossible.
//
// We pass `route` as the route *pattern* (e.g. `/user/:userId`) rather
// than the literal pathname so visits to `/user/abc` and `/user/xyz`
// aggregate into one row instead of one-per-userId. Only one dynamic
// segment exists in the route table today — keep this normalizer in sync
// if more are added (see AnimatedRoutes in src/App.tsx). Moved out of
// App.tsx 2026-10-07 (component-size ratchet, Q1028).
export const SpeedInsightsRouted = () => {
  const location = useLocation();
  let route = location.pathname;
  if (route.startsWith("/user/")) route = "/user/:userId";
  return <SpeedInsights route={route} />;
};
