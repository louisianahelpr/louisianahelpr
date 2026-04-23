/**
 * Sentry initialization — error tracking + performance.
 *
 * The DSN is publishable (safe in client bundles). Falls back to the
 * project DSN so the integration works even before VITE_SENTRY_DSN is
 * wired into env vars. Disable by clearing the fallback.
 */
import * as Sentry from "@sentry/react";

const DSN =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ||
  "https://d3221775aacee16ad5837d44f0cbaa33@o4511265714601984.ingest.us.sentry.io/4511270677250048";

const ENV =
  (import.meta.env.VITE_SENTRY_ENV as string | undefined) ||
  (import.meta.env.DEV ? "development" : "production");

const RELEASE =
  (import.meta.env.VITE_APP_VERSION as string | undefined) || "1.0.0";

let initialized = false;

export function initSentry() {
  if (initialized || typeof window === "undefined" || !DSN) return;
  try {
    Sentry.init({
      dsn: DSN,
      environment: ENV,
      release: RELEASE,
      // Browser tracing for slow-page diagnostics.
      integrations: [Sentry.browserTracingIntegration()],
      // Sample 10% of transactions in production, 100% in dev.
      tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
      // Don't ship benign noise.
      ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications",
        "Non-Error promise rejection captured",
      ],
      beforeSend(event) {
        // Drop events from localhost in case anyone runs prod build locally.
        if (window.location.hostname === "localhost" && !import.meta.env.DEV) {
          return null;
        }
        return event;
      },
    });
    initialized = true;
  } catch {
    /* swallow — error tracking must never break the app */
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!initialized) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch { /* ignore */ }
}

export function setSentryUser(user: { id: string; email?: string | null } | null) {
  if (!initialized) return;
  try {
    if (user) Sentry.setUser({ id: user.id, email: user.email ?? undefined });
    else Sentry.setUser(null);
  } catch { /* ignore */ }
}

export { Sentry };
