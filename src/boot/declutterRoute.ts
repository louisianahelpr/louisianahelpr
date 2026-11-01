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
// B77 (2026-11-01): each tab's code is its own chunk (DeclutterHomeView's lazy tabs), so the URL's tab starts here,
// beside the page, instead of a round later when the page has run. Same reading of the URL as DeclutterHomeView
// (?tab=, then the old ?view= links); Deliver loads its own screen. DeclutterHomeView's lazy import owns any failure.
const tabChunk = declutterTabChunkFor(location.search);
if (tabChunk) tabChunk().catch(() => {
  /* DeclutterHomeView's lazy import of the same module owns the failure */
});
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

/** The chunk a /declutter URL's first tab draws with (exported for its test). */
export function declutterTabChunkFor(search: string): (() => Promise<unknown>) | null {
  const p = new URLSearchParams(search);
  const tab = p.get("tab");
  const view = p.get("view");
  if (view === "deliver") return null;
  if (view === "wanted" || tab === "wanted") return () => import("@/components/declutter/DeclutterWantedViews");
  if (tab === "free") return () => import("@/components/declutter/DeclutterFreeView");
  if (tab === "deliver") return null;
  if (tab === "buying" || tab === "selling" || ["buying", "selling", "mine", "offers", "cart"].includes(view ?? "")) {
    return () => import("@/components/declutter/DeclutterMineViews");
  }
  return () => import("@/components/declutter/DeclutterBrowseView");
}
