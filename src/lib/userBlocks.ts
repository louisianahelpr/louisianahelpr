import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * Returns the set of user IDs that the current user has blocked,
 * plus user IDs that have blocked the current user.
 * Either side of the block hides the other.
 */
export async function getBlockedUserIds(currentUserId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${currentUserId},blocked_id.eq.${currentUserId}`);

  // FAIL CLOSED. Returning an empty set on error reads as "nobody is blocked",
  // so a failed read silently un-blocks every harassment block the user has
  // set: blocked people reappear in the inbox, the nav badge, the applicant
  // list and the desktop rail. Throwing keeps the caller's error path — and
  // its existing loading/error UI — in charge of what to show.
  if (error) {
    report(error, { severity: "warning", tags: { source: "userBlocks.getBlockedUserIds" } });
    throw error;
  }
  if (!data) return new Set();

  const ids = new Set<string>();
  for (const row of data) {
    if (row.blocker_id === currentUserId) ids.add(row.blocked_id);
    if (row.blocked_id === currentUserId) ids.add(row.blocker_id);
  }
  return ids;
}

/**
 * Quickly check if two specific users are blocked in either direction.
 */
export async function areUsersBlocked(userA: string, userB: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("are_users_blocked", {
    _user_a: userA,
    _user_b: userB,
  });
  if (error) return false;
  return !!data;
}

/**
 * Block a user. Optionally cancels any active job between the two users.
 * Returns true on success.
 */
export async function blockUser(
  blockerId: string,
  blockedId: string,
  reason?: string,
): Promise<{ ok: boolean; cancelledJobIds: string[]; error?: string }> {
  // Insert block (unique constraint prevents duplicates)
  const { error: insertErr } = await supabase
    .from("user_blocks")
    .insert({ blocker_id: blockerId, blocked_id: blockedId, reason: reason || null });

  if (insertErr && !insertErr.message?.includes("duplicate")) {
    return { ok: false, cancelledJobIds: [], error: insertErr.message };
  }

  // Find any active jobs between the two users. Surface a lookup failure
  // (previously the error was dropped) — if we can't enumerate the jobs we
  // can't auto-cancel them, so it must be observable rather than silent.
  const { data: activeJobs, error: activeJobsErr } = await supabase
    .from("jobs")
    .select("id, title, customer_id, helper_id, budget, date_needed, status")
    .or(
      `and(customer_id.eq.${blockerId},helper_id.eq.${blockedId}),and(customer_id.eq.${blockedId},helper_id.eq.${blockerId})`,
    )
    .in("status", ["accepted", "in_progress", "revision_requested"]);

  if (activeJobsErr) {
    report(activeJobsErr, { severity: "warning", tags: { source: "userBlocks.activeJobsLookup" } });
  }

  const cancelledJobIds: string[] = [];
  if (activeJobs && activeJobs.length > 0) {
    for (const job of activeJobs) {
      const { error: cancelErr } = await supabase
        .from("jobs")
        .update({
          status: "cancelled",
          cancelled_by: blockerId,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: "User blocked — auto-cancelled",
          cancellation_fee: 0,
          cancellation_fee_status: null,
        })
        .eq("id", job.id);
      if (cancelErr) {
        // A job that failed to cancel is a live job with someone the user just
        // blocked — surface it instead of silently swallowing the error.
        report(cancelErr, { severity: "warning", tags: { source: "userBlocks.autoCancelJob", jobId: job.id } });
      } else {
        cancelledJobIds.push(job.id);
      }
    }
    // Refunds are NOT triggered here. void-cancelled-payments only accepts a
    // cron/service-role bearer, so a client invoke with the user's JWT always
    // 401s. The scheduled cron already sweeps every cancelled + escrow job
    // (its "Part A"), so escrow on these auto-cancelled jobs is refunded on the
    // next run — no client call needed.
  }

  return { ok: true, cancelledJobIds };
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  return !error;
}
