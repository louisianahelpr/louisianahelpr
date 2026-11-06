/**
 * Starts a Declutter item page's route chunks, for routePreload.ts (Q2708, 11-05).
 *
 * /declutter/item/:id was in no ENTRY_ROUTE_CHUNKS row (the table is keyed by exact path), so the guest/member gate
 * (DeclutterGuestRoute) and the page (DeclutterItemPage) were asked for only once App.tsx had run and rendered the
 * route. Here they start beside the app on the first round, the way declutterRoute.ts does for /declutter. The item's
 * two reads and first photo already start from the entry (declutterItemPrefetch.ts).
 *
 * Its own tiny chunk for the same reason as declutterRoute.ts: a preload list lives in the file that holds the
 * import, so only an item-page load pays for it. Same rules: no static imports; the links it adds carry the mark
 * index.html's boot watchdog skips; App.tsx's lazy imports of the same modules own any failure.
 */
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
import("@/components/declutter/DeclutterGuestRoute").catch(() => {
  /* App.tsx's lazy import of the same module owns the failure */
});
import("@/pages/declutter/DeclutterItemPage").catch(() => {
  /* App.tsx's lazy import of the same module owns the failure */
});
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

export {};
