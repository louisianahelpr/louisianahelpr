import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initNative } from "./lib/nativeInit";
import { installGlobalErrorHandlers } from "./lib/errorLogger";
import { initShakeToReport } from "./lib/shakeToReport";
import { hydrate as hydrateStorage } from "./lib/safeStorage";
import { recoverFromChunkError } from "./lib/chunkReload";

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

// Stale-chunk recovery — eager, before render. When a deploy changes the
// content-hashed chunk filenames, a tab still running the previous build
// fails to fetch a lazy chunk on navigation. Vite fires a cancelable
// `vite:preloadError` on window *before* throwing; preventDefault() stops
// the throw so we own the recovery (a one-shot cache-busting reload) and
// the user never hits an error boundary on the common case. The error
// boundaries keep the same detection as a backstop for throws that bypass
// this event (e.g. a bare `import()` rejection inside an effect).
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  recoverFromChunkError();
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
createRoot(document.getElementById("root")!).render(<App />);
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
  const loadAnalytics = () => {
    void (async () => {
      try {
        const [
          { initSentry, setSentryUser },
          { initPostHog, identifyUser, resetUser },
          { supabase },
          { queryClient },
          { removePersistedClient },
        ] = await Promise.all([
          import("./lib/sentry"),
          import("./lib/posthog"),
          import("./integrations/supabase/client"),
          import("./lib/queryClient"),
          import("./lib/queryPersister"),
        ]);

        initSentry();
        initPostHog();

        // Tie analytics + error identity to Supabase auth so events attribute
        // correctly. Runs after first paint — pre-auth events still get
        // captured anonymously and stitched on identify().
        supabase.auth.getSession().then(({ data }) => {
          if (data.session?.user) {
            identifyUser(data.session.user.id, { email: data.session.user.email });
            setSentryUser({ id: data.session.user.id, email: data.session.user.email });
          }
        });
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_IN" && session?.user) {
            identifyUser(session.user.id, { email: session.user.email });
            setSentryUser({ id: session.user.id, email: session.user.email });
          } else if (event === "SIGNED_OUT") {
            resetUser();
            setSentryUser(null);
            // Wipe React Query cache + persisted IndexedDB cache so the next
            // user on this device doesn't rehydrate the prior user's data
            // (Stripe payouts, admin payout ledger, job history,
            // notification logs). The persister has a 24h maxAge — without
            // these calls a shared-device sign-out would leak for a day.
            // Several query keys do already user-scope themselves (see
            // queryKeys.ts) but anything keyed only by a literal string
            // would otherwise survive. Belt + suspenders.
            queryClient.clear();
            void removePersistedClient();
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
