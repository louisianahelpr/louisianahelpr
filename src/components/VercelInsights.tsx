import { Analytics, type BeforeSend } from "@vercel/analytics/react";
import { redactInviteToken } from "@/lib/redactInviteToken";
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
      <Analytics beforeSend={redactVercelEvent} />
    </>
  );
}

/**
 * Holiday audit D M5 (11-20): a page view's url never carries a Secret Santa reveal token or a Rentals invite token
 * to Vercel, as PostHog, Sentry, error_logs and analytics_events already redact them. Exported for its test.
 */
export const redactVercelEvent: BeforeSend = (event) => ({ ...event, url: redactInviteToken(event.url) });
