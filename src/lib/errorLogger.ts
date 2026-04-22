/**
 * Lightweight error reporter — no third-party SDK, no DSN required.
 *
 * Writes structured error events to the `error_logs` table in Supabase.
 * Use this everywhere you would have used Sentry.captureException().
 *
 * When you're ready to add Sentry later, swap the body of `report()` to
 * call Sentry.captureException(err, { extra }) and you're done.
 */
import { supabase } from "@/integrations/supabase/client";

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

  // Best-effort user identification.
  let userId: string | null = null;
  try {
    const cached = localStorage.getItem("sb-auth-token");
    if (cached) {
      const parsed = JSON.parse(cached);
      userId = parsed?.user?.id ?? null;
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
