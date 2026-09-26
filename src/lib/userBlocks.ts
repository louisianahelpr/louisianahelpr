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
/**
 * How long a SUCCESSFUL read is reused. A signed-in boot mounts the dashboard
 * feed and the nav badge within a second of each other; sharing only while a
 * read was in flight was timing-dependent (prod-audit runs 36213595709 and
 * 36214629782 measured 1 and 2 boot reads for the same walk). Two seconds
 * covers the boot and nothing a person does.
 */
export const BLOCK_READ_REUSE_MS = 2_000;
type BlockRead = { read: Promise<BlockRows>; settledAt: number | null };
const blockReads = new Map<string, BlockRead>();

/**
 * The `user_blocks` rows either side of `currentUserId`, as the raw
 * `{ data, error }` result, read ONCE for everyone who asks within the same
 * moment (Q330): callers share an in-flight read, and a successful read is
 * reused for BLOCK_READ_REUSE_MS after it lands. It never outlives that:
 *   - a successful blockUser / unblockUser drops it at once, so the person
 *     who blocked never sees their own block late (found by the
 *     lh-silent-failure review of this change);
 *   - a failed read is never reused: the next caller asks again and gets its
 *     own error (getBlockedUserIds throws; the dashboard feed reports and
 *     continues, see Q573).
 * The one thing that can arrive up to 2 s later than before is a block made
 * by the OTHER person, well inside the time realtime takes to say so.
 */
function forgetBlockRead(userId: string): void {
  blockReads.delete(userId);
}

export function readUserBlockRows(currentUserId: string, now: number = Date.now()): Promise<BlockRows> {
  const held = blockReads.get(currentUserId);
  if (held && (held.settledAt === null || now - held.settledAt <= BLOCK_READ_REUSE_MS)) return held.read;
  const entry: BlockRead = { read: Promise.resolve(null as unknown as BlockRows), settledAt: null };
  entry.read = Promise.resolve(
    supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${currentUserId},blocked_id.eq.${currentUserId}`),
  )
    .then(({ data, error }) => ({ data, error }))
    .then(
      (res) => {
        // Only its OWN entry: after a block dropped it, a newer read may hold the slot.
        if (blockReads.get(currentUserId) === entry) {
          if (res.error) blockReads.delete(currentUserId);
          else entry.settledAt = Date.now();
        }
        return res;
      },
      (err: unknown) => {
        if (blockReads.get(currentUserId) === entry) blockReads.delete(currentUserId);
        throw err;
      },
    );
  blockReads.set(currentUserId, entry);
  return entry.read;
}

/** Test-only. */
export function __resetBlockReadsForTests(): void {
  blockReads.clear();
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
  // id is used here only to drop this user's held block read.
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
  forgetBlockRead(blockerId);
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
    forgetBlockRead(blockerId);
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
