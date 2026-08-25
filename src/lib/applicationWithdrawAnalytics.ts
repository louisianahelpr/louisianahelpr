/**
 * applicationWithdrawAnalytics — captures why a helper withdraws an
 * application, so product can see whether the reason mix shifts
 * (e.g. a spike in "schedule conflict" suggests a calendar UX gap).
 *
 * Two outputs:
 *
 *  1. A sessionStorage rolling log of the last 20 reason objects. This
 *     keeps the data on-device only (no extra schema), so a parallel
 *     migration isn't required to ship the picker. The log survives
 *     within a single app session; we cap to 20 so a long browsing
 *     stint doesn't bloat the storage cap.
 *  2. A `withdraw_reason` analytics event via the shared `track()`
 *     helper — fans out to PostHog + the `analytics_events` table the
 *     rest of the app already writes to, so the reason mix is queryable
 *     from the same admin dashboards without bespoke wiring.
 *
 * If we later decide reasons should be durable, swap the sessionStorage
 * sink for a Supabase insert into `application_withdraw_reasons`
 * (reserved migration timestamp 20260609190000) without changing the
 * call-site signature.
 */
import { track } from "@/lib/analytics";

export type WithdrawReason =
  | "another_job"
  | "schedule_conflict"
  | "no_longer_interested"
  | "other";

export interface WithdrawReasonChoice {
  /** Coded reason — stable string so dashboards can pivot on it. */
  reason: WithdrawReason;
  /** Free-text detail. Required when reason === "other". Trimmed. */
  detail?: string;
}

export interface WithdrawReasonEntry extends WithdrawReasonChoice {
  appId: string;
  jobId?: string | null;
  loggedAt: string;
}

const SESSION_KEY = "helpr_withdraw_reason_log_v1";
const MAX_ENTRIES = 20;

/** Read the rolling session log. Returns [] on any parse failure. */
function readWithdrawReasonLog(): WithdrawReasonEntry[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist a withdraw reason and fire the analytics event. Safe to call
 * after a successful withdraw — never throws (analytics must never
 * break the app), and a sessionStorage write failure is silently
 * swallowed.
 */
export function logWithdrawReason(
  appId: string,
  choice: WithdrawReasonChoice,
  jobId?: string | null,
): void {
  const entry: WithdrawReasonEntry = {
    appId,
    jobId: jobId ?? null,
    reason: choice.reason,
    detail: choice.detail?.trim() || undefined,
    loggedAt: new Date().toISOString(),
  };
  try {
    const next = [entry, ...readWithdrawReasonLog()].slice(0, MAX_ENTRIES);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage may be full or unavailable (private mode); ignore.
  }
  try {
    track("application_withdraw_reason", {
      application_id: appId,
      job_id: jobId ?? null,
      reason: choice.reason,
      has_detail: !!entry.detail,
    });
  } catch {
    // track() is already best-effort, but belt-and-suspenders.
  }
}
