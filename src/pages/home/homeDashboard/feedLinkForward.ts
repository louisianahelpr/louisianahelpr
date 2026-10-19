/**
 * OLD /home FEED LINKS (Q2205, 2026-10-19). Until the dashboards build, /home
 * WAS the signed-in job feed, and links that open something IN the feed still
 * say /home: notification rows and pushes (`?quickApply=<id>`, the most common
 * link in the product), JobDetail's signed-in hand-off, the post-signup job
 * intent, Stripe's boost return (`?boosted=` / `?boost_cancelled=`), a feed
 * job sheet (`?job=`), a category link (`?cat=`). The feed is Jobs > Browse
 * now, and Home is the dashboard, which reads none of them — so a link that
 * landed there would open Home and silently drop the job it named.
 *
 * One reader-side rule covers every producer, stored or live: a /home URL
 * carrying any of these is forwarded to /jobs with every param kept, pinned
 * to the Browse tab (`tab=browse`) so a `?job=` here is never read as an old
 * My Jobs link (JobsSection.resolveJobsTab).
 * Guard: src/test/homeForwardsFeedLinks.test.ts.
 */
export const FEED_LINK_PARAMS = ["quickApply", "boosted", "boost_cancelled", "job", "cat"] as const;

/** The /jobs URL a /home search string should be forwarded to, or null to stay on Home. */
export function feedLinkTarget(search: string, hash = ""): string | null {
  const p = new URLSearchParams(search);
  if (!FEED_LINK_PARAMS.some((k) => p.has(k))) return null;
  p.set("tab", "browse");
  return `/jobs?${p.toString()}${hash}`;
}
