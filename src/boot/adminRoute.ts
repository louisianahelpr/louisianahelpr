/**
 * Starts /admin's gate and page chunks, for routePreload.ts (B90, 2026-11-01).
 *
 * WHY. App.tsx renders `<AdminRoute><Admin /></AdminRoute>`, both lazy, so Admin's
 * own chunk was requested only once AdminRoute's chunk (and its static closure)
 * had arrived and the role check had passed: one extra network round. Lab
 * (HTTP/2, Slow 4G, 4x CPU, 375, mocked admin): Admin.js requested at ~3.0 s,
 * after the gate's batch finished, instead of beside it.
 *
 * Starting Admin's code early only fetches a public static file; AdminRoute
 * still decides whether it renders (the server's role checks guard the data).
 *
 * Its own tiny chunk for the same reason as profileRoute.ts: a dynamic import's
 * preload list lives in the file that holds the import, and Admin's list would
 * otherwise cost every visitor entry bytes. Same rules as routePreload.ts: no
 * static imports. The links it adds carry the mark index.html's boot watchdog
 * skips. App.tsx's lazy import of the same module owns any failure.
 */
const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
for (const load of [() => import("@/components/AdminRoute"), () => import("@/pages/admin/Admin")]) {
  load().catch(() => {
    /* App.tsx's lazy import of the same module owns the failure */
  });
}
for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
  if (!before.has(link)) link.setAttribute("data-lh-page-preload", "");
}

export {};
