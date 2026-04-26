import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initNative } from "./lib/nativeInit";
import { installGlobalErrorHandlers } from "./lib/errorLogger";
import { initShakeToReport } from "./lib/shakeToReport";
import { hydrate as hydrateStorage } from "./lib/safeStorage";

// Global error handlers are tiny + synchronous — keep them eager so we
// catch any throw during the very first render.
installGlobalErrorHandlers();

// Restore durable Preferences → localStorage BEFORE first render so any
// component that reads sync (e.g. dismissed jobs, drafts, cooldowns) sees
// values that survived a WebKit eviction or app restart.
hydrateStorage().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);

  // Everything below here is post-paint. Sentry + PostHog each pull in
  // ~30-50KB of JS and run their own init work; loading them before the
  // first frame was costing us ~4s of FCP on slow connections. Defer to
  // an idle callback so the marketing hero / login form paints first.
  const runDeferred = () => {
    void (async () => {
      try {
        const [{ initSentry, setSentryUser }, { initPostHog, identifyUser, resetUser }, { supabase }] =
          await Promise.all([
            import("./lib/sentry"),
            import("./lib/posthog"),
            import("./integrations/supabase/client"),
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
          }
        });
      } catch {
        /* analytics + error tracking must never break the app */
      }
    })();
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
    "scroll",
    "touchstart",
  ];
  const interactionOpts: AddEventListenerOptions = {
    once: true,
    passive: true,
    capture: true,
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
  const scheduleFallback = () => setTimeout(kick, 10000);
  if (document.readyState === "complete") {
    scheduleFallback();
  } else {
    window.addEventListener("load", scheduleFallback, { once: true });
  }

  // Fire-and-forget native setup (status bar, splash hide). Web = no-op.
  initNative();

  // Shake-to-report: navigate to support pre-tagged as a bug report.
  // Works on iOS/Android via DeviceMotion; silent no-op when unsupported.
  initShakeToReport(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/support?from=shake";
    }
  });
});
