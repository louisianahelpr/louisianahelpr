/**
 * Q262 (owner decision 2026-09-24): when an account is deleted, the messages a
 * surviving user sent TO it are kept. `messages.receiver_id` is nullable with
 * `messages_receiver_id_fkey ... ON DELETE SET NULL`, so a kept message has
 * `receiver_id IS NULL`. (What the deleted user SENT is removed:
 * `messages_sender_id_fkey ... ON DELETE CASCADE`.)
 *
 * In the client that thread's other party is `null` (Conversation.otherUserId).
 * Never coalesce it to "" or any sentinel for a comparison or a query: build
 * the PostgREST pair filter with `threadPairFilter`, which uses `is.null` for
 * the deleted side. Guard: src/test/messagesReceiverNullable.test.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/** Read-only notice that replaces the composer in that thread. Role-neutral. */
export const DELETED_ACCOUNT_NOTICE =
  "This account has been deleted. Your earlier messages are still here, but new messages can't be sent.";

/**
 * The PostgREST `.or()` filter for one thread's messages between `me` and
 * `other`, plus the job's system rows. `other === null` is the deleted-account
 * thread: only what I sent that now has no receiver (the other side's messages
 * were deleted with their account).
 */
export function threadPairFilter(me: string, other: string | null): string {
  if (other === null) {
    return `and(sender_id.eq.${me},receiver_id.is.null),is_system.eq.true`;
  }
  return `and(sender_id.eq.${me},receiver_id.eq.${other}),and(sender_id.eq.${other},receiver_id.eq.${me}),is_system.eq.true`;
}

/** Toast when a send is refused because the other party has just deleted their account (Q334). */
export const DELETED_ACCOUNT_TOAST = "This account has been deleted, so the message wasn't sent.";

/**
 * Q333/Q334: has the other party of this job thread deleted their account?
 * Asked of the server (get_thread_counterparty_deleted), because the client's
 * only local signal, get_safe_profiles returning nobody, is also what a
 * banned, unverified or anonymised person looks like, and calling them
 * "deleted" would be false.
 *
 * Returns true/false from the server, or null when it could not be asked
 * (any error, including PGRST202 before the RPC is deployed): callers keep
 * their existing handling on null, so the fallback is today's behaviour.
 */
export async function fetchCounterpartyDeleted(
  jobId: string,
  otherUserId: string,
): Promise<boolean | null> {
  if (!jobId || !otherUserId) return null;
  const { data, error } = await supabase.rpc("get_thread_counterparty_deleted", {
    _job_id: jobId,
    _other: otherUserId,
  });
  if (error) {
    if ((error as { code?: string }).code !== "PGRST202") {
      report(error, { severity: "warning", tags: { source: "deletedCounterparty.fetchCounterpartyDeleted" } });
    }
    return null;
  }
  return data === true;
}
