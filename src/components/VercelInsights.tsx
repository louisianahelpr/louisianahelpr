import { Analytics } from "@vercel/analytics/react";
import { SpeedInsightsRouted } from "@/components/SpeedInsightsRouted";

/**
 * Vercel Web Analytics and Speed Insights, in their own lazy chunk (Q2705, Builder 4, 2026-11-09).
 *
 * Both only inject Vercel's own script tag (/_vercel/insights/script.js, /_vercel/speed-insights/script.js), which
 * loads async anyway, so nothing on screen waits for them. In main.tsx's static graph they were ~2 KB gz of every
 * page's boot download. App.tsx mounts this with React.lazy inside the router (SpeedInsightsRouted reads the route).
 * Speed Insights' web-vitals reads LCP, FCP and CLS from buffered performance entries, so a script injected one chunk
 * later still sees the first paint. Guard: scripts/check-deferred-vendors.mjs (DEFERRED_PACKAGES).
 */
export default function VercelInsights() {
  return (
    <>
      <SpeedInsightsRouted />
      <Analytics />
    </>
  );
}
