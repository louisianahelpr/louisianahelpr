import type { Conversation } from "./types";

/** Derived inbox summary — the "N threads" count and the unread total. */
export interface ThreadCountSummary {
  /** `"3 threads"` / `"1 thread"`, or `null` when the chip must be hidden.
   *  Hidden while `loading` is true and on an empty inbox: during the first
   *  load `conversations` is still `[]` while `loading` is true, so keying
   *  the chip off length alone flashes "0 threads" and then snaps to the
   *  real count. Deliberately NOT gated on a load error — a failed refresh
   *  still leaves the previously-loaded threads on screen, so the count has
   *  to keep matching what's rendered. */
  countLabel: string | null;
  /** Sum of the per-thread inbound `unread` counters. */
  totalUnread: number;
  /** `"5 unread"`, or `null` while loading / when nothing is unread. */
  unreadLabel: string | null;
}

/**
 * Single source of truth for the Messages inbox header labels.
 *
 * Two surfaces render this same summary — `ConversationList`'s mobile
 * PageScaffold title card and `MessagesTitleCard` (the desktop split's
 * bar spanning both panes). They used to compute the count string, the
 * singular/plural rule, and the loading gate independently, which is
 * exactly how the two headers drift apart. Both now call this.
 */
export function threadCountSummary(
  conversations: Conversation[],
  loading: boolean,
): ThreadCountSummary {
  const count = conversations.length;
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
  return {
    countLabel:
      !loading && count > 0 ? `${count} ${count === 1 ? "thread" : "threads"}` : null,
    totalUnread,
    unreadLabel: !loading && totalUnread > 0 ? `${totalUnread} unread` : null,
  };
}
