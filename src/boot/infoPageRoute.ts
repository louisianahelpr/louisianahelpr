/**
 * Starts a public info page's chunk (Help center, a /hire/<service>/<town> page), for routePreload.ts (Q2705, 11-06).
 *
 * These pages had no ENTRY_ROUTE_CHUNKS row, so their page chunk was asked for only once App.tsx had run and rendered
 * the route: live 11-06 (www, Slow 4G + 4x, 375, guest, 2 runs) /help drew its frame at ~3.1 s and its topic list
 * (the LCP) at 4.9-5.0 s, when the HelpCenter chunk arrived. Here the page starts beside the app on the first round.
 * Lab (dummy-backend dists of main and this change, guest, 375 Slow 4G + 4x, chromium, 3 runs, 0 outside requests):
 * /help LCP 4572 -> 3748 ms, /hire/assembly/abbeville 4504 -> 3512 ms. The app's own frame (the header) draws later
 * (/help 2.80 -> 3.55 s), since the page's bytes now share the link with the app's; the content is what moved up.
 * The policy pages (Legal) are left out: they already drew with the app (2.84 s), and starting them here drew 3.73 s.
 *
 * Its own tiny chunk, like declutterItemRoute.ts: a preload list lives in the file that holds the import, so only a
 * load of one of these pages pays for it, and bootReach.mjs (which does not follow `import()`) reads no new first
 * screen, so no shared module changes chunk. Same rules: no static imports; the links it adds carry the mark
 * index.html's boot watchdog skips; App.tsx's lazy imports of the same modules own any failure.
 */
const path = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
if (path === "/help") {
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
