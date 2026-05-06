/**
 * Lightweight error reporter — no third-party SDK, no DSN required.
 *
 * Writes structured error events to the `error_logs` table in Supabase.
 * Use this everywhere you would have used Sentry.captureException().
 *
 * When you're ready to add Sentry later, swap the body of `report()` to
 * call Sentry.captureException(err, { extra }) and you're done.
 */

// ── Tunables ─────────────────────────────────────────────────────────
const MESSAGE_MAX_CHARS = 1000;
const STACK_MAX_CHARS = 4000;
const URL_MAX_CHARS = 500;
const USER_AGENT_MAX_CHARS = 500;
const FLUSH_DEBOUNCE_MS = 250;

// Patterns that look like secrets in error messages or stacks. Each is
// substituted with a redacted marker so we never persist credentials in
// error_logs (recovery tokens, JWTs, bearer auths, OpenID id_tokens).
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /[Bb]earer\s+[A-Za-z0-9._\-+/=]+/g, replacement: "Bearer <redacted>" },
  { pattern: /eyJ[A-Za-z0-9._-]{20,}/g, replacement: "<redacted-jwt>" },
  { pattern: /\?token=[^&\s"']+/g, replacement: "?token=<redacted>" },
  { pattern: /\?code=[^&\s"']+/g, replacement: "?code=<redacted>" },
  { pattern: /sb_secret_[A-Za-z0-9._-]+/g, replacement: "sb_secret_<redacted>" },
];

// Exported for unit tests. Production code should call report() instead.
export function _redact(input: string | null | undefined): string | null {
  return redact(input);
}

// Exported for unit tests.
export function _sanitizeUrl(url: string | null | undefined): string | null {
  return sanitizeUrl(url);
}

// Exported for unit tests.
export function _isDevEnvironment(stack: string | null | undefined): boolean {
  return isDevEnvironment(stack);
}

function redact(input: string | null | undefined): string | null {
  if (!input) return input ?? null;
  let out = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Strip query string from a URL string while keeping origin + pathname.
// Avoids leaking ?token=... / ?code=... into error_logs.url.
function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "https://localhost");
    return (u.origin + u.pathname).slice(0, URL_MAX_CHARS);
  } catch {
    // Not a URL, just a pathname or filename — strip ?query manually.
    return url.split("?")[0].slice(0, URL_MAX_CHARS);
  }
}

// Conservative dev-environment detection. Errors from local dev should
// never reach the production error_logs table — they're noise.
function isDevEnvironment(stack: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return true;
  if (stack && (stack.includes("localhost:") || stack.includes("@vite/client"))) return true;
  return false;
}

// ── Lazy supabase client ─────────────────────────────────────────────
// Supabase client is dynamically imported (NOT statically) to keep the
// ~50KB supabase-js chunk out of the initial bundle. installGlobalErrorHandlers()
// is called eagerly from main.tsx so it can catch first-render throws, but the
// actual flush is debounced — plenty of time for a dynamic import to resolve.
// Anonymous landing-page visitors who never error will never download
// supabase-js at all (Lighthouse "Reduce unused JavaScript").
async function getSupabase() {
  const mod = await import("@/integrations/supabase/client");
  return mod.supabase;
}

// Sentry + PostHog are dynamically imported for the same reason.
// Static imports here would pull ~100KB of vendor code into the entry chunk
// via main.tsx → errorLogger → sentry/posthog, defeating the deferred init.
async function fanOutToObservability(err: unknown, extra: Record<string, unknown>) {
  try {
    const [{ captureException: sentryCapture }, { captureException: posthogCapture }] =
      await Promise.all([import("@/lib/sentry"), import("@/lib/posthog")]);
    sentryCapture(err, extra);
    posthogCapture(err, extra);
  } catch {
    /* observability must never break the app */
  }
}

// ── Public types ─────────────────────────────────────────────────────
type Severity = "info" | "warning" | "error" | "fatal";

interface ReportOptions {
  severity?: Severity;
  tags?: Record<string, string | number | boolean>;
  context?: Record<string, unknown>;
  /** Surface a toast to the user. Default false — silent reporting. */
  notifyUser?: boolean;
}

interface ErrorLogRow {
  user_id: string | null;
  severity: Severity;
  message: string;
  stack: string | null;
  url: string | null;
  user_agent: string | null;
  tags: Record<string, string | number | boolean>;
  context: Record<string, unknown>;
}

// ── Queue + flush ────────────────────────────────────────────────────
const queue: ErrorLogRow[] = [];
let flushing = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  pendingTimer = null;
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    const supabase = await getSupabase();
    await supabase.from("error_logs").insert(batch);
  } catch {
    // Network failed — drop. We don't want logging to recurse on itself.
  } finally {
    flushing = false;
  }
}

// Read user_id from the Supabase v2 session blob in localStorage.
// The key is `sb-<projectRef>-auth-token` — scan for it instead of
// hardcoding a project ref.
function readUserIdFromLocalStorage(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const cached = localStorage.getItem(key);
      if (!cached) continue;
      try {
        const parsed = JSON.parse(cached);
        const id = parsed?.user?.id ?? parsed?.currentSession?.user?.id ?? null;
        if (id) return id;
      } catch { /* not JSON */ }
    }
  } catch { /* localStorage blocked */ }
  return null;
}

// ── Public API ───────────────────────────────────────────────────────
export function report(err: unknown, opts: ReportOptions = {}) {
  const isError = err instanceof Error;
  const rawMessage = isError ? err.message : String(err);
  const rawStack = isError ? err.stack : null;

  if (isDevEnvironment(rawStack)) return;

  const message = (redact(rawMessage) ?? "").slice(0, MESSAGE_MAX_CHARS);
  const stack = redact(rawStack)?.slice(0, STACK_MAX_CHARS) ?? null;
  const url = sanitizeUrl(typeof window !== "undefined" ? window.location.href : null);
  const userAgent = typeof navigator !== "undefined"
    ? navigator.userAgent.slice(0, USER_AGENT_MAX_CHARS)
    : null;

  // Sanitize context too — callers sometimes accidentally pass raw URLs
  // or tokens. We only redact strings; nested objects pass through.
  const context: Record<string, unknown> = {};
  if (opts.context) {
    for (const [k, v] of Object.entries(opts.context)) {
      context[k] = typeof v === "string" ? redact(v) : v;
    }
  }

  queue.push({
    user_id: readUserIdFromLocalStorage(),
    severity: opts.severity ?? "error",
    message,
    stack,
    url,
    user_agent: userAgent,
    tags: opts.tags ?? {},
    context,
  });

  // Fan out to Sentry + PostHog Error Tracking. No-op until their init
  // runs in main.tsx (and the SDKs themselves are lazy-loaded here so
  // they don't bloat the initial bundle).
  void fanOutToObservability(err, { ...context, ...opts.tags });

  // Coalesce multiple reports in a tight burst into a single flush.
  if (pendingTimer === null) {
    pendingTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }
}

/** Wire up global handlers once on app boot. Called from main.tsx. */
export function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    report(event.error ?? event.message, {
      tags: { source: "window.onerror" },
      // Strip query strings from filename to avoid leaking auth tokens
      // that landed in the URL of the script that threw.
      context: {
        filename: sanitizeUrl(event.filename),
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    report(event.reason, {
      severity: "error",
      tags: { source: "unhandledrejection" },
    });
  });
}
