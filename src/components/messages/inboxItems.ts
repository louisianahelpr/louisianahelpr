/**
 * F420 (whole-app audit 2026-11-10): one inbox list, two kinds of row. A job thread, or a Declutter order chat
 * (declutter_my_order_talks). "Show every conversation under All, newest first, with job and Declutter rows mixed."
 * Pure helpers for ConversationListBody (which only renders); tested in declutterOrderTalkInbox.test.tsx.
 */
import type { OrderTalkListRow } from "@/lib/declutter/orderTalk";
import { pinnedKey as pinKeyOf } from "@/lib/pinnedConversations";
import { orderTalkRowTitle, type OrderTalkInbox } from "./DeclutterOrderTalkInbox";
import type { Conversation } from "./types";

export type InboxItem = { kind: "thread"; c: Conversation } | { kind: "order"; row: OrderTalkListRow };

const itemAt = (it: InboxItem): number => Date.parse(it.kind === "thread" ? it.c.lastAt : it.row.last_at) || 0;

/**
 * The rows in the order they are drawn: pinned threads first, as before (useConversationListState puts them at the
 * head of `threads`), then every other thread and every order chat together, newest first. Threads keep their own
 * order among equals (stable sort), so a list without order chats is drawn exactly as it was.
 */
export function mixInboxItems(threads: readonly Conversation[], orderTalks: readonly OrderTalkListRow[], pinned: ReadonlySet<string>): InboxItem[] {
  if (orderTalks.length === 0) return threads.map((c) => ({ kind: "thread", c }));
  let head = 0;
  while (head < threads.length) {
    const c = threads[head];
    if (c.otherUserId === null || !pinned.has(pinKeyOf(c.jobId, c.otherUserId))) break;
    head += 1;
  }
  const rest: InboxItem[] = [
    ...threads.slice(head).map((c): InboxItem => ({ kind: "thread", c })),
    ...orderTalks.map((row): InboxItem => ({ kind: "order", row })),
  ].sort((a, b) => itemAt(b) - itemAt(a));
  return [...threads.slice(0, head).map((c): InboxItem => ({ kind: "thread", c })), ...rest];
}

export const inboxItemKey = (it: InboxItem): string =>
  it.kind === "order" ? `order_${it.row.order_id}` : `${it.c.jobId}_${it.c.otherUserId}`;

/**
 * Which order chats sit in the view being drawn. They follow the same two controls the threads follow: the status tab
 * (Active = chats whose order is still open; Any status = all of them) and the search box (matched on the item's name,
 * which is all the row knows). None in select mode (nothing to pin, hide or delete on an order chat), nor under
 * Pinned / Recently Deleted, which read stores the order chats are not in.
 */
export function visibleOrderTalks(
  orderTalks: OrderTalkInbox | null,
  view: { selectMode: boolean; isSpecialFilterView: boolean; inboxTab: string; searchQuery: string },
): OrderTalkListRow[] {
  if (!orderTalks || view.selectMode || view.isSpecialFilterView) return [];
  const byTab = view.inboxTab === "active" ? orderTalks.rows.filter((r) => r.open) : orderTalks.rows;
  const q = view.searchQuery.trim().toLowerCase();
  return q ? byTab.filter((r) => orderTalkRowTitle(r).toLowerCase().includes(q)) : byTab;
}
