/**
 * ONE SOURCE FOR "UNREAD" IN MESSAGES (lead decision 2026-10-31, NOID-20 "unread counts disagree").
 * The nav badge counted unread received MESSAGES (up to 1000) while the inbox built its threads from only the newest
 * 200 messages and marked threads: 3 unread messages in one thread read "3" on the badge and one dot in the inbox,
 * and an unread message older than the newest 200 lifted the badge while no inbox thread showed it.
 * Now both read the same rows through the same rules:
 *  - `unreadRowsQuery`: the unread messages sent to me (newest UNREAD_ROW_CAP), which the inbox also merges into its
 *    newest-200 window, so every thread the badge counts is a thread the inbox shows;
 *  - `inboxShowsRow`: the inbox's hide rules (system rows, rows the server hid from me, blocked senders);
 *  - `groupThreads`: the inbox's thread key (job + the other person; one Team thread per user);
 *  - `unreadConversationCount`: the badge = the number of those threads with at least one unread message to me,
 *    after the local archive (the same `isArchived` the inbox applies).
 * Guard: src/test/unreadBadgeCountsInboxThreads.test.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import { isArchived } from "@/lib/archivedConversations";
import { isTeamThreadKey, normalizeMessageRow, teamUserIdFromKey } from "@/lib/teamThread";

/** PD-012: bounded. The nav shows "9+" and the icon badge a number, so the newest this many unread rows suffice. */
export const UNREAD_ROW_CAP = 1000;

/** The columns the rules below read; the badge selects only these, the inbox selects "*". */
export const UNREAD_ROW_COLUMNS = "id, job_id, sender_id, receiver_id, created_at, read, is_system, flagged_hidden, team_thread_user_id";

export type ThreadRow = {
  job_id: string;
  sender_id: string | null;
  receiver_id: string | null;
  created_at: string;
  read?: boolean | null;
  is_system?: boolean | null;
  flagged_hidden?: boolean | null;
};

/** The unread messages sent to `uid`, newest first (index idx_messages_receiver_unread). */
export function unreadRowsQuery(uid: string, columns: string = UNREAD_ROW_COLUMNS) {
  return supabase
    .from("messages")
    .select(columns)
    .eq("receiver_id", uid)
    .eq("read", false)
    .not("is_system", "is", true)
    .order("created_at", { ascending: false })
    .limit(UNREAD_ROW_CAP); // PD-012 bounded
}

/** The inbox's hide rules for one row (fetchConversations). */
export function inboxShowsRow(m: ThreadRow, uid: string, blockedSet: ReadonlySet<string>): boolean {
  // System messages (sender_id IS NULL) never drive the conversation list: they belong inside the thread view only,
  // so they never inflate unread counts or appear as the "last message" preview.
  if (m.is_system) return false;
  // A message the server hid (scan_message_content sets flagged_hidden on off-platform contact info) never surfaces
  // to the RECIPIENT; the SENDER still sees what they wrote (the thread queries' `sender_id.eq.<me>,flagged_hidden.eq.false`).
  if (m.flagged_hidden && m.sender_id !== uid) return false;
  // Q1591(b): a "Louisiana Helpr Team" row is delivered through a block, both ways.
  if (isTeamThreadKey(m.job_id)) return true;
  const other = m.sender_id === uid ? m.receiver_id : m.sender_id;
  // Q262: null = the other party deleted their account (receiver_id SET NULL). Nobody to be blocked with.
  return other === null || !blockedSet.has(other);
}

export type ThreadGroup<M> = { otherUserId: string | null; jobId: string; messages: M[] };

/** The inbox's threads: rows (newest first, team rows normalized) grouped by job + the other person. */
export function groupThreads<M extends ThreadRow>(rows: readonly M[], uid: string): Map<string, ThreadGroup<M>> {
  // Q262: `otherUserId: null` is the deleted-account thread for this job. Its map key uses a token no uuid can equal;
  // the value keeps the real null.
  const convoMap = new Map<string, ThreadGroup<M>>();
  for (const m of rows) {
    const other: string | null = m.sender_id === uid ? m.receiver_id : m.sender_id;
    // A team thread is ONE thread per user however many staff wrote in it, so it is keyed by its sentinel alone. Its
    // "other" is the thread's user on the staff side, and the staff member on the newest row on the user's.
    const teamUser = teamUserIdFromKey(m.job_id);
    if (teamUser !== null) {
      const teamOther = teamUser === uid ? other : teamUser;
      const entry = convoMap.get(m.job_id);
      if (!entry) convoMap.set(m.job_id, { otherUserId: teamOther, jobId: m.job_id, messages: [m] });
      else {
        entry.messages.push(m);
        // Newest row first, but a deleted staff account leaves the user's own reply with receiver_id NULL (SET NULL):
        // take the newest staff member still there, so the thread never reads as a deleted account while another
        // admin can still answer (review 2026-10-09 #1).
        if (entry.otherUserId === null && teamOther !== null) entry.otherUserId = teamOther;
      }
      continue;
    }
    const key = `${m.job_id}_${other === null ? "deleted-account" : other}`;
    if (!convoMap.has(key)) convoMap.set(key, { otherUserId: other, jobId: m.job_id, messages: [] });
    convoMap.get(key)!.messages.push(m);
  }
  return convoMap;
}

/** Unread messages to `uid` in one thread: the inbox row's `unread`. */
export function threadUnread(messages: readonly ThreadRow[], uid: string): number {
  return messages.filter((m) => m.receiver_id === uid && !m.read).length;
}

/**
 * THE BADGE: how many conversations the inbox shows with at least one unread message to `uid`. Rows are any set that
 * holds every unread row (the badge passes unreadRowsQuery's; the inbox's own list holds the same rows). A thread
 * the user archived stays out unless a newer message resurfaced it, measured on the thread's newest row in hand.
 */
export function unreadConversationCount(
  rows: ReadonlyArray<Omit<ThreadRow, "job_id"> & { job_id: string | null; team_thread_user_id?: string | null }>,
  uid: string,
  blockedSet: ReadonlySet<string>,
): number {
  const shown = rows.map(normalizeMessageRow).filter((m) => inboxShowsRow(m, uid, blockedSet));
  let n = 0;
  for (const t of groupThreads(shown, uid).values()) {
    if (threadUnread(t.messages, uid) === 0) continue;
    const lastAt = t.messages.reduce((a, m) => (m.created_at > a ? m.created_at : a), t.messages[0].created_at);
    if (isArchived(uid, t.jobId, t.otherUserId, lastAt)) continue;
    n++;
  }
  return n;
}
