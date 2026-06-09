/**
 * applyRateLimit — client wrapper for the server-side job-application
 * rate limiter.
 *
 * Server source of truth lives in `public.application_rate_log` +
 * `rpc_check_application_rate` + `rpc_record_application_attempt`
 * (migration 20260609130000). The decided limits are:
 *
 *   • 10 applications / minute
 *   • 50 applications / hour
 *   • 200 applications / day
 *
 * Flow at the call site:
 *   1. checkApplicationRate({ applicantId })  — BEFORE inserting.
 *      • allowed = true → proceed.
 *      • allowed = false → show the formatted message + retry hint.
 *   2. recordApplicationAttempt({ applicantId }) — AFTER the insert succeeds.
 *
 * Migrations don't auto-deploy (CLAUDE.md working rules), so both helpers
 * ship a graceful fallback for PGRST202 ("function not found"). When the
 * RPC isn't present yet, the check returns `allowed = true` — we do not
 * want to block legitimate applies between merge and the manual db push.
 * The record helper is best-effort; a missing RPC is silently swallowed.
 */
import { supabase } from "@/integrations/supabase/client";

/** True when the Supabase RPC error code means "function not deployed". */
function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "PGRST202";
}

export type RateLimitReason =
  | "rate_limit_minute"
  | "rate_limit_hour"
  | "rate_limit_day"
  | "not_authenticated";

export type RateLimitCheck =
  | { allowed: true }
  | {
      allowed: false;
      reason: RateLimitReason;
      retryAfterSeconds: number;
      message: string;
    };

/**
 * Format a user-facing message for a rate-limit block. Warm copy that
 * matches the project's tone (per CLAUDE.md "warm copy" polish work).
 */
export function formatRateLimitMessage(
  reason: RateLimitReason,
  retryAfterSeconds: number,
): string {
  if (reason === "not_authenticated") {
    return "Please sign in to apply.";
  }
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  if (reason === "rate_limit_minute") {
    const seconds = Math.max(1, retryAfterSeconds);
    return `You're applying really fast — give it ${seconds}s and try again.`;
  }
  if (reason === "rate_limit_hour") {
    return `You've applied to a lot of jobs in the last hour — try again in ${minutes} min.`;
  }
  // rate_limit_day
  const hours = Math.max(1, Math.ceil(retryAfterSeconds / 3600));
  return `You've hit today's apply cap — try again in ${hours}h.`;
}

/**
 * Check whether the calling user is currently allowed to submit another
 * job application. Falls back to "allowed" when the RPC isn't deployed
 * yet (PGRST202) so the feature isn't broken on production between merge
 * and the manual `supabase db push`.
 *
 * Network errors also fall back to "allowed" — a transient hiccup
 * shouldn't block a paying user. The hard cap still holds server-side
 * because the apply insert itself would still need to round-trip.
 */
export async function checkApplicationRate(args: {
  applicantId: string;
}): Promise<RateLimitCheck> {
  if (!args.applicantId) {
    return {
      allowed: false,
      reason: "not_authenticated",
      retryAfterSeconds: 0,
      message: formatRateLimitMessage("not_authenticated", 0),
    };
  }

  // Cast through `any` until the next `supabase gen types` lands — this
  // RPC is added in migration 20260609130000 which hasn't been reflected
  // in `src/integrations/supabase/types.ts` yet.
  const { data, error } = await (supabase.rpc as any)(
    "rpc_check_application_rate",
    { _applicant_id: args.applicantId },
  );

  if (error) {
    if (isMissingRpc(error)) {
      // RPC not deployed yet — let the apply proceed.
      return { allowed: true };
    }
    // Any other error: fail open (allow). The server-side cap remains
    // enforced once the migration is live; blocking here would make
    // network blips look like rate-limit hits to the user.
    return { allowed: true };
  }

  // The RPC returns TABLE(allowed boolean, reason text, retry_after_seconds int).
  // supabase-js represents that as an array of rows; we always read row 0.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { allowed: true };

  const allowed = row.allowed === true;
  if (allowed) return { allowed: true };

  const reason = (row.reason ?? "rate_limit_minute") as RateLimitReason;
  const retryAfterSeconds = Number(row.retry_after_seconds ?? 0);
  return {
    allowed: false,
    reason,
    retryAfterSeconds,
    message: formatRateLimitMessage(reason, retryAfterSeconds),
  };
}

/**
 * Record a successful application attempt. Best-effort: errors here are
 * swallowed because the apply itself has already succeeded — losing one
 * counter row is far better than surfacing a confusing toast after a
 * happy "Application sent!" message.
 *
 * PGRST202 ("function not found") is the expected state on production
 * between merge and the manual db push, and is treated as a no-op.
 */
export async function recordApplicationAttempt(args: {
  applicantId: string;
}): Promise<void> {
  if (!args.applicantId) return;
  try {
    const { error } = await (supabase.rpc as any)(
      "rpc_record_application_attempt",
      { _applicant_id: args.applicantId },
    );
    if (error && !isMissingRpc(error)) {
      // Log to console only — the user has already seen success.
      // eslint-disable-next-line no-console
      console.warn("[applyRateLimit] record failed:", error.message);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[applyRateLimit] record threw:", err);
  }
}
