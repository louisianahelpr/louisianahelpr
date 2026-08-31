/**
 * archivedConversations — per-user "hide from my inbox" for message threads.
 *
 * Server source of truth is `public.thread_archives` (migration
 * 20260831011232). A "thread" is the (job_id, otherUserId) pair derived from
 * rows in `public.messages` — there is no conversation table — so this
 * mirrors `pinnedConversations.ts` exactly, including its owner-only RLS
 * shape, its local-mirror-first read pattern, and its optimistic write.
 *
 * This used to be safeStorage-only, with the honest caveat that "a true
 * server-side archive would need schema/RLS work that is out of scope".
 * The consequence was that hiding a thread on one device never followed the
 * account anywhere else — the "Recently Deleted" view on a different device
 * simply couldn't see what this device had hidden. That schema now exists.
 *
 * Conversations on Helpr are derived purely from rows in `public.messages`;
 * a true server-side archive still can't touch the messages themselves — a
 * true DELETE conversation was rejected here for the same reason it was
 * rejected in the old local-only version (see the old "delete conversation"
 * incident this replaced: it deleted the user's OWN sent messages and left
 * the thread fully visible to the other person, a confusing, misleading
 * half-delete). This stays an honest hide: nothing is deleted, the thread
 * resurfaces automatically once a message newer than the archive moment
 * arrives, and it can be restored explicitly at any time.
 *
 * ── Why the read API is still synchronous ──────────────────────────────
 * The inbox filters archived threads out of a `useMemo`, which cannot await.
 * So the module keeps an in-memory cache: `loadArchives()` fills it from the
 * server once per session, and `getArchiveMap()` reads it synchronously.
 * Callers re-render via ARCHIVE_CHANGED_EVENT (unchanged from the local-only
 * version).
 *
 * ── Local mirror ──────────────────────────────────────────────────────
 * The cache is mirrored to `safeStorage` (durable — Capacitor Preferences on
 * device), NOT sessionStorage. That gives correct archive state on the very
 * first paint after a cold launch, before the server round-trip lands, and
 * keeps hide/restore working offline. It is a cache, never a source of
 * truth: a successful server read replaces it wholesale.
 */
import { supabase } from "@/integrations/supabase/client";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";

const STORAGE_KEY = "helpr_archived_conversations";

/**
 * Window event fired whenever the archive set changes. Archiving/restoring
 * is now a server round-trip (optimistic locally first), but the write
 * still fires no `messages` realtime event, so the nav unread badge —
 * which excludes archived threads — would otherwise stay stale until the
 * next message arrives. The badge listens for this to recompute
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

/** In-memory cache, keyed by user id. */
const cache = new Map<string, ArchiveMap>();

/**
 * True when the table isn't deployed yet.
 *
 * Migrations auto-deploy on merge, but there is a window between the code
 * landing and the deploy finishing (and a red deploy widens it). PGRST205 is
 * PostgREST's "table not found"; 42P01 is Postgres's. Either means the same
 * thing here: fall back to the local mirror rather than breaking the inbox.
 */
function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "PGRST205" || code === "42P01";
}

function readLocal(userId: string): ArchiveMap {
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

function writeLocal(userId: string, map: ArchiveMap): void {
  try {
    safeStorage.setItem(userScopedKey(userId), JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode failures — archiving is best-effort UX */
  }
}

/**
 * Hydrate the cache for a user. Call once when the inbox mounts.
 *
 * Resolves to the archive map. On any server failure it resolves with the
 * local mirror instead of throwing — an archive list is not worth a blank
 * inbox.
 */
export async function loadArchives(userId: string): Promise<ArchiveMap> {
  if (!userId) return {};
  // Seed from the mirror first so the very first paint is right.
  const local = readLocal(userId);
  cache.set(userId, local);

  // `thread_archives` isn't in the generated Supabase types yet (migration
  // lag — see supabase/migrations/20260831011232_add_thread_archives.sql),
  // same `as any` pattern pinnedConversations.ts used for thread_pins
  // before types were regenerated.
  const { data, error } = await (supabase.from("thread_archives" as any) as any)
    .select("job_id, other_user_id, archived_at")
    .eq("user_id", userId);

  if (error) {
    // Never swallow silently (see CLAUDE.md) — but a not-yet-deployed table
    // is an expected, self-healing state, so it isn't worth paging anyone
    // over.
    if (!isMissingTable(error)) {
      report(error, { severity: "warning", tags: { source: "archivedConversations.loadArchives" } });
    }
    return local;
  }

  const server: ArchiveMap = {};
  for (const r of (data ?? []) as { job_id: string; other_user_id: string; archived_at: string }[]) {
    server[conversationKey(r.job_id, r.other_user_id)] = r.archived_at;
  }
  cache.set(userId, server);
  writeLocal(userId, server);
  return server;
}

/**
 * The full archive map — used by the inbox to filter archived threads out
 * (and by Recently Deleted to filter them in) in one synchronous pass.
 * Falls back to the durable mirror when `loadArchives` hasn't resolved yet.
 */
function getArchiveMap(userId: string): ArchiveMap {
  if (!userId) return {};
  const cached = cache.get(userId);
  if (cached) return cached;
  const local = readLocal(userId);
  cache.set(userId, local);
  return local;
}

/**
 * Archive (hide) a conversation from the given user's inbox. Optimistic:
 * the local cache/mirror update immediately, the server write reconciles in
 * the background, and a failed write rolls the cache back (see
 * togglePinned's identical shape in pinnedConversations.ts).
 */
export function archiveConversation(
  userId: string,
  jobId: string,
  otherUserId: string,
): void {
  if (!userId) return;
  const key = conversationKey(jobId, otherUserId);
  const archivedAt = new Date().toISOString();
  const map = { ...getArchiveMap(userId), [key]: archivedAt };
  cache.set(userId, map);
  writeLocal(userId, map);
  emitArchiveChanged();

  void (async () => {
    const { error } = await (supabase.from("thread_archives" as any) as any).upsert(
      { user_id: userId, job_id: jobId, other_user_id: otherUserId, archived_at: archivedAt },
      { onConflict: "user_id,job_id,other_user_id" },
    );
    if (error) {
      if (isMissingTable(error)) return; // pre-deploy — the mirror still holds it
      const rollback = { ...getArchiveMap(userId) };
      delete rollback[key];
      cache.set(userId, rollback);
      writeLocal(userId, rollback);
      emitArchiveChanged();
      report(error, { severity: "warning", tags: { source: "archivedConversations.archiveConversation" } });
    }
  })();
}

/** Restore a conversation to the inbox (undo `archiveConversation`). */
export function unarchiveConversation(
  userId: string,
  jobId: string,
  otherUserId: string,
): void {
  if (!userId) return;
  const key = conversationKey(jobId, otherUserId);
  const previous = getArchiveMap(userId)[key];
  const map = { ...getArchiveMap(userId) };
  delete map[key];
  cache.set(userId, map);
  writeLocal(userId, map);
  emitArchiveChanged();

  void (async () => {
    const { error } = await (supabase.from("thread_archives" as any) as any)
      .delete()
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .eq("other_user_id", otherUserId);
    if (error) {
      if (isMissingTable(error)) return; // pre-deploy — the mirror still holds it
      if (previous) {
        const rollback = { ...getArchiveMap(userId), [key]: previous };
        cache.set(userId, rollback);
        writeLocal(userId, rollback);
        emitArchiveChanged();
      }
      report(error, { severity: "warning", tags: { source: "archivedConversations.unarchiveConversation" } });
    }
  })();
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
  const archivedAt = getArchiveMap(userId)[conversationKey(jobId, otherUserId)];
  if (!archivedAt) return false;
  const lastMs = new Date(lastAt).getTime();
  const archivedMs = new Date(archivedAt).getTime();
  // If the latest message predates (or equals) the archive moment, the
  // thread stays hidden. A newer message means it should come back.
  return Number.isFinite(lastMs) && Number.isFinite(archivedMs)
    ? lastMs <= archivedMs
    : true;
}
