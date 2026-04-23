/**
 * PostHog client — first-party product analytics.
 *
 * Initialized once from main.tsx. All `track()` calls in
 * src/lib/analytics.ts fan out here automatically, so feature
 * code never imports posthog-js directly.
 *
 * The project key is publishable (safe in client bundles), same
 * as the Supabase anon key. Host + key fall back to the values
 * shown in the PostHog setup snippet so the integration works
 * even before VITE_POSTHOG_KEY is wired into env vars.
 */
import posthog from "posthog-js";

const KEY =
  (import.meta.env.VITE_POSTHOG_KEY as string | undefined) ||
  "phc_yA2vkpkovtyfY3zMTsBsxZpqdF5xh78hjvSaZ8mfuunj";

const HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
  "https://us.i.posthog.com";

let initialized = false;

export function initPostHog() {
  if (initialized || typeof window === "undefined" || !KEY) return;
  try {
    posthog.init(KEY, {
      api_host: HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      // Auto-capture window.onerror + unhandledrejection into PostHog
      // Error Tracking. Complements Sentry + error_logs (triple redundancy).
      capture_exceptions: true,
      // Capacitor wraps the app in a WebView; disable session recording
      // by default to avoid surprising bandwidth on cellular.
      disable_session_recording: true,
      loaded: (ph) => {
        if (import.meta.env.DEV) ph.debug(false);
      },
    });
    initialized = true;
  } catch {
    /* swallow — analytics must never break the app */
  }
}

export function captureEvent(event: string, props: Record<string, any> = {}) {
  if (!initialized) return;
  try {
    posthog.capture(event, props);
  } catch { /* ignore */ }
}

export function identifyUser(userId: string, props: Record<string, any> = {}) {
  if (!initialized) return;
  try {
    posthog.identify(userId, props);
  } catch { /* ignore */ }
}

export function resetUser() {
  if (!initialized) return;
  try {
    posthog.reset();
  } catch { /* ignore */ }
}

export { posthog };
