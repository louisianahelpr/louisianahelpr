/**
 * Start the current route's page chunk on the FIRST network round (Q178).
 *
 * WHY THIS EXISTS. Measured 2026-09-23 (production build, 375, 1.6 Mbps /
 * 150 ms RTT, 4x CPU): the landing's own chunk (Index) was requested LAST, at
 * ~3.9 s, 20 JS request rounds deep. The browser cannot request a lazy route
 * chunk until App.tsx has RUN, and App.tsx cannot run until its whole static
 * import graph (50 chunks, ~356 KB gzip) has downloaded level by level. A
 * preload placed at App.tsx module scope therefore cannot help — it was tried
 * and measured (4492 -> 4502 ms) — because it runs after that same graph.
 *
 * So the ENTRY (src/entry.ts) is now tiny and calls this before it imports the
 * app: the route's chunk and the app's graph are requested side by side, and
 * vite.config.ts `modulePreload.resolveDependencies` hands each dynamic import
 * its full static closure, so neither walks its graph one level per round.
 *
 * RULES FOR THIS FILE. It is part of the entry chunk, so it must stay tiny:
 * import NOTHING from src/lib, src/hooks, src/utils, src/contexts,
 * src/integrations, src/config or src/constants — vite.config.ts's
 * `app-shared` group captures any module there that two chunks share, and one
 * static import of it would drag that whole 137 KB chunk (and Supabase behind
 * it) back into the entry. scripts/perf/critical-path.mjs fails if the entry
 * grows. Only dynamic `import()`s of page chunks belong here.
 *
 * The specifiers must be the SAME ones App.tsx lazy-loads, so both resolve to
 * one module instance: when App renders `<Index />`, its lazy factory finds
 * the chunk already fetched (or in flight) instead of starting it.
 */

/**
 * Same probe as `hasPersistedAuthToken()` in src/lib/persistedAuthToken.ts,
 * copied rather than imported because of the rule above. A signed-in visitor
 * on `/` or `/browse` is redirected to /dashboard by MarketingRedirect, so
 * preloading the guest page for them would spend their bandwidth on a page
 * they will not see.
 */
export const hasToken = (): boolean => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) return true;
    }
  } catch {
    /* storage blocked: treat as signed out, as the original does */
  }
  return false;
};

// No PageTransition here: App.tsx's PageTransition wrapper no longer suspends
// the page behind framer-motion on a cold load (Q178), so the page chunk is all
// a public route needs.
const protectedRoute = () => import("@/components/ProtectedRoute");

/** Path -> the chunks that route cannot paint without. Exported for tests. */
export const ENTRY_ROUTE_CHUNKS: Record<string, { guest: Array<() => Promise<unknown>>; signedIn: Array<() => Promise<unknown>> }> = {
  "/": {
    guest: [() => import("@/pages/info/Index")],
    signedIn: [() => import("@/pages/home/Dashboard"), protectedRoute],
  },
  "/browse": {
    guest: [() => import("@/pages/home/DashboardGuest")],
    signedIn: [() => import("@/pages/home/Dashboard"), protectedRoute],
  },
  "/login": {
    guest: [() => import("@/pages/auth/Login")],
    signedIn: [() => import("@/pages/auth/Login")],
  },
  "/signup": {
    guest: [() => import("@/pages/auth/Signup")],
    signedIn: [() => import("@/pages/auth/Signup")],
  },
  "/dashboard": {
    guest: [protectedRoute],
    signedIn: [() => import("@/pages/home/Dashboard"), protectedRoute],
  },
  "/messages": {
    guest: [protectedRoute],
    signedIn: [() => import("@/pages/messages/Messages"), protectedRoute],
  },
  "/my-jobs": {
    guest: [protectedRoute],
    signedIn: [() => import("@/pages/jobs/JobsPage"), protectedRoute],
  },
  "/my-posts": {
    guest: [protectedRoute],
    signedIn: [() => import("@/pages/posts/PostsPage"), protectedRoute],
  },
  "/post-job": {
    guest: [protectedRoute],
    signedIn: [() => import("@/pages/post-job/PostJob"), protectedRoute],
  },
  "/profile": {
    guest: [protectedRoute],
    signedIn: [() => import("@/pages/profile/Profile"), protectedRoute],
  },
};

/** Set on every <link rel="modulepreload"> the page preload adds; index.html's watchdog skips them. */
const PAGE_PRELOAD_ATTR = "data-lh-page-preload";

/**
 * Kick off the chunks for `pathname`. Fire-and-forget: a failure here is not
 * handled here — App.tsx's own lazy import of the same module owns the error
 * UI (RouteErrorBoundary / chunkReload), exactly as before.
 *
 * MUST run AFTER the entry has started main.tsx. Vite's preload helper adds
 * one <link rel="modulepreload"> per chunk, synchronously, and never twice for
 * the same file; the links added here are then only this page's OWN chunks
 * (the app's are already in the head), and each is marked PAGE_PRELOAD_ATTR.
 * index.html's boot watchdog reads a failed /assets/*.js <link> before first
 * paint as a stale HTML page (hard reload, then "Helpr couldn't load"); a
 * stale PAGE chunk is not that, so the watchdog skips marked links and the
 * in-app route recovery keeps the case it always had
 * (e2e/happy-path/stale-deploy.spec.ts, "cold load with route chunk aborted").
 */
export function preloadEntryRoute(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const entry = ENTRY_ROUTE_CHUNKS[path];
  if (!entry) return;
  const before = new Set(document.querySelectorAll('link[rel="modulepreload"]'));
  for (const load of hasToken() ? entry.signedIn : entry.guest) {
    load().catch(() => {
      /* App.tsx's lazy import of the same module owns the failure */
    });
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    if (!before.has(link)) link.setAttribute(PAGE_PRELOAD_ATTR, "");
  }
}
