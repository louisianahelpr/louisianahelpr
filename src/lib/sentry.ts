/**
 * Sentry initialization — error tracking + Session Replay (prod only).
 *
 * The DSN is publishable (safe in client bundles). Falls back to the
 * project DSN so the integration works even before VITE_SENTRY_DSN is
 * wired into env vars. Disable by clearing the fallback.
 *
 * IMPORTANT: We use named imports (not `import * as Sentry`) so Rollup
 * can tree-shake the Feedback and Replay-Canvas integrations out of the
 * main bundle. Lighthouse flagged ~57KB of unused JS from those modules
 * even with `defaultIntegrations: false` because a namespace import
 * keeps every re-export reachable.
 *
 * Session Replay is enabled ONLY in production builds (gated on
 * `import.meta.env.PROD`) with conservative sampling (10% sessions,
 * 100% on-error). All text inputs are masked by default for Stripe PCI
 * safety; media is unmasked so the UI surface is still legible in the
 * replay. Dev builds skip Replay entirely to keep the local bundle and
 * test surface small — errors still report in dev as before.
 *
 * COLD-START PERF: Replay registration is deferred via a dynamic
 * `import("@sentry/react")` inside a `requestIdleCallback` AFTER
 * `init()` returns, so the replayIntegration() call and the DOM
 * recording it triggers don't run on the critical-path bundle eval.
 * (@sentry-internal/replay was the former code-split target but was
 * removed in @sentry/react ≥10.58; replay is now part of the main
 * bundle, but the lazy initialization is preserved.) Sampling rates
 * are set on the initial `init()` config so semantics don't change —
 * the integration just starts capturing a tick later. A 5s `timeout`
 * fallback guarantees registration even if the browser never goes idle.
 *
 * We also skip `browserTracingIntegration`: it's the single heaviest
 * Sentry integration (~25KB gzip) and we don't consume the data — there
 * are zero custom `startSpan` / `startTransaction` calls in the app, so
 * the only thing it produced was automatic page-load + route-change
 * transactions that nobody looks at. Errors (the long-term archive) keep
 * working via the remaining integrations.
 */
import {
  init,
  setUser,
  setTag,
  addBreadcrumb,
  addIntegration,
  captureException as sentryCaptureException,
  breadcrumbsIntegration,
  globalHandlersIntegration,
  linkedErrorsIntegration,
  dedupeIntegration,
  httpContextIntegration,
} from "@sentry/react";

/**
 * Audit #2 from the 2026-05-27 cold-launch regression triage: a tag that
 * lets us write a Sentry alert rule for "any error during the cold-launch
 * window on a fresh install." The window is the first 10s post-boot —
 * long enough to cover the auth-ready resolution + first protected-route
 * render, short enough to filter out steady-state errors that drown out
 * the cold-launch signal we actually want to alert on.
 *
 * See `docs/sentry-cold-launch-alert.md` for the dashboard-side recipe.
 */
const COLD_LAUNCH_WINDOW_MS = 10_000;

const DSN =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ||
  "https://d3221775aacee16ad5837d44f0cbaa33@o4511265714601984.ingest.us.sentry.io/4511270677250048";

const ENV =
  (import.meta.env.VITE_SENTRY_ENV as string | undefined) ||
  (import.meta.env.DEV ? "development" : "production");

/**
 * Release tag. Preferred source is `VITE_SENTRY_RELEASE`, which CI sets to
 * the GitHub SHA at build time (see `.github/workflows/sentry-release.yml`)
 * so every deploy gets a unique, source-mapped release in Sentry and
 * crash dedup actually works across versions. Falls back to the app
 * version string for local/dev builds where the CI var isn't set.
 */
const RELEASE =
  (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) ||
  (import.meta.env.VITE_APP_VERSION as string | undefined) ||
  "1.0.0";

let initialized = false;

/**
 * Patterns matched against `event.message` and the first exception's
 * `value`. Anything that matches is dropped as benign noise so the
 * Sentry issue stream surfaces real bugs faster.
 *
 * Each entry below covers a specific class of non-actionable error —
 * see the comment on each pattern for the rationale.
 */
const BENIGN_MESSAGE_PATTERNS: RegExp[] = [
  // Network blips — connection dropped mid-fetch, user went offline, etc.
  // Not actionable: there's no bug, the request just didn't complete.
  /Load failed/i,
  /NetworkError when attempting to fetch resource/i,
  /Failed to fetch/i,
  /Network request failed/i,
  // User-initiated aborts (navigation, AbortController). Expected flow.
  /AbortError/i,
  /The (?:user )?aborted a request/i,
  /The operation was aborted/i,
  // Private/Incognito mode storage refusals — legitimate browser policy,
  // not a bug we can fix from JS.
  /QuotaExceededError/i,
  /The operation is insecure/i,
  /IDBDatabase|IndexedDB.*(?:not allowed|denied|disabled)/i,
  // Known harmless ResizeObserver warning — already in ignoreErrors but
  // some browsers surface it with slightly different wording.
  /ResizeObserver loop/i,
  // Capacitor plugin "not available on this platform" — happens whenever
  // a web build tries a native bridge (e.g. Haptics in a desktop browser).
  // The caller already has a graceful fallback; the throw isn't a bug.
  /not (?:available|implemented) on this platform/i,
  /not implemented on web/i,
  // Auth check on a logged-out user — expected control flow when the
  // app calls `getUser()` before knowing whether there's a session.
  /AuthSessionMissingError/i,
  /Auth session missing/i,
  // Stripe SDK occasionally surfaces these as "errors" on intentional
  // flow exits (user cancelled the payment sheet, payment succeeded
  // through a different code path, etc.).
  /Stripe.*(?:cancelled|canceled|succeeded)/i,
];

const EXTENSION_URL_PATTERNS: RegExp[] = [
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-extension:\/\//i,
  /safari-web-extension:\/\//i,
];

interface MinimalStackFrame {
  filename?: string;
  abs_path?: string;
}

interface MinimalException {
  value?: string;
  stacktrace?: { frames?: MinimalStackFrame[] };
}

interface MinimalEvent {
  message?: string;
  exception?: { values?: MinimalException[] };
}

function isBenignEvent(event: MinimalEvent | null | undefined): boolean {
  if (!event) return false;

  const firstException = event.exception?.values?.[0];
  const candidates: string[] = [];
  if (typeof event.message === "string") candidates.push(event.message);
  if (typeof firstException?.value === "string") candidates.push(firstException.value);

  for (const text of candidates) {
    for (const pattern of BENIGN_MESSAGE_PATTERNS) {
      if (pattern.test(text)) return true;
    }
  }

  // Browser-extension stack frames — not our code, not actionable.
  const frames = firstException?.stacktrace?.frames ?? [];
  for (const frame of frames) {
    const url = frame.filename ?? frame.abs_path ?? "";
    if (!url) continue;
    for (const pattern of EXTENSION_URL_PATTERNS) {
      if (pattern.test(url)) return true;
    }
  }

  return false;
}

export function initSentry() {
  if (initialized || typeof window === "undefined" || !DSN) return;
  try {
    // Initial integration set is the minimal "always-on" tracking surface.
    // Session Replay is registered *after* init() returns, on the next
    // idle tick — see the deferred block below. Keeping it out of this
    // array is the whole point of the cold-start perf fix: the Replay
    // module graph is heavy (~38KB parse) and we don't want it walked
    // on the main bundle-eval path.
    const integrations = [
      breadcrumbsIntegration(),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
    ];

    init({
      dsn: DSN,
      environment: ENV,
      release: RELEASE,
      // Replace defaults with a minimal set. Skips Feedback (~15KB),
      // Replay-Canvas (~4KB), and BrowserTracing (~25KB) integrations
      // that ship with @sentry/react by default. Replay is registered
      // separately (prod only, deferred) with conservative sampling.
      defaultIntegrations: false,
      integrations,
      // No tracing — we removed browserTracingIntegration above.
      // tracesSampleRate left out so Sentry doesn't even register the
      // tracing transport.

      // Session Replay sampling — conservative to keep quota predictable.
      // Set on the initial config (NOT on the deferred addIntegration)
      // so the sampling decision is in place by the time Replay starts.
      //   - 10% random session sample (gives us a visual archive of
      //     "normal" sessions for context, without ingesting everything).
      //   - 100% of sessions that hit an error (these are the ones we
      //     always want to see — debugging is the whole point).
      // Both default to 0 in dev because Replay isn't registered there.
      replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 0,
      replaysOnErrorSampleRate: import.meta.env.PROD ? 1.0 : 0,

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
        return isBenignEvent(event) ? null : event;
      },
    });
    initialized = true;
    markColdLaunchStart();

    // Defer Replay registration off the critical path. Privacy defaults:
    // - maskAllText: true — every text node (incl. <input> values) is
    //   redacted. Critical for Stripe PCI scope (card numbers, CVCs)
    //   and Supabase magic-link tokens that may appear inline.
    // - blockAllMedia: false — we DO want to see images/icons/SVGs
    //   so the replay is legible enough to debug the UI surface.
    // - networkDetailAllowUrls left at its default (empty) — replay
    //   captures request URLs but NOT bodies/headers, so auth tokens
    //   in Supabase responses or Stripe payloads can't leak.
    if (import.meta.env.PROD) {
      const registerReplay = () => {
        // Dynamic import from `@sentry/react` so the replay integration is
        // registered lazily (on idle/fallback timer) rather than on the
        // critical-path bundle eval. Replay initialization is still deferred;
        // the replay module is bundled with the main chunk because @sentry/react
        // is already a static dependency, but the replayIntegration() call and
        // the DOM recording it triggers are deferred until the browser is idle.
        // (@sentry-internal/replay was removed in @sentry/react ≥10.58.)
        import("@sentry/react")
          .then(({ replayIntegration }) => {
            try {
              addIntegration(
                replayIntegration({
                  maskAllText: true,
                  blockAllMedia: false,
                }),
              );
            } catch {
              /* swallow — Replay failure must never break the app */
            }
          })
          .catch(() => {
            /* swallow — Replay chunk download failure must never break the app */
          });
      };
      // requestIdleCallback isn't on Safari < 16.4 — fall back to a short
      // setTimeout so iOS WebViews still get Replay coverage.
      const ric = (window as unknown as {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout?: number },
        ) => number;
      }).requestIdleCallback;
      if (typeof ric === "function") {
        ric(registerReplay, { timeout: 5000 });
      } else {
        setTimeout(registerReplay, 2000);
      }
    }
  } catch {
    /* swallow — error tracking must never break the app */
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!initialized) return;
  try {
    sentryCaptureException(err, context ? { extra: context } : undefined);
  } catch { /* ignore */ }
}

/**
 * Mark the start of the cold-launch window so errors that occur within
 * the next ~10s are tagged `cold_launch:true` in Sentry. The Sentry
 * dashboard has an alert rule that fires when ≥1 of these arrive in a
 * 1-hour window — fastest signal we have for "fresh install is broken
 * for real users right now."
 *
 * Idempotent: calling twice during the same window is a no-op for the
 * second call (the timeout from the first will already clear the tag).
 *
 * See `docs/sentry-cold-launch-alert.md` for the dashboard-side recipe.
 */
let coldLaunchTimerStarted = false;
function markColdLaunchStart() {
  if (!initialized || coldLaunchTimerStarted) return;
  coldLaunchTimerStarted = true;
  try {
    setTag("cold_launch", "true");
    setTimeout(() => {
      try { setTag("cold_launch", "false"); } catch { /* ignore */ }
    }, COLD_LAUNCH_WINDOW_MS);
  } catch { /* ignore */ }
}

/**
 * Drop a Sentry breadcrumb for a key cold-launch phase. Visible on any
 * error that fires during/after the phase — invaluable for diagnosing
 * which step of the boot sequence broke.
 *
 * Call sites should match the actual cold-launch sequence:
 *   - "init"                — `initSentry()` ran
 *   - "auth-ready-resolved" — `useAuthReady` saw its first event
 *   - "first-route-rendered"— `<App>` rendered its first non-Suspense child
 *   - "native-redirect-decided" — `NativeRedirect` picked /dashboard or /browse
 */
export function markColdLaunchPhase(phase: string) {
  if (!initialized) return;
  try {
    addBreadcrumb({
      category: "cold-launch",
      message: phase,
      level: "info",
      timestamp: Date.now() / 1000,
    });
  } catch { /* ignore */ }
}

export function setSentryUser(user: { id: string; email?: string | null } | null) {
  if (!initialized) return;
  try {
    if (user) setUser({ id: user.id, email: user.email ?? undefined });
    else setUser(null);
  } catch { /* ignore */ }
}
