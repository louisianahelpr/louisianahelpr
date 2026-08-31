/**
 * archivedConversations — a local "hide from my inbox" for message threads.
 *
 * Conversations on Helpr are derived purely from rows in `public.messages`;
 * there is no per-user conversation table to flag. A true server-side
 * archive would need schema/RLS work that is out of scope here. So instead
 * of the old "delete conversation" action — which only deleted the user's
 * OWN sent messages and left the thread fully visible to the other person
 * (a confusing, misleading model) — we hide the thread *locally*: it is
 * removed from this user's conversation list without touching any message.
 *
 * The hidden set is scoped per user and stored via `safeStorage` (durable
 * across WebKit eviction). A thread un-hides itself automatically the next
 * time a new message arrives in it (the caller checks `isArchived` against
 * the conversation's `lastAt`), so archiving never silently swallows a
 * fresh reply.
 *
 * Each entry records the timestamp the thread was archived AT; a later
 * message (newer `lastAt`) means the conversation should resurface.
 */
import { safeStorage } from "@/lib/safeStorage";

/** `helpr_`-prefixed so safeStorage mirrors it to durable Preferences. */
const STORAGE_KEY = "helpr_archived_conversations";

/**
 * Window event fired whenever the archive set changes. Archiving is a local
 * (safeStorage) action that fires no `messages` realtime event, so the nav
 * unread badge — which excludes archived threads — would otherwise stay stale
 * until the next message arrives. The badge listens for this to recompute
 * immediately (LH-54).
 */
export const ARCHIVE_CHANGED_EVENT = "helpr:archive-changed";

function emitArchiveChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ARCHIVE_CHANGED_EVENT));
  }
}

/** Stable key for one conversation — a job + the other participant. */
function conversationKey(jobId: string, otherUserId: string): string {
  return `${jobId}_${otherUserId}`;
}

/** Per-user map of conversationKey -> ISO timestamp the thread was archived. */
type ArchiveMap = Record<string, string>;

function userScopedKey(userId: string): string {
  return `${STORAGE_KEY}_${userId}`;
}

function readMap(userId: string): ArchiveMap {
  try {
    const raw = safeStorage.getItem(userScopedKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ArchiveMap;
    }
    return {};
  } catch {
    // Corrupt / unparseable — treat as empty rather than crashing the inbox.
    return {};
  }
}

function writeMap(userId: string, map: ArchiveMap): void {
  try {
    safeStorage.setItem(userScopedKey(userId), JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode failures — archiving is best-effort UX */
  }
}

/** Archive (hide) a conversation from the given user's inbox. */
export function archiveConversation(
  userId: string,
  jobId: string,
  otherUserId: string,
): void {
  if (!userId) return;
  const map = readMap(userId);
  map[conversationKey(jobId, otherUserId)] = new Date().toISOString();
  writeMap(userId, map);
  emitArchiveChanged();
}

/** Restore a conversation to the inbox (undo `archiveConversation`). */
export function unarchiveConversation(
  userId: string,
  jobId: string,
  otherUserId: string,
): void {
  if (!userId) return;
  const map = readMap(userId);
  delete map[conversationKey(jobId, otherUserId)];
  writeMap(userId, map);
  emitArchiveChanged();
}

/**
 * True when a conversation is archived AND no newer message has arrived
 * since it was archived. `lastAt` is the conversation's latest-message
 * timestamp — a message newer than the archive moment auto-resurfaces the
 * thread so an archived conversation never hides a fresh reply.
 */
export function isArchived(
  userId: string,
  jobId: string,
  otherUserId: string,
  lastAt: string,
): boolean {
  if (!userId) return false;
  const archivedAt = readMap(userId)[conversationKey(jobId, otherUserId)];
  if (!archivedAt) return false;
  const lastMs = new Date(lastAt).getTime();
  const archivedMs = new Date(archivedAt).getTime();
  // If the latest message predates (or equals) the archive moment, the
  // thread stays hidden. A newer message means it should come back.
  return Number.isFinite(lastMs) && Number.isFinite(archivedMs)
    ? lastMs <= archivedMs
    : true;
}
