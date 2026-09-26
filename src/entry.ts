/**
 * The module index.html loads. Deliberately almost empty (Q178).
 *
 * Until 2026-09-23 index.html loaded src/main.tsx directly. A module runs only
 * after its whole static import graph has downloaded, so nothing in main.tsx
 * or App.tsx could ask for the current route's page chunk before ~3 s on a
 * slow phone (measured: the landing's own chunk was the LAST request, at
 * 3.9 s). This entry has no static imports of the app at all: it starts the
 * route's chunks (src/boot/routePreload.ts) and the app (src/main.tsx) in the
 * same tick, and vite.config.ts preloads each one's static closure in
 * parallel, so both download together from the first round.
 *
 * main.tsx is unchanged and still does everything it did, in the same order.
 * scripts/perf/critical-path.mjs (and its vitest guard) fails if this file's
 * chunk grows or the route chunk slips out of the first round.
 */
// The stylesheet is imported HERE (main.tsx imports it too; it is one module)
// so it stays the entry's CSS and index.html keeps requesting it on the first
// round, instead of waiting for this module to load and ask for main.
import "./index.css";
import { hasToken, preloadEntryRoute } from "./boot/routePreload";
import { startGuestJobsPrefetch } from "./boot/guestJobsPrefetch";

// The app. A failed fetch here is a stale HTML page (its chunks deleted by a
// later deploy). The index.html boot watchdog owns that case: every chunk of
// main's graph is requested through a <link rel="modulepreload"> whose
// `error` event it catches, and it reloads once or says so plainly. Leave it
// unhandled so the failure is never swallowed.
void import("./main");

// The page, in the same tick — and AFTER main, so the links it adds are only
// the page's own chunks (see preloadEntryRoute for why that order matters).
preloadEntryRoute(window.location.pathname);
// Q206: the guest /browse job list, beside the app download (see the module).
startGuestJobsPrefetch(window.location.pathname);

// Then, once THIS page has loaded, warm the pages a visitor most likely opens
// next (guest: browse / login / signup; signed in: the dock tabs + post-job),
// so the first tap to them is instant. Skipped on Save-Data / 2G inside
// prefetchRoutesWhenIdle. Loaded dynamically: routePrefetch lives in the app's
// shared chunk, which is already in memory by the time `load` fires.
window.addEventListener(
  "load",
  () => {
    void import("@/lib/routePrefetch")
      .then(({ prefetchLikelyNextRoutes }) => prefetchLikelyNextRoutes(hasToken(), window.location.pathname))
      .catch(() => {
        /* speculative: the real navigation loads its own chunk */
      });
  },
  { once: true },
);
