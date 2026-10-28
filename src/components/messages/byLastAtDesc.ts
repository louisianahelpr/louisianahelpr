import type { Conversation } from "./types";

// Sort comparator (descending by lastAt) — pulled out so the pinned /
// unpinned partitions both use the exact same ordering rule. Moved out of
// ConversationList (its size ratchet).
export function byLastAtDesc(a: Conversation, b: Conversation): number {
  return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
}
