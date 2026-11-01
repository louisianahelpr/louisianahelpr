/**
 * Starts /profile's page and every chunk it needs, for routePreload.ts.
 *
 * Its own tiny chunk because a dynamic import's preload list lives in the file
 * that holds the import: in the entry, Profile's list (12 files) costs every
 * visitor entry bytes on every page load. Here only a signed-in /profile load
 * fetches it, at the price of one network round before the page's chunks start.
 *
 * Same rules as routePreload.ts: no static imports. The links it adds are this
 * page's own, so they carry the mark index.html's boot watchdog skips (the
 * attribute is PAGE_PRELOAD_ATTR there; copied, as an import would be a cycle
 * with the entry). App.tsx's lazy import of the same module owns any failure.
 */
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
import("@/pages/profile/Profile").catch(() => {
  /* App.tsx's lazy import of the same module owns the failure */
});
// B90 (2026-11-01): a tab's panel is its own chunk (ProfileTabPanels' lazy panels), so the URL's tab starts here,
// beside the page, instead of a round later when Profile has run. Lab, Slow 4G x4 CPU: Money and Notifications
// waited on that extra round. ProfileTabPanels' lazy import of the same module owns any failure.
for (const load of profileTabChunksFor(location.search)) load().catch(() => {
  /* ProfileTabPanels' lazy import of the same module owns the failure */
});
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

/** The chunks a /profile URL's first tab draws with (exported for its test). Same specifiers as ProfileTabPanels. */
export function profileTabChunksFor(search: string): Array<() => Promise<unknown>> {
  const tab = new URLSearchParams(search).get("tab");
  // PaymentTab: EarningsTab's lazy bank-connect card, drawn on the first screen until a payout account exists.
  if (tab === "earnings") return [() => import("@/components/profile/EarningsTab"), () => import("@/components/PaymentTab")];
  if (tab === "notifications") {
    return [() => import("@/components/NotificationPreferences"), () => import("@/components/notificationPreferences/SmsAlertsCard")];
  }
  return [];
}
