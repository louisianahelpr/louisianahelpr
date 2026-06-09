/**
 * pinnedConversations — session-scoped pin/unpin for message threads.
 *
 * iMessage / Slack convention: a small set of conversations sticks to
 * the top of the inbox so they're easy to find. There's no server-side
 * conversation table to flag pins on (threads on Helpr are derived
 * from `public.messages` rows), and a true cross-device pin would need
 * schema + RLS work that's out of scope for this polish pass. So we
 * keep it lightweight: pins live in **sessionStorage**, scoped per user
 * id. That keeps the affordance present this session without polluting
 * cross-device state — the next launch starts fresh.
 *
 * If/when a server-side `thread_pins` table arrives, this module
 * becomes the local fallback (mirrors `threadMutes.ts`).
 */

const STORAGE_KEY_PREFIX = "helpr_pinned_threads_session_";

/** Stable key for one conversation — a job + the other participant. */
export function pinnedKey(jobId: string, otherUserId: string): string {
  return `${jobId}_${otherUserId}`;
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function safeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readSet(userId: string): Set<string> {
  const store = safeSessionStorage();
  if (!store) return new Set();
  try {
    const raw = store.getItem(storageKey(userId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) {
      return new Set(arr.filter((x): x is string => typeof x === "string"));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function writeSet(userId: string, set: Set<string>): void {
  const store = safeSessionStorage();
  if (!store) return;
  try {
    store.setItem(storageKey(userId), JSON.stringify([...set]));
  } catch {
    /* best-effort — quota / private-mode */
  }
}

/** True when the given conversation is currently pinned for the user. */
export function isPinned(
  userId: string,
  jobId: string,
  otherUserId: string,
): boolean {
  if (!userId) return false;
  return readSet(userId).has(pinnedKey(jobId, otherUserId));
}

/**
 * Get the full pinned-key set for the user — used by the inbox to sort
 * pinned threads to the top in one pass.
 */
export function getPinnedSet(userId: string): Set<string> {
  if (!userId) return new Set();
  return readSet(userId);
}

/** Toggle pin state. Returns the new pinned flag. */
export function togglePinned(
  userId: string,
  jobId: string,
  otherUserId: string,
): boolean {
  if (!userId) return false;
  const set = readSet(userId);
  const k = pinnedKey(jobId, otherUserId);
  const next = !set.has(k);
  if (next) set.add(k);
  else set.delete(k);
  writeSet(userId, set);
  return next;
}
