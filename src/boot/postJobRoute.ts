/**
 * Starts /post-job's page and every chunk it needs, for routePreload.ts.
 *
 * Its own tiny chunk because a dynamic import's preload list lives in the file
 * that holds the import: in the entry, PostJob's list (79 files, 23 of them
 * nobody else in the entry names) cost every visitor entry bytes on every page,
 * and put the entry over its 5.0 KB gz band (main 2026-11-04, 5.38 KB, PR #4115).
 * Here only a signed-in cold /post-job load fetches it, at the price of one
 * network round before the page's chunks start (the same trade as
 * profileRoute.ts and declutterRoute.ts).
 *
 * Same rules as routePreload.ts: no static imports. The links it adds are this
 * page's own, so they carry the mark index.html's boot watchdog skips (the
 * attribute is PAGE_PRELOAD_ATTR there; copied, as an import would be a cycle
 * with the entry). App.tsx's lazy import of the same module owns any failure.
 */
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
import("@/pages/post-job/PostJob").catch(() => {
  /* App.tsx's lazy import of the same module owns the failure */
});
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

export {};
