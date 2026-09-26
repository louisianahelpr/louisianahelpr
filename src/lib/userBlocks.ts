import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { unwrapMutation, isWriteRejected } from "@/lib/mutationResult";

/**
 * Returns the set of user IDs that the current user has blocked,
 * plus user IDs that have blocked the current user.
 * Either side of the block hides the other.
 */
type BlockRows = { data: { blocker_id: string; blocked_id: string }[] | null; error: PostgrestError | null };
const blockReadsInFlight = new Map<string, Promise<BlockRows>>();

/**
 * The `user_blocks` rows either side of `currentUserId`, as the raw
 * `{ data, error }` result. CONCURRENT callers share ONE request (Q330: on a
 * signed-in boot the dashboard feed and the nav badge each read it in the
 * same moment, measured 2 reads per boot; the Messages inbox shares it too).
 * Nothing is kept once it settles, so this is not a cache, and a successful
 * blockUser / unblockUser drops the in-flight read (forgetInFlightBlockRead)
 * so a reader that starts AFTER the write never joins a read that began
 * before it. Every caller gets the same `{ data, error }` it got before and
 * handles it as before (getBlockedUserIds throws on error; the dashboard feed
 * reports and continues, see Q573).
 */
/** A block or unblock just committed: the next reader must ask afresh. */
function forgetInFlightBlockRead(userId: string): void {
  blockReadsInFlight.delete(userId);
}

export function readUserBlockRows(currentUserId: string): Promise<BlockRows> {
  const pending = blockReadsInFlight.get(currentUserId);
  if (pending) return pending;
  const read: Promise<BlockRows> = Promise.resolve(
    supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${currentUserId},blocked_id.eq.${currentUserId}`),
  )
    .then(({ data, error }) => ({ data, error }))
    // Only its OWN entry: after a block dropped it, a newer read may hold the slot.
    .finally(() => {
      if (blockReadsInFlight.get(currentUserId) === read) blockReadsInFlight.delete(currentUserId);
    });
  blockReadsInFlight.set(currentUserId, read);
  return read;
}

export async function getBlockedUserIds(currentUserId: string): Promise<Set<string>> {
  const { data, error } = await readUserBlockRows(currentUserId);

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
  // The server takes the blocker from auth.uid(), never from the client; the
  // id is used here only to drop this user's in-flight block read.
  // `p_reason` is OMITTED rather than passed as null when blank. The SQL
  // declares `p_reason text DEFAULT NULL` and the body coalesces it to '', so
  // omitting is byte-for-byte the same call — and it is expressible in the
  // generated `Args` (`p_reason?: string`), which an explicit null is not.
  const { data, error } = await supabase.rpc("block_user_and_settle", {
    p_blocked: blockedId,
    p_reason: reason?.trim() || undefined,
  });

  if (error) {
    report(error, { severity: "warning", tags: { source: "userBlocks.blockUserAndSettle" } });
    const message =
      String((error as { code?: string }).code ?? "") === "PGRST202"
        ? "Blocking is briefly unavailable while an update finishes deploying. Please try again in a minute."
        : (rpcErrorMessage("block_user_and_settle", error) ?? (error.message || "Couldn't block this person — try again?"));
    return { ok: false, cancelledJobIds: [], settled: [], error: message };
  }

  const settled = ((data as { settled?: SettledJob[] } | null)?.settled ?? []) as SettledJob[];
  // The blocked person reaches the blocker's list only through blocker_id, so
  // the blocker's read is the one that must not be joined (Q330 shared read).
  forgetInFlightBlockRead(blockerId);
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
    forgetInFlightBlockRead(blockerId);
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
