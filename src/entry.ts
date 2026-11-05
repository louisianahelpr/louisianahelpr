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

// The signed-in prefetch below is loaded alone and starts itself: work chained straight onto import() runs inside
// Vite's preload wrapper, where a failure reads as a broken chunk (dynamicImportThenDoesNoWork).
// Bare, not through loadModule: the entry imports nothing from src/lib (criticalPathBudget: that would drag
// app-shared into it). A prevented preload never runs the module, so nothing starts; the prefetch is speculative.

// Q1170: a returning web visitor's expired token is refreshed beside the
// download, before the app asks for it (see the module).
startEntryAuthRefresh();

// A member's /declutter items and photos, and Home's first-card reads (B78; also on `/`, which sends a member to /home,
// B79), signed-in /jobs' feed (B43) an item page's row, photos and first photo, and /posts' list read (B100), the same way (see the modules). Their own small chunk, so the entry every other page downloads stays within its
// budget.
// Q1158: asked for BEFORE main, and main waits one task for it. Asked for after main's ~100 chunks, this 5 KB chunk
// arrived only at ~3.26 s on Slow 4G (its reads started then, the app drew at ~4.69 s). Vite's preload wrapper makes
// the import() a microtask later while main's links go in at once, so being first in the source alone is not enough
// (measured 11-04: still requested after main). It has no deps of its own, so it adds no link before main's.
if (hasToken() && /^\/(declutter(\/item\/[\w-]+)?|home|jobs|posts)?\/?$/.test(window.location.pathname)) {
  // The module starts its own reads when it loads (no `.then` here: entry bytes, the 5 KB band).
  void import("./boot/signedInPrefetch").catch(() => {
    /* speculative: the page reads for itself */
  });
  setTimeout(startApp);
} else startApp();

// The app. A failed fetch here is a stale HTML page (its chunks deleted by a
// later deploy). The index.html boot watchdog owns that case: every chunk of
// main's graph is requested through a <link rel="modulepreload"> whose
// `error` event it catches, and it reloads once or says so plainly. Leave it
// unhandled so the failure is never swallowed.
function startApp() {
  void import("./main");

  // The page, in the same tick — and AFTER main, so the links it adds are only
  // the page's own chunks (see preloadEntryRoute for why that order matters).
  preloadEntryRoute(window.location.pathname);
  // Q206: the guest /browse job list, beside the app download (see the module).
  startGuestJobsPrefetch(window.location.pathname);
}

// Warming the likely next pages after `load` lives in main.tsx: nothing about it
// has to run before the app, so every page's entry need not carry it.
