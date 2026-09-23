/**
 * Lightweight error reporter — no third-party SDK, no DSN required.
 *
 * Writes structured error events to the `error_logs` table in Supabase, with
 * a plain fetch: no lazily loaded chunk it depends on can fail (Q161).
 * Use this everywhere you would have used Sentry.captureException().
 *
 * When you're ready to add Sentry later, swap the body of `report()` to
 * call Sentry.captureException(err, { extra }) and you're done.
 */

import { Capacitor } from "@capacitor/core";
import type { Json } from "@/integrations/supabase/types";
import { backgroundImport, getBackgroundImportFailures, onBackgroundImportFailure } from "@/lib/chunkReload";

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
/** Test seam for describeUnknownError. */
export function _describeUnknownError(err: unknown): string {
  return describeUnknownError(err);
}

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
  // The native iOS/Android shell serves from capacitor://localhost (and
  // Android's https://localhost), so hostname === "localhost" here would
  // otherwise silently drop EVERY real native crash. A native platform is
  // never the dev environment — bail before the hostname checks.
  if (Capacitor.isNativePlatform()) return false;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return true;
  if (stack && (stack.includes("localhost:") || stack.includes("@vite/client"))) return true;
  return false;
}

// ── Persistence: a plain fetch, never a lazily loaded chunk (Q161) ────
// This used to import the supabase client through backgroundImport(). The
// browser caches a failed dynamic import() for the life of the document, so
// one transient failure of that chunk dropped every later report() in the
// session, and the reports that would have explained the failure were the
// first ones lost. `fetch` is always there, and it keeps supabase-js out of
// the entry chunk just as the lazy import did. The request mirrors what
// `supabase.from("error_logs").insert(batch)` sent (postgrest-js insert()):
// POST /rest/v1/error_logs?columns=..., apikey, Authorization (the session's
// access token, else the key), Content-Type json, Content-Profile public.
const ERROR_LOG_COLUMNS = ["user_id", "severity", "message", "stack", "url", "user_agent", "tags", "context"] as const;
/** fetch keepalive refuses bodies over 64 KiB; stay under it with margin. */
const KEEPALIVE_MAX_BYTES = 60_000;

/** What the persistence path has done this document (rows, not requests). */
const persistStats = { attempted: 0, persisted: 0, failed: 0, lastStatus: 0 };
/** Test seam: a snapshot of persistStats. */
export function _persistStats(): Readonly<typeof persistStats> {
  return { ...persistStats };
}

/**
 * The signed-in user's access token, if storage holds an unexpired one.
 * supabase-js keeps the session under `sb-<project-ref>-auth-token` (the
 * native keychain adapter mirrors it into localStorage). With no token the row
 * still lands under the anon role, which the insert policy allows; the server
 * stamps user_id from the token either way (stamp_error_log_origin, Q106).
 */
function storedAccessToken(supabaseUrl: string): string | null {
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: unknown; expires_at?: unknown } | null;
    const token = parsed?.access_token;
    if (typeof token !== "string" || !token) return null;
    // An expired token is refused with 401, and the whole batch with it.
    const expiresAt = typeof parsed?.expires_at === "number" ? parsed.expires_at : 0;
    if (expiresAt && expiresAt * 1000 <= Date.now() + 5_000) return null;
    return token;
  } catch {
    // Storage blocked or unparseable: send as anon, which the policy allows.
    return null;
  }
}

async function postErrorLogs(batch: ErrorLogRow[]): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  persistStats.attempted += batch.length;
  if (!supabaseUrl || !key || typeof fetch !== "function") {
    persistStats.failed += batch.length;
    return;
  }
  const columns = ERROR_LOG_COLUMNS.map((c) => `"${c}"`).join(",");
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/error_logs?columns=${encodeURIComponent(columns)}`;
  const body = JSON.stringify(batch);
  const send = (bearer: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        "Content-Profile": "public",
      },
      body,
      // Lets a flush that starts as the page goes away still complete.
      keepalive: body.length < KEEPALIVE_MAX_BYTES,
    });
  try {
    const token = storedAccessToken(supabaseUrl);
    let res = await send(token ?? key);
    // A token the server no longer accepts (revoked, clock skew): the row is
    // still worth having, so send it once more as anon.
    if (res.status === 401 && token) res = await send(key);
    persistStats.lastStatus = res.status;
    if (res.ok) persistStats.persisted += batch.length;
    else persistStats.failed += batch.length;
  } catch {
    // Network failed. Counted, never reported: reporting a logging failure
    // through the logger would recurse on itself.
    persistStats.failed += batch.length;
  }
}

// Sentry + PostHog are dynamically imported to keep ~100KB of vendor code out
// of the entry chunk (main.tsx → errorLogger → sentry/posthog would defeat the
// deferred init). Loaded SEPARATELY, so one failed chunk does not silence the
// other too; each failure is counted and surfaced by backgroundImport (Q161).
async function fanOutToObservability(err: unknown, extra: Record<string, unknown>) {
  await Promise.all([
    backgroundImport(() => import("@/lib/sentry"), "sentry")
      .then(({ captureException }) => captureException(err, extra))
      .catch(() => {
        /* counted and reported once by backgroundImport; observability must never break the app */
      }),
    backgroundImport(() => import("@/lib/posthog"), "posthog")
      .then(({ captureException }) => captureException(err, extra))
      .catch(() => {
        /* counted and reported once by backgroundImport; observability must never break the app */
      }),
  ]);
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
  context: Json;
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
    await postErrorLogs(batch);
  } finally {
    flushing = false;
    // Rows queued while this batch was in flight saw no timer to join and
    // scheduled none of their own (the timer is cleared on entry); pick them up.
    if (queue.length > 0) scheduleFlush();
  }
}

/** Coalesce multiple reports in a tight burst into a single flush. */
function scheduleFlush() {
  if (pendingTimer === null) {
    pendingTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }
}

// ── Failed background imports (Q161) ─────────────────────────────────
// analytics, posthog and sentry still load lazily, and each caller's catch
// drops what it was sending. A failed chunk stays failed for the whole
// document, so that loss is total and was silent. Say so ONCE per module per
// session, through the fetch path above, which depends on no chunk.
const BG_FAILURE_FLAG_PREFIX = "helpr_bg_import_failed_reported:";
const bgFailureReportedInMemory = new Set<string>();

function claimBackgroundFailureReport(name: string): boolean {
  if (bgFailureReportedInMemory.has(name)) return false;
  bgFailureReportedInMemory.add(name);
  try {
    if (sessionStorage.getItem(BG_FAILURE_FLAG_PREFIX + name)) return false;
    sessionStorage.setItem(BG_FAILURE_FLAG_PREFIX + name, String(Date.now()));
  } catch {
    // No sessionStorage: the in-memory set still caps it at one per document.
  }
  return true;
}

function noteBackgroundImportFailure(name: string, err: unknown) {
  const rawStack = err instanceof Error ? (err.stack ?? null) : null;
  if (isDevEnvironment(rawStack)) return;
  if (!claimBackgroundFailureReport(name)) return;
  const context: Record<string, Json> = {
    error: (redact(describeUnknownError(err)) ?? "").slice(0, MESSAGE_MAX_CHARS),
    failures: getBackgroundImportFailures(),
  };
  if (typeof __APP_COMMIT_FULL__ !== "undefined" && __APP_COMMIT_FULL__ !== "dev") {
    context.release = __APP_COMMIT_FULL__;
  }
  queue.push({
    user_id: null,
    severity: "warning",
    message: `background import failed: ${name}`.slice(0, MESSAGE_MAX_CHARS),
    stack: redact(rawStack)?.slice(0, STACK_MAX_CHARS) ?? null,
    url: sanitizeUrl(typeof window !== "undefined" ? window.location.href : null),
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, USER_AGENT_MAX_CHARS) : null,
    tags: { source: "backgroundImport", module: name },
    context,
  });
  // No fan-out: the module that failed may be sentry or posthog itself.
  scheduleFlush();
}

onBackgroundImportFailure(noteBackgroundImportFailure);

/** Test-only: forget which failures were already reported this session. */
export function _resetBackgroundFailureReportsForTests() {
  bgFailureReportedInMemory.clear();
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(BG_FAILURE_FLAG_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* no storage, nothing to clear */
  }
}

// ── Public API ───────────────────────────────────────────────────────
/**
 * A message for anything that can be thrown or returned as an error.
 *
 * `String(err)` on a plain object is "[object Object]" — and Supabase's
 * PostgrestError / AuthError / StorageError are plain objects with a
 * `message`, not Error instances. Every `report(error)` of a Supabase error
 * therefore reached Sentry and error_logs as "[object Object]" with no
 * stack (PaymentSuccess.confirmPayment, 2026-09-07, three of them in an
 * afternoon and nothing to read). Prefer the object's own message, and
 * carry its code/details/hint so the row says what the database said.
 */
function describeUnknownError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.message === "string" && o.message) parts.push(o.message);
    for (const k of ["code", "details", "hint", "status"] as const) {
      const v = o[k];
      if (typeof v === "string" && v) parts.push(`${k}=${v}`);
      else if (typeof v === "number") parts.push(`${k}=${v}`);
    }
    if (parts.length) return parts.join(" · ");
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      /* circular — fall through */
    }
    // Still nothing: every own property was empty or non-serialisable.
    // "[object Object]" tells the reader NOTHING — six of them landed from
    // PaymentSuccess.confirmPayment on 2026-09-08 AFTER the message/code
    // branch above shipped, so the object had none of those. Name its
    // shape instead, so the next row at least says what kind of thing it
    // was and which keys it carried (enumerable AND inherited getters —
    // a DOMException keeps `name`/`message` on the prototype).
    const proto = Object.getPrototypeOf(o) as { constructor?: { name?: string } } | null;
    const ctor = proto?.constructor?.name;
    const keys = new Set<string>(Object.keys(o));
    for (const k of ["name", "message", "code", "status", "reason"] as const) {
      const v = (o as Record<string, unknown>)[k];
      if (v !== undefined && v !== null && v !== "") keys.add(`${k}=${String(v)}`);
    }
    return `${ctor && ctor !== "Object" ? ctor : "object"}{${[...keys].join(",")}}`;
  }
  return String(err);
}

export function report(err: unknown, opts: ReportOptions = {}) {
  const isError = err instanceof Error;
  const rawMessage = describeUnknownError(err);
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
  const context: Record<string, Json> = {};
  if (opts.context) {
    for (const [k, v] of Object.entries(opts.context)) {
      // Caller context is destined for a jsonb column. Strings are
      // redacted; other values are asserted JSON-serializable.
      context[k] = typeof v === "string" ? redact(v) : (v as Json);
    }
  }

  // Which build threw. The prod-errors issue names the release by this, the
  // way Sentry does; a sha that stops matching prod's build-commit meta is
  // a stale tab, not a regression.
  if (typeof __APP_COMMIT_FULL__ !== "undefined" && __APP_COMMIT_FULL__ !== "dev") {
    context.release = __APP_COMMIT_FULL__;
  }

  queue.push({
    // Always null: the server stamps the caller's id from the request's own
    // token (stamp_error_log_origin, Q106). Sending an id read from
    // localStorage made a guest with a stale stored session send a non-null
    // id under the anon role, RLS refused the insert, and the whole batch
    // was lost silently (Q110).
    user_id: null,
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

  scheduleFlush();
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
