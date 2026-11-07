/**
 * Starts the page chunks of the routes routePreload.ts matches by PATTERN, not by exact path (PATH_PAGE_PATH): a
 * Declutter item page, Help center and a /hire/<service>/<town> page. It picks the page from the URL itself.
 *
 * One chunk for all three (Q2705, 11-06): each had its own boot chunk, and each loader plus its ENTRY_ROUTE_CHUNKS row
 * cost the ENTRY chunk bytes on every page; the info pages' row put the entry +69 B gz, over its band (lander l108).
 * Merged, the entry carries one loader and one pattern.
 *
 * - Declutter item (Q2708, 11-05): the guest/member gate (DeclutterGuestRoute) and the page (DeclutterItemPage) were
 *   asked for only once App.tsx had run and rendered the route. The item's two reads and first photo already start
 *   from the entry (declutterItemPrefetch.ts).
 * - Help center and the hire town pages (Q2705, 11-06): live (www, Slow 4G + 4x, 375, guest, 2 runs) /help drew its
 *   frame at ~3.1 s and its topic list (the LCP) at 4.9-5.0 s, when the HelpCenter chunk arrived. Lab (dummy-backend
 *   dists, guest, 375 Slow 4G + 4x, chromium, 3 runs, 0 outside requests): /help LCP 4572 -> 3748 ms,
 *   /hire/assembly/abbeville 4504 -> 3512 ms. The app's own frame (the header) draws later (/help 2.80 -> 3.55 s),
 *   since the page's bytes now share the link with the app's; the content is what moved up. The policy pages (Legal)
 *   are left out: they already drew with the app (2.84 s), and starting them here drew 3.73 s.
 *
 * Its own tiny chunk, like declutterRoute.ts: a preload list lives in the file that holds the import, so only a load
 * of one of these pages pays for it, and bootReach.mjs (which does not follow `import()`) reads no new first screen.
 * Rules: no static imports; the links it adds carry the mark index.html's boot watchdog skips; App.tsx's lazy imports
 * of the same modules own any failure.
 */
const path = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
if (path.startsWith("/declutter/item/")) {
  import("@/components/declutter/DeclutterGuestRoute").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
  import("@/pages/declutter/DeclutterItemPage").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
} else if (path === "/help") {
  import("@/pages/info/HelpCenter").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
} else if (path.startsWith("/hire/")) {
  import("@/pages/info/HireTownPage").catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
}
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

export {};
