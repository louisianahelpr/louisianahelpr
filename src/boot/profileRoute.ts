/**
 * Starts /profile's page and every chunk it needs (and /admin's, see accountPageChunksFor), for routePreload.ts.
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
for (const load of accountPageChunksFor(location.pathname, location.search)) load().catch(() => {
  /* App.tsx's (or ProfileTabPanels') lazy import of the same module owns the failure */
});
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

/**
 * What a cold load of `pathname` starts (exported for its test). /profile: the page, and its first tab's panel (B90,
 * 2026-11-01: each panel is its own chunk in ProfileTabPanels, so the URL's tab starts here, beside the page, instead
 * of a round later when Profile has run; lab, Slow 4G x4 CPU: Money and Notifications waited on that extra round).
 *
 * /admin (B90): App.tsx renders `<AdminRoute><Admin /></AdminRoute>`, both lazy, so Admin's chunk was requested only
 * once AdminRoute's chunk and its closure had arrived and run (lab: ~3.0 s). Here both start together. Only a public
 * static file is fetched early; AdminRoute still decides whether it renders, and the server's role checks guard the
 * data. /admin shares this boot chunk instead of its own: a second boot chunk's row cost the entry ~40 B gz, over
 * its 5.0 KB band.
 */
export function accountPageChunksFor(pathname: string, search: string): Array<() => Promise<unknown>> {
  if (pathname.replace(/\/+$/, "") === "/admin") return [() => import("@/components/AdminRoute"), () => import("@/pages/admin/Admin")];
  return [() => import("@/pages/profile/Profile"), ...profileTabChunksFor(search)];
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
