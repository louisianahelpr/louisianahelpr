/**
 * Starts /declutter's page and every chunk it needs, for routePreload.ts.
 *
 * Its own tiny chunk because a dynamic import's preload list lives in the file
 * that holds the import: in the entry, Declutter's list (97 files, 26 of them
 * nobody else names) cost every visitor about 0.6 KB gz of entry on every page.
 * Here only a signed-in /declutter load fetches it, at the price of one network
 * round before the page's chunks start.
 *
 * Same rules as routePreload.ts: no static imports. The links it adds are this
 * page's own, so they carry the mark index.html's boot watchdog skips (the
 * attribute is PAGE_PRELOAD_ATTR there; copied, as an import would be a cycle
 * with the entry). App.tsx's lazy import of the same module owns any failure.
 */
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
import("@/pages/declutter/DeclutterPage").catch(() => {
  /* App.tsx's lazy import of the same module owns the failure */
});
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

export {};
