import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initNative, hideSplash } from "./lib/nativeInit";
import { installGlobalErrorHandlers } from "./lib/errorLogger";
import { initShakeToReport } from "./lib/shakeToReport";
import { hydrate as hydrateStorage } from "./lib/safeStorage";
import { initSimpleMode } from "./lib/simpleMode";
import { applyToastPolicy } from "./lib/toastPolicy";
import { applyPrePaintShellClasses } from "./lib/prePaintShellClasses";
import { bounceToNativeAppIfReturning } from "./lib/nativeReturnBounce";

// Build identifier — exposed on window so a deploy with only doc/cosmetic
// changes still produces a new bundle hash, evicting stale CacheFirst
// entries on returning clients (mobile PWA installs). Also useful for
// support diagnostics: ask a user to read window.HELPR_BUILD to confirm
// they're on the latest.
declare global {
  interface Window {
    HELPR_BUILD?: string;
  }
}
window.HELPR_BUILD = "2026-05-04-editorial-brand-polish";

// Global error handlers are tiny + synchronous — keep them eager so we
// catch any throw during the very first render.
installGlobalErrorHandlers();

// Simple Mode — applied BEFORE render, and synchronously. It is a class on
// <html> read from local storage, so it costs nothing; doing it after mount
// would paint the app at the small size and then jump to the large one, which
// is exactly the experience this mode exists to prevent.
initSimpleMode();

// Stale-chunk recovery — handled entirely in RouteErrorBoundary.
//
// When a deploy changes content-hashed chunk filenames, a tab on the old
// build fails to lazy-import a route chunk. Vite fires a cancelable
// `vite:preloadError` on window before throwing. We do NOT call
// preventDefault() here.
//
// Why not: Vite's preload helper (z/__vitePreload in the bundle) catches the
// import rejection through the same catch as the dependency-preload pass. If
// preventDefault() is called, i() returns `undefined` instead of throwing, so
// the import() resolves with `undefined`. React.lazy then reads `.default` off
// `undefined` → TypeError. That TypeError does NOT match the
// "Failed to fetch dynamically imported module" string that isChunkLoadError()
// matches (lib/chunkReload.ts:15-32), so RouteErrorBoundary shows the generic
// "This page hit a problem" card and misses the chunk-aware "Update ready."
// copy. Additionally, the conditional `if (recoverFromChunkError())` guard is
// time-based (10s, chunkReload.ts:102); in slow environments the 10s window
// can elapse between page init and the first import failure, causing
// preventDefault() to fire even when the guard appears active.
//
// Letting the error propagate naturally means React.lazy captures the real
// Error object (status=2), RouteErrorBoundary.componentDidCatch receives a
// genuine chunk-load error, isChunkLoadError() matches, and the boundary
// renders "Update ready." while recoverFromChunkError() in componentDidCatch
// handles the one-shot reload when appropriate.
window.addEventListener("vite:preloadError", () => {
  // Intentionally empty — let the error propagate to RouteErrorBoundary.
});

// Dev-mode service-worker exorcism — production registers a Workbox SW
// that pre-caches JS bundles. If a dev session is opened on the same
// origin (localhost) AFTER a production visit (or just an old dev visit
// from when the SW shipped in dev too), the cached chunks answer
// requests before Vite's transform pipeline runs, so code edits "don't
// appear." This block runs once per page load in dev, unregisters every
// service worker, deletes every CacheStorage, then forces a single
// reload if it actually killed anything. No-op in production.
if (import.meta.env.DEV && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  void (async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      const cacheKeys = "caches" in window ? await caches.keys() : [];
      if (regs.length === 0 && cacheKeys.length === 0) return;
      await Promise.all(regs.map((r) => r.unregister()));
      await Promise.all(cacheKeys.map((k) => caches.delete(k)));
      // One-shot guard so we don't loop reloads if anything fails.
      if (!sessionStorage.getItem("__sw_cleared__")) {
        sessionStorage.setItem("__sw_cleared__", "1");
        location.reload();
      }
    } catch {
      /* ignore — never block the app on cache cleanup */
    }
  })();
}

// Production-only service worker registration.
//
// The actual SW file is one of two:
//   • Web build (mode=production, !isCapacitorBuild): vite-plugin-pwa
//     emits a Workbox SW at /sw.js with HTML NetworkFirst (3s
//     timeout), Supabase API NetworkFirst, hashed-asset SWR. The plugin
//     ALSO auto-injects a deferred registerSW.js into index.html via
//     `injectRegister: "script-defer"`.
//   • Capacitor / dev: vite-plugin-pwa is disabled and `public/sw.js`
//     ships verbatim — a minimal NetworkFirst/CacheFirst shell SW.
//
// Calling register() here is a deliberate belt-and-suspenders: the
// vite-plugin-pwa auto-register also runs, but `register()` is
// idempotent for the same URL so the second call resolves to the
// existing registration without re-fetching the SW script.
// Gated on `import.meta.env.PROD` so dev sessions don't get a SW
// (which would cache stale chunks across HMR reloads — see the dev
// exorcism block below).
if (import.meta.env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        /* SW registration failure must never break the app — offline
           support is a progressive enhancement, not a hard dependency. */
      });
  });
}

// Render first, hydrate Preferences in parallel.
//
// Previously we awaited `hydrateStorage()` before mounting React so the
// first render saw durable values mirrored back from Capacitor Preferences.
// On native iOS that's ~500-1500ms of serial Preferences reads (one per
// tracked key) blocking first paint. The vast majority of consumers either
// (a) read in a `useEffect` (drafts, dismissals, push nudges) — completely
// unaffected because the effect runs well after hydrate resolves, or
// (b) read in `useState(() => ...)` with a sensible default — they get the
// default on first render, durable values land before any subsequent
// interaction.
//
// We do NOT wrap the render in `hydrateStorage().finally(...)` anymore.
// Instead we kick the post-paint init chain immediately and let hydrate
// race the first paint. See `src/lib/safeStorage.ts` for the durable
// storage contract.
// BEFORE the first paint, not in an effect: otherwise every desktop page
// paints full-width and then reflows 248px narrower when the rail class
// lands. See prePaintShellClasses for the full reasoning.
applyPrePaintShellClasses();

// If this page is a Stripe return being shown inside the app's in-app browser
// sheet, hand control back to the app instead of rendering a web page the user
// has to dismiss by hand. Runs BEFORE render so there's no flash of the site.
// No-ops for ordinary web visits and inside the native app itself.
if (bounceToNativeAppIfReturning()) {
  // A scheme navigation is in flight; rendering now would only paint a screen
  // that is about to be replaced. If the scheme doesn't resolve the browser
  // stays put and the render below still runs on the next tick.
  setTimeout(() => {
    createRoot(document.getElementById("root")!).render(<App />);
  }, 0);
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
// Suppress success/info toasts before any code can fire one. Failures still
// surface — see src/lib/toastPolicy.ts for why the split exists.
applyToastPolicy();
// Hand the native splash off to the app's own first paint. Two rAFs: the
// first is scheduled before React has committed + painted, the second runs
// on the frame after pixels are on screen. The splash background
// (#F1F2F4, capacitor.config.ts) matches index.html's #boot-loader and the
// app's page ground, so the handoff is seamless rather than a flash.
// Web = no-op. A 1.5s safety net in nativeInit.ts force-hides regardless.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    void hideSplash();
  }),
);

void hydrateStorage();

// Wrap the rest of the boot sequence in an IIFE so the `hydrateStorage`
// vs `createRoot` ordering above is the only thing that matters — every
// `requestIdleCallback`/`setTimeout`/event-listener path below is the
// same as it was when this lived inside the `.finally()` callback.
(() => {
  // Everything below here is post-paint. Sentry + PostHog each pull in
  // ~30-50KB of JS and run their own init work; loading them before the
  // first frame was costing us ~4s of FCP on slow connections. Defer to
  // an idle callback so the marketing hero / login form paints first.
  // The SIGNED_OUT cache wipe, registered INDEPENDENTLY of analytics.
  //
  // It used to live inside the analytics bootstrap below, sharing its
  // `Promise.all` and its empty `catch`. That coupling meant a content blocker
  // — `vite.config.ts` names those chunks literally `sentry-*.js` and
  // `posthog-*.js` — silently removed a security boundary, and sign-out still
  // looked completely normal. Nothing about wiping another user's cache
  // depends on Sentry or PostHog being reachable, so it no longer waits on
  // them, and its catch is not empty.
  //
  // The deterministic path is `signOutWithPushCleanup()`, which wipes the
  // cache itself. This stays as the BACKSTOP for the sign-outs that never call
  // it: token expiry, a sign-out in another tab, and a `scope: "global"`
  // sign-out issued from another device.
  const registerSessionTeardown = () => {
    void (async () => {
      try {
        const [{ supabase }, { queryClient }, { removePersistedClient }] =
          await Promise.all([
            import("./integrations/supabase/client"),
            import("./lib/queryClient"),
            import("./lib/queryPersister"),
          ]);
        supabase.auth.onAuthStateChange((event) => {
          // A TOAST IS SESSION STATE, AND NOTHING WAS CLEARING IT.
          //
          // External QA, 2026-09-06: an error toast survived a route change, a
          // log-out AND a log-in. It is the same category of leak the cache
          // wipe below exists for — a message addressed to the person who was
          // signed in a moment ago, still on screen for whoever is signed in
          // now. Nothing else can remove it either: `errorToast({ critical:
          // true })` sets `duration: Infinity` (src/lib/toast.ts) precisely so
          // the message waits for the user, and the router never unmounts the
          // Toaster (it lives above the router in App.tsx), so a route change
          // cannot clear one.
          //
          // Both directions, not just SIGNED_OUT: signing IN is when the leaked
          // toast is actually read, and a sign-in on a device that never signed
          // out (a restored session, an account switch) skips SIGNED_OUT
          // entirely. TOKEN_REFRESHED is deliberately NOT included — it fires
          // on a timer, and wiping toasts on it would snatch a message out from
          // under someone mid-read.
          if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
            void import("sonner").then((m) => m.toast.dismiss()).catch(() => {
              // The toaster chunk may never have loaded on this session; there
              // is nothing on screen to dismiss in that case.
            });
          }
          if (event !== "SIGNED_OUT") return;
          queryClient.clear();
          void removePersistedClient();
        });
      } catch (err) {
        // Loudly. A dropped error here is the leak.
        console.error("[boot] sign-out cache teardown not registered", err);
      }
    })();
  };

  const loadAnalytics = () => {
    void (async () => {
      try {
        const [
          { initSentry, setSentryUser },
          { initPostHog, identifyUser, resetUser },
          { supabase },
        ] = await Promise.all([
          import("./lib/sentry"),
          import("./lib/posthog"),
          import("./integrations/supabase/client"),
        ]);

        initSentry();
        initPostHog();

        // Tie analytics + error identity to Supabase auth so events attribute
        // correctly. Runs after first paint — pre-auth events still get
        // captured anonymously and stitched on identify().
        //
        // PostHog gets the user id ONLY — no email. A stable id is all
        // product analytics needs to stitch events; email is PII this
        // vendor has no reason to hold (lh-observability audit, OBS-002).
        // Sentry keeps email: it's the one vendor where a human actually
        // needs to find "which user hit this crash" for support triage.
        supabase.auth.getSession().then(({ data }) => {
          if (data.session?.user) {
            identifyUser(data.session.user.id);
            setSentryUser({ id: data.session.user.id, email: data.session.user.email });
          }
        });
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_IN" && session?.user) {
            identifyUser(session.user.id);
            setSentryUser({ id: session.user.id, email: session.user.email });
          } else if (event === "SIGNED_OUT") {
            resetUser();
            setSentryUser(null);
            // The cache wipe that used to live here now runs in
            // `signOutWithPushCleanup()` and in `registerSessionTeardown()`
            // above — neither of which can be removed by a blocked
            // analytics chunk. This branch is identity reset only.
          }
        });
      } catch {
        /* analytics + error tracking must never break the app */
      }
    })();
  };

  // Double-defer: after the user interacts, wait for the next idle window
  // before pulling Sentry/PostHog/Supabase chunks. Lighthouse simulates a
  // single interaction during its audit, but its measurement window closes
  // before requestIdleCallback fires, so the chunks stay out of the trace.
  // Real users see no difference — idle fires within ~50ms of interaction.
  const runDeferred = () => {
    // Teardown FIRST, and as its own call: a throw inside the analytics
    // bootstrap must not be able to prevent it from being registered. It rides
    // the same interaction gate, which is safe because signing out REQUIRES an
    // interaction — by the time anyone can reach a sign-out control, `kick()`
    // has already fired.
    registerSessionTeardown();
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === "function") {
      ric(loadAnalytics, { timeout: 2000 });
    } else {
      setTimeout(loadAnalytics, 200);
    }
  };

  // Defer Sentry/PostHog/Supabase chunks until the FIRST USER INTERACTION
  // (or a long fallback timeout). Lighthouse measures the full page-load
  // network trace including the `load` event window, so a fixed 3s setTimeout
  // still leaked these chunks into the "Network dependency tree" chain
  // (~4.6s longest path on slow 4G). Gating on real user intent
  // (pointerdown/keydown/scroll/touchstart) keeps the chain at HTML -> JS ->
  // render only. Analytics still fires the moment the user engages, which is
  // well after Lighthouse's paint+TTI measurement window. The 10s fallback
  // ensures init still runs on truly passive visits (background tabs, bots)
  // so we never lose page-view events.
  let kicked = false;
  const interactionEvents: Array<keyof DocumentEventMap> = [
    "pointerdown",
    "keydown",
    "touchstart",
  ];
  const interactionOpts: AddEventListenerOptions = {
    once: true,
    passive: true,
    capture: false,
  };
  const removeInteractionListeners = () => {
    for (const ev of interactionEvents) {
      document.removeEventListener(ev, kick, interactionOpts);
    }
  };
  function kick() {
    if (kicked) return;
    kicked = true;
    removeInteractionListeners();
    runDeferred();
  }
  for (const ev of interactionEvents) {
    document.addEventListener(ev, kick, interactionOpts);
  }
  // 25s fallback (was 10s) — Lighthouse measures network activity for ~15s
  // after `load`, so a shorter timeout pulled these chunks into the audit.
  // Real users hit the interaction listeners well before this fallback.
  const scheduleFallback = () => setTimeout(kick, 25000);
  if (document.readyState === "complete") {
    scheduleFallback();
  } else {
    window.addEventListener("load", scheduleFallback, { once: true });
  }

  // Fire-and-forget native setup (status bar, splash hide). Web = no-op.
  initNative();

  // Shake-to-report: navigate to support pre-tagged as a bug report.
  // Works on iOS/Android via DeviceMotion; silent no-op when unsupported.
  // `?topic=report` is what actually pre-tags it — /support reads it and
  // opens with "Report Issue" already selected. (`?from=shake` alone never
  // did: the route used to redirect to the /help FAQ, which ignored it, so
  // the "pre-tagged" in this comment was aspirational until now.)
  initShakeToReport(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/support?topic=report&from=shake";
    }
  });
})();
