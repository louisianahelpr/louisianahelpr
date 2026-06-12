/**
 * applyRateLimit — client wrapper for the server-side job-application
 * rate limiter.
 *
 * Server source of truth lives in `public.application_attempts` +
 * `rpc_record_application_attempt` (migration 20260612050500). The
 * decided limits are:
 *
 *   • 10 applications / minute
 *   • 50 applications / hour
 *   • 200 applications / day
 *
 * Preferred flow (single combined RPC):
 *   const gate = await recordAndCheckApplicationRate({ applicantId });
 *   if (!gate.allowed) { toast(gate.message); return; }
 *   // ... insert application row ...
 *
 * The single RPC both records the attempt AND checks all three windows in
 * one round-trip (migration 20260612050500). Blocked attempts still count
 * toward the window (insert-then-check).
 *
 * Legacy two-step helpers (checkApplicationRate / recordApplicationAttempt)
 * are kept for backward compatibility with the 20260609130000 migration path.
 *
 * Migrations don't auto-deploy (CLAUDE.md working rules), so every helper
 * ships a graceful PGRST202 fallback — when the RPC isn't present yet,
 * it returns `allowed = true` so applies don't break on production between
 * merge and the manual db push.
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
 *
 * @deprecated Prefer `recordAndCheckApplicationRate` (single combined RPC,
 * migration 20260612050500) over this two-step legacy pair.
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
      console.warn("[applyRateLimit] record failed:", error.message);
    }
  } catch (err) {
    console.warn("[applyRateLimit] record threw:", err);
  }
}

/**
 * Combined check-and-record: calls `rpc_record_application_attempt`
 * (migration 20260612050500) which atomically inserts the attempt row
 * AND checks all three rolling windows, returning a uniform jsonb result.
 *
 * Replaces the legacy two-step checkApplicationRate + recordApplicationAttempt
 * pair — one network round-trip instead of two, and the attempt is always
 * counted (even blocked ones) so the window is consistent server-side.
 *
 * PGRST202 fallback: if the RPC isn't deployed to prod yet (between merge
 * and `supabase db push`), returns allowed=true so applies keep working.
 * Other errors also fail open — a transient network hiccup shouldn't block
 * a legitimate apply.
 */
export async function recordAndCheckApplicationRate(args: {
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

  // Cast through `any` until `supabase gen types` picks up the new RPC
  // from migration 20260612050500.
  const { data, error } = await (supabase.rpc as any)(
    "rpc_record_application_attempt",
    { applicant_id: args.applicantId },
  );

  if (error) {
    if (isMissingRpc(error)) {
      // RPC not deployed yet — fail open.
      return { allowed: true };
    }
    // Any other error: fail open (network blip etc).
    return { allowed: true };
  }

  // The RPC returns jsonb: {allowed, retry_after_seconds, reason}.
  // supabase-js unwraps jsonb columns directly into the JS object.
  const result = typeof data === "object" && data !== null ? data : {};
  if (result.allowed === true || result.allowed == null) {
    return { allowed: true };
  }

  const reason = (result.reason ?? "rate_limit_minute") as RateLimitReason;
  const retryAfterSeconds = Number(result.retry_after_seconds ?? 0);
  return {
    allowed: false,
    reason,
    retryAfterSeconds,
    message: formatRateLimitMessage(reason, retryAfterSeconds),
  };
}
