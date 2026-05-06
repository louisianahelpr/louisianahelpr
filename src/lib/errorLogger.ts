/**
 * Lightweight error reporter — no third-party SDK, no DSN required.
 *
 * Writes structured error events to the `error_logs` table in Supabase.
 * Use this everywhere you would have used Sentry.captureException().
 *
 * When you're ready to add Sentry later, swap the body of `report()` to
 * call Sentry.captureException(err, { extra }) and you're done.
 */
// Supabase client is dynamically imported (NOT statically) to keep the
// ~50KB supabase-js chunk out of the initial bundle. installGlobalErrorHandlers()
// is called eagerly from main.tsx so it can catch first-render throws, but the
// actual flush is debounced 250ms — plenty of time for a dynamic import to
// resolve. Anonymous landing-page visitors who never error will never download
// supabase-js at all (Lighthouse "Reduce unused JavaScript").
async function getSupabase() {
  const mod = await import("@/integrations/supabase/client");
  return mod.supabase;
}

// Sentry + PostHog are dynamically imported (NOT statically) to keep them
// out of the initial bundle. Static imports here would pull ~100KB of
// vendor code into the entry chunk via main.tsx → errorLogger → sentry/
// posthog, defeating the deferred init in main.tsx and triggering
// Lighthouse's "Reduce unused JavaScript" audit. The fan-out below
// resolves to no-ops if Sentry/PostHog haven't initialized yet.
async function fanOutToObservability(
  err: unknown,
  extra: Record<string, unknown>,
) {
  try {
    const [{ captureException: sentryCapture }, { captureException: posthogCapture }] =
      await Promise.all([import("@/lib/sentry"), import("@/lib/posthog")]);
    sentryCapture(err, extra);
    posthogCapture(err, extra);
  } catch {
    /* observability must never break the app */
  }
}

type Severity = "info" | "warning" | "error" | "fatal";

interface ReportOptions {
  severity?: Severity;
  tags?: Record<string, string | number | boolean>;
  context?: Record<string, unknown>;
  /** Surface a toast to the user. Default false — silent reporting. */
  notifyUser?: boolean;
}

const queue: any[] = [];
let flushing = false;

async function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    const supabase = await getSupabase();
    await supabase.from("error_logs" as any).insert(batch);
  } catch {
    // Network failed — drop. We don't want logging to recurse on itself.
  } finally {
    flushing = false;
  }
}

export function report(err: unknown, opts: ReportOptions = {}) {
  const isError = err instanceof Error;
  const message = isError ? err.message : String(err);
  const stack = isError ? err.stack : null;

  // Best-effort user identification. Supabase JS v2 stores the session
  // in localStorage under `sb-<projectRef>-auth-token` (not `sb-auth-token`,
  // which was the v1 key). Scan all localStorage keys for the v2 pattern
  // so this stays robust if the project ref changes.
  let userId: string | null = null;
  try {
    if (typeof localStorage !== "undefined") {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const cached = localStorage.getItem(key);
        if (!cached) continue;
        try {
          const parsed = JSON.parse(cached);
          // v2 shape: { access_token, refresh_token, user: { id, ... } }
          userId = parsed?.user?.id ?? parsed?.currentSession?.user?.id ?? null;
          if (userId) break;
        } catch { /* not JSON, skip */ }
      }
    }
  } catch { /* ignore */ }

  queue.push({
    user_id: userId,
    severity: opts.severity ?? "error",
    message: message.slice(0, 1000),
    stack: stack?.slice(0, 4000) ?? null,
    url: typeof window !== "undefined" ? window.location.pathname : null,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    tags: opts.tags ?? {},
    context: opts.context ?? {},
  });

  // Fan out to Sentry + PostHog Error Tracking. No-op until their init
  // runs in main.tsx (and the SDKs themselves are lazy-loaded here so
  // they don't bloat the initial bundle).
  void fanOutToObservability(err, { ...opts.context, ...opts.tags });

  // Debounced flush — never block the caller.
  setTimeout(flush, 250);
}

/** Wire up global handlers once on app boot. Called from main.tsx. */
export function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    report(event.error ?? event.message, {
      tags: { source: "window.onerror" },
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    report(event.reason, {
      severity: "error",
      tags: { source: "unhandledrejection" },
    });
  });
}
