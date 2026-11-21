/**
 * clearedConversations — the "Delete for me" half of a member's thread_archives
 * row (`cleared_before`, migration 20261120201223; owner-approved polish
 * 2026-11-20).
 *
 * Every message in a thread created at or before the member's `cleared_before`
 * is hidden from THAT member only. Nothing is deleted on the server: the other
 * person still has the whole thread, and every message row is kept (disputes,
 * reports). A message newer than the clear brings the thread back with only
 * what came after it.
 *
 * Its own module, beside archivedConversations.ts (which writes it: the server
 * read in loadArchives and deleteConversationForMe), so the readers — the
 * inbox grouping and the nav badge (unreadConversations.groupThreads), the open
 * thread's query (useMessagesData.threadRows) and the Archived view — share one
 * synchronous cache, the same local-mirror-first shape as the archive map.
 */
import { safeStorage } from "@/lib/safeStorage";
import { isTeamThreadKey } from "@/lib/teamThread";

/**
 * Fired when the set of cleared threads changes (this device cleared one, or a
 * server read brought one in from another device). A clear changes which
 * MESSAGES a thread holds, not just whether it is listed, so the inbox refetches
 * its threads on this (useMessagesData).
 */
export const CLEARED_CHANGED_EVENT = "helpr:cleared-changed";

export function emitClearedChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CLEARED_CHANGED_EVENT));
  }
}

/** conversationKey (archivedConversations) -> ISO `cleared_before`. */
export type ClearMap = Record<string, string>;

const STORAGE_PREFIX = "helpr_archived_conversations_cleared_";
const clearCache = new Map<string, ClearMap>();

function readLocal(userId: string): ClearMap {
  try {
    const raw = safeStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ClearMap) : {};
  } catch {
    // Corrupt / unparseable: treat as nothing cleared (the next server read corrects it).
    return {};
  }
}

/** The member's clear map: the in-memory cache, else the durable mirror (first paint, offline). */
export function getClearMap(userId: string): ClearMap {
  if (!userId) return {};
  const cached = clearCache.get(userId);
  if (cached) return cached;
  const local = readLocal(userId);
  clearCache.set(userId, local);
  return local;
}

/** Replace the member's clear map (cache + mirror). Server-authoritative callers only. */
export function setClearMap(userId: string, map: ClearMap): void {
  clearCache.set(userId, map);
  try {
    safeStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode failures — the server row is the source of truth */
  }
}

/** Same thread key as archivedConversations.conversationKey (job + other party, or the deleted-account token). */
function key(jobId: string, otherUserId: string | null): string {
  return `${jobId}_${otherUserId === null ? "deleted-account" : otherUserId}`;
}

/** The "delete for me" moment of a thread, or null when nothing was cleared. */
export function clearedBefore(userId: string, jobId: string, otherUserId: string | null): string | null {
  if (!userId || isTeamThreadKey(jobId)) return null;
  return getClearMap(userId)[key(jobId, otherUserId)] ?? null;
}

/**
 * True when a message (or a thread's latest message) at `createdAt` is hidden
 * from `userId` by their "delete for me" of the thread. On a thread's `lastAt`
 * it means "nothing newer than the clear": the thread is gone from the member's
 * side and is never listed in Archived.
 */
export function isClearedMessage(
  userId: string,
  jobId: string,
  otherUserId: string | null,
  createdAt: string,
): boolean {
  const cleared = clearedBefore(userId, jobId, otherUserId);
  if (!cleared) return false;
  const at = new Date(createdAt).getTime();
  const cut = new Date(cleared).getTime();
  return Number.isFinite(at) && Number.isFinite(cut) ? at <= cut : false;
}
