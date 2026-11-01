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
import { startEntryAuthRefresh } from "./boot/entryAuthRefresh";

// Loaded alone, then called: work chained straight onto import() runs inside Vite's preload wrapper, where a
// failure reads as a broken chunk (dynamicImportThenDoesNoWork).
const declutterPrefetch = () => import("./boot/declutterPrefetch");

// Q1170: a returning web visitor's expired token is refreshed beside the
// download, before the app asks for it (see the module).
startEntryAuthRefresh();

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
// A member's /declutter items and photos, the same way (see the module). Its own small chunk, so the entry every
// other page downloads stays within its budget.
if (hasToken() && /^\/declutter\/?$/.test(window.location.pathname)) {
  void declutterPrefetch()
    .then((m) => m.startDeclutterPrefetch(window.location.pathname))
    .catch(() => {
      /* speculative: the page reads for itself */
    });
}

// Warming the likely next pages after `load` lives in main.tsx: nothing about it
// has to run before the app, so every page's entry need not carry it.
