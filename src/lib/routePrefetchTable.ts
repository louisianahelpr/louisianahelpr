import { beginSpeculativePrefetch } from "@/lib/chunkReload";
import { JOB_LISTS_PREFETCH_KEY } from "@/lib/routePrefetch";

/**
 * The route prefetch table: each page's dynamic import, keyed by path (routePrefetch.ts loads this on its first
 * warm-up; Builder 2, 11-15). In the build every `import()` here carries that page's preload list, so this table
 * is most of the module's bytes, and it was on every page's boot while App.tsx and the dock imported it directly.
 * src/test/bootSkipsLateHelpers.test.ts keeps it off the first screens.
 *
 * Keep paths in sync with the lazy imports in src/App.tsx. Unknown paths
 * are silent no-ops.
 */
const prefetchers: Record<string, () => Promise<unknown>> = {
  "/home": () => import("@/pages/home/HomeDashboard"),
  "/profile": () => import("@/pages/profile/Profile"),
  "/post-job": () => import("@/pages/post-job/PostJob"),
  "/posts": () => import("@/pages/posts/PostsPage"),
  "/jobs": () => import("@/pages/jobs/JobsSection"),
  "/jobs/": () => import("@/pages/jobs/JobDetail"),
  // B52: the Posted / Working lists, JobsSection's lazy chunk (Browse warms it once settled). Exact key only.
  [JOB_LISTS_PREFETCH_KEY]: () => import("@/components/job-card/JobListPage"),
  "/messages": () => import("@/pages/messages/Messages"),
  // /support is its own public page now (it used to redirect into the
  // Profile tab system, so this key pointed at the Profile chunk — which
  // meant hovering the link warmed a chunk the route never renders).
  "/support": () => import("@/pages/info/Support"),

  
  "/login": () => import("@/pages/auth/Login"),
  "/signup": () => import("@/pages/auth/Signup"),
  "/user": () => import("@/pages/user/UserProfile"),
  "/browse": () => import("@/pages/home/DashboardGuest"),

  // THE FOOTER'S OWN DESTINATIONS. Every other nav surface in the app —
  // Navbar, MobileNav, the desktop rail — prefetches what it links to; the
  // footer was the only one that did not, and these were the only linked
  // routes with no entry in this map at all. So a visitor clicking Terms
  // from the footer paid for the Legal chunk cold, at the moment of the tap
  // (owner, 2026-09-11: "terms rules and privact take awhile to load in the
  // footer").
  //
  // Four keys for one chunk, deliberately. `/terms`, `/rules` and `/privacy`
  // are REAL routes now rather than redirects into `/legal?tab=…`, so each is
  // a path a visitor actually navigates to, and the prefix match below would
  // not resolve any of them from a lone `/legal` key. `warmed` is keyed on the
  // matched key rather than the module, so the first of them to be warmed
  // still costs one fetch and the rest resolve from the module cache.
  "/legal": () => import("@/pages/info/Legal"),
  "/terms": () => import("@/pages/info/Legal"),
  "/rules": () => import("@/pages/info/Legal"),
  "/privacy": () => import("@/pages/info/Legal"),
  "/help": () => import("@/pages/info/HelpCenter"),
};

const warmed = new Set<string>();

export function warmRoute(path: string): void {
  if (!path || warmed.has(path)) return;
  // Match by exact key first, then by prefix (so /user/:id, /admin/* etc still hit the right chunk).
  // Longest key first: "/jobs/<id>" is the job page ("/jobs/"), not the Jobs tab ("/jobs").
  const key = prefetchers[path]
    ? path
    : Object.keys(prefetchers).sort((a, b) => b.length - a.length).find((p) => path.startsWith(p));
  if (!key) return;
  warmed.add(key);
  // Fire-and-forget; swallow errors so a failed prefetch never breaks navigation.
  //
  // The `.catch()` alone did NOT achieve that. It eats the REJECTION, but Vite
  // fires a `vite:preloadError` event on `window` first, and main.tsx's global
  // handler turns that into a full cache-purging recovery reload. So a
  // speculative prefetch cancelled by the user's own navigation — exactly what
  // WebKit does to the old document's in-flight requests — broke the very
  // navigation this comment promised it could not. `beginSpeculativePrefetch`
  // is what makes the promise true: see the block comment on it in
  // lib/chunkReload.ts for the repro and why declining here is safe.
  const settle = beginSpeculativePrefetch();
  prefetchers[key]()
    .catch(() => warmed.delete(key))
    .finally(settle);
}
