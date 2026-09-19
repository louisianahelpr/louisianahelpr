/**
 * 24-hour post-completion messaging lockout (owner-approved, backlog #95).
 *
 * 24 hours after a job is completed, its thread closes to new messages for
 * EVERYONE on the job (the app is never role-based). The server enforces it
 * in `public.can_message_in_job`, the WITH CHECK on the messages INSERT
 * policy (migration 20260914201350). This module is the client half: it asks
 * the server WHEN each thread closes (`get_messaging_closes_at`, the same
 * expression the gate uses) so the composer is replaced by a read-only notice
 * instead of letting a send bounce off RLS.
 *
 * The client never computes the clock itself: completion time lives in
 * `jobs.completed_at`, stamped by a trigger, with a legacy fallback only the
 * database knows how to apply. And it never trusts the DEVICE clock for the
 * comparison: the RPC also returns `server_now`, and every "is it closed yet"
 * question is asked in server time (`serverNow()`). A phone set 10 minutes
 * fast would otherwise show the notice while the server still accepts sends;
 * one set slow would offer a composer the server already refuses.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

export const MESSAGING_LOCKOUT_HOURS = 24;

/** Copy for the read-only notice and for a send refused at the boundary. */
export const THREAD_CLOSED_NOTICE =
  "This conversation is closed. Messaging ends 24 hours after a job is completed. You can still read everything here.";
export const THREAD_CLOSED_TOAST =
  "This conversation closed 24 hours after the job was completed, so the message wasn't sent.";

/**
 * The CANCELLED variants (owner, 2026-09-19: a cancelled job's thread closes
 * immediately, migration 20260919220233).
 *
 * A separate string, not a parameterised one, for a reason that is not
 * stylistic: the completed copy states a RULE ("messaging ends 24 hours
 * after a job is completed") and that rule is false for a cancellation —
 * there is no 24-hour window and the job was never completed. Telling
 * somebody whose job was just cancelled that it "was completed" is the kind
 * of wrong that makes a user doubt everything else on the screen.
 *
 * Both say the same reassuring thing the completed pair says, because it is
 * equally true and it is the question the reader actually has: the messages
 * are still here. Nothing is deleted (see components/messages/threadAgeOut.ts
 * for why that is a hard rule).
 */
export const THREAD_CANCELLED_NOTICE =
  "This conversation is closed — the job was cancelled. You can still read everything here.";
export const THREAD_CANCELLED_TOAST =
  "This job was cancelled, so the conversation is closed and the message wasn't sent.";

/**
 * Pick the honest pair for a thread. `jobStatus` is the job's status as the
 * inbox loaded it; anything that is not an explicit `cancelled` falls back to
 * the completion copy, which is the only other way a thread can close today.
 */
export function threadClosedCopy(jobStatus: string | null | undefined): {
  notice: string;
  toast: string;
} {
  return jobStatus === "cancelled"
    ? { notice: THREAD_CANCELLED_NOTICE, toast: THREAD_CANCELLED_TOAST }
    : { notice: THREAD_CLOSED_NOTICE, toast: THREAD_CLOSED_TOAST };
}

/**
 * Slack for a refusal that lands a moment before the closing instant in
 * server time: request latency between the refused INSERT and the fresh
 * `server_now` read. Clock skew itself is corrected, not tolerated.
 */
export const REFUSAL_LATENCY_MS = 5_000;

/** server clock − device clock, from the last `server_now` the RPC returned. */
let serverClockOffsetMs = 0;

/**
 * Record the server clock. `deviceNowAtReceipt` is the device time the reply
 * arrived; the offset ignores the (small) request latency.
 */
export function syncServerClock(serverNow: string, deviceNowAtReceipt: number = Date.now()): void {
  const t = Date.parse(serverNow);
  if (!Number.isNaN(t)) serverClockOffsetMs = t - deviceNowAtReceipt;
}

/** Current time on the server's clock, as best this device knows it. */
export function serverNow(): number {
  return Date.now() + serverClockOffsetMs;
}

/** Test seam. */
export function resetServerClock(): void {
  serverClockOffsetMs = 0;
}

export function isThreadClosed(
  closesAt: string | null | undefined,
  now: number = serverNow(),
): boolean {
  if (!closesAt) return false;
  const t = Date.parse(closesAt);
  if (Number.isNaN(t)) return false;
  return now >= t;
}

/** True when a refused send is best explained by the lockout. */
export function isLockoutRefusal(
  error: { code?: string } | null | undefined,
  closesAt: string | null | undefined,
  now: number = serverNow(),
): boolean {
  if (!error || error.code !== "42501") return false;
  return isThreadClosed(closesAt, now + REFUSAL_LATENCY_MS);
}

/**
 * Closing instant per job id, for completed jobs the caller is a party to.
 * A job absent from the map is not on a lockout clock. Also syncs the server
 * clock from the reply.
 *
 * PGRST202 (RPC not deployed yet) returns an empty map without reporting: the
 * gate ships in the same migration, so "no RPC" also means "no lockout".
 * Any other error is reported and degrades to an empty map; the server still
 * enforces the lockout, and the send path explains a refusal.
 */
export async function fetchMessagingClosesAt(
  jobIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (ids.length === 0) return out;
  // The RPC caps a call at 500 ids; the inbox never holds that many threads,
  // but chunk anyway so a heavy account degrades to more calls, not no notice.
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.rpc("get_messaging_closes_at", {
      _job_ids: ids.slice(i, i + 500),
    });
    if (error) {
      if ((error as { code?: string }).code !== "PGRST202") {
        report(error, {
          severity: "warning",
          tags: { source: "messagingLockout.fetchMessagingClosesAt" },
        });
      }
      return out;
    }
    const received = Date.now();
    for (const row of (data ?? []) as Array<{
      job_id: string | null;
      closes_at: string | null;
      server_now?: string | null;
    }>) {
      if (row?.server_now) syncServerClock(row.server_now, received);
      if (row?.job_id && row?.closes_at) out.set(row.job_id, row.closes_at);
    }
  }
  return out;
}
