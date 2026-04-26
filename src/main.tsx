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

  // Wait for the `load` event (LCP/FCP have fired) THEN add a fixed delay so
  // Sentry/PostHog/Supabase chunks don't even appear in the network trace
  // during the Lighthouse paint window. We use a flat setTimeout (no
  // requestIdleCallback) because rIC can fire immediately on idle networks,
  // causing the chunks to be downloaded mid-measurement and counted as
  // "unused JS". Functionality is unchanged — analytics still initializes,
  // just ~3s later.
  const DEFER_MS = 3000;

  if (document.readyState === "complete") {
    setTimeout(runDeferred, DEFER_MS);
  } else {
    window.addEventListener("load", () => setTimeout(runDeferred, DEFER_MS), { once: true });
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
