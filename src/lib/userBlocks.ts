import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, isWriteRejected } from "@/lib/mutationResult";

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

/** One live job the block settled, as reported by the server. */
export interface SettledJob {
  job_id: string;
  title: string | null;
  cancellation_fee: number;
  fee_percent: number;
}

/**
 * Block a user, settling any live shared job through the REAL cancellation
 * path — server-side, in a single transaction.
 *
 * This used to insert the block and then write `jobs` FROM THE BROWSER:
 * status='cancelled', cancellation_fee: 0, cancellation_fee_status: null, and
 * no call to the consequence ladder at all. The escrow was never actually at
 * risk — void-cancelled-payments recomputes the fee from budget/date_needed/
 * cancelled_at and ignores the persisted column — but the row lied to every
 * reader of it, and the reliability STRIKE was skipped outright, which made
 * "block the Helpr" a one-tap late cancel with no consequence.
 *
 * `block_user_and_settle` owns all of it now: same fee ladder, the other
 * party notified, the strike recorded through
 * apply_cancellation_violation_consequence.
 *
 * There is deliberately NO client-side fallback. A client-side cancel is the
 * exact thing being removed, so if the RPC is unavailable (PGRST202 during the
 * merge→deploy window) the block is reported as failed rather than half-done.
 */
export async function blockUser(
  blockerId: string,
  blockedId: string,
  reason?: string,
): Promise<{ ok: boolean; cancelledJobIds: string[]; settled: SettledJob[]; error?: string }> {
  void blockerId; // the server takes the blocker from auth.uid(), never from the client
  const { data, error } = await supabase.rpc(
    "block_user_and_settle" as never,
    { p_blocked: blockedId, p_reason: reason?.trim() || null } as never,
  );

  if (error) {
    report(error, { severity: "warning", tags: { source: "userBlocks.blockUserAndSettle" } });
    const message =
      String((error as { code?: string }).code ?? "") === "PGRST202"
        ? "Blocking is briefly unavailable while an update finishes deploying. Please try again in a minute."
        : error.message || "Couldn't block this person — try again?";
    return { ok: false, cancelledJobIds: [], settled: [], error: message };
  }

  const settled = ((data as { settled?: SettledJob[] } | null)?.settled ?? []) as SettledJob[];
  return { ok: true, cancelledJobIds: settled.map((s) => s.job_id), settled };
}

/**
 * Lift a block. Returns false — and reports — unless a row actually went away.
 *
 * The `.select("id")` is load-bearing. A DELETE matching zero rows is
 * `{ data: [], error: null }`, so `return !error` reported SUCCESS for a delete
 * RLS refused, or one whose ids no longer matched. For a harassment control
 * that is wrong in both directions at once: the caller drops the person off the
 * blocked list and tells the user they are reconnected, while the block is
 * still in force on the server and every list keeps filtering them out. Unlike
 * the `getBlockedUserIds` read above, there is no fail-closed reading of a
 * silent no-op here — it has to be observed.
 */
export async function unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
  try {
    unwrapMutation(
      await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", blockerId)
        .eq("blocked_id", blockedId)
        .select("id"),
      { action: "unblock this person", context: { blockerId, blockedId } },
    );
    return true;
  } catch (err) {
    // unwrapMutation already reported the zero-row rejection; this covers the
    // transport / RLS error that unwrap() rethrows unreported.
    if (!isWriteRejected(err)) {
      report(err, { severity: "warning", tags: { source: "userBlocks.unblockUser" } });
    }
    return false;
  }
}
