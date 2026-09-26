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

/**
 * Q335 (owner, 2026-09-26): a job's deleted-account thread (otherUserId null,
 * the other party deleted their account) can be archived too. Server-side it
 * is the row with other_user_id NULL (20260926041106, one per user per job);
 * in the key it is this token, which no uuid can equal.
 */
const DELETED_PARTY_KEY = "deleted-account";

/** Stable key for one conversation — a job + the other participant. */
function conversationKey(jobId: string, otherUserId: string | null): string {
  return `${jobId}_${otherUserId === null ? DELETED_PARTY_KEY : otherUserId}`;
}

const UUID_RE = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", "i");

/**
 * Inverse of `conversationKey`, for the local→server merge-up in
 * `loadArchives`. Safe to split on the first `_`: both halves are
 * Postgres uuids (hex digits and hyphens only — never an underscore), so
 * a job/user id pair can't itself contain the separator.
 *
 * Returns null for a key the server could never take, so the merge-up drops
 * it instead of failing the batch on every load. `${job}_null` is the key an
 * app build from before Q335 wrote for a server NULL row (a template literal
 * over null); it means the deleted-account thread.
 */
export function parseConversationKey(key: string): { jobId: string; otherUserId: string | null } | null {
  const i = key.indexOf("_");
  if (i === -1) return null;
  const jobId = key.slice(0, i);
  const other = key.slice(i + 1);
  if (!UUID_RE.test(jobId)) return null;
  if (other === DELETED_PARTY_KEY || other === "null") return { jobId, otherUserId: null };
  return UUID_RE.test(other) ? { jobId, otherUserId: other } : null;
}

/** Per-user map of conversationKey -> ISO timestamp the thread was archived. */
type ArchiveMap = Record<string, string>;

function userScopedKey(userId: string): string {
  return `${STORAGE_KEY}_${userId}`;
}

/** In-memory cache, keyed by user id. */
const cache = new Map<string, ArchiveMap>();

/**
 * Q511: the keys THIS device archived whose server write is not yet
 * confirmed (offline, a failed write, or the pre-deploy windows above).
 *
 * The merge-up used to push EVERY key the device held that the server did
 * not, so a thread restored on another device (server row deleted) was
 * archived again by the first device's stale mirror on its next load, and
 * hidden everywhere. The server is the source of truth for everything it
 * has confirmed; only a pending key is this device's news to push. A
 * local-only key that is not pending was confirmed once and has since left
 * the server (restored elsewhere, or cascaded away), so it is dropped.
 */
function pendingStorageKey(userId: string): string {
  return `${STORAGE_KEY}_pending_${userId}`;
}

function readPending(userId: string): Set<string> {
  try {
    const raw = safeStorage.getItem(pendingStorageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []);
  } catch {
    // Corrupt / unparseable: nothing pending. The worst case is one
    // unconfirmed archive that has to be made again, never a resurrection.
    return new Set();
  }
}

function writePending(userId: string, pending: Set<string>): void {
  try {
    safeStorage.setItem(pendingStorageKey(userId), JSON.stringify([...pending]));
  } catch {
    /* ignore quota / private-mode failures — archiving is best-effort UX */
  }
}

function setPending(userId: string, key: string, on: boolean): void {
  const pending = readPending(userId);
  if (on === pending.has(key)) return;
  if (on) pending.add(key);
  else pending.delete(key);
  writePending(userId, pending);
}

/**
 * Q511: what the merge-up does with each canonical mirror key the server did
 * NOT return. Pure, so the rule is testable without a network.
 *   push: archived here and never confirmed; send it up.
 *   drop: confirmed once, now gone from the server (restored on another
 *         device, or its person/job was deleted); never re-push it.
 * `confirmed` lists pending keys the server already has (the write landed,
 * only its response was lost); they stop being pending.
 */
export function planMergeUp(
  localKeys: Iterable<string>,
  serverKeys: ReadonlySet<string>,
  pending: ReadonlySet<string>,
): { push: string[]; drop: string[]; confirmed: string[] } {
  const push: string[] = [];
  const drop: string[] = [];
  for (const k of localKeys) {
    if (serverKeys.has(k)) continue;
    if (pending.has(k)) push.push(k);
    else drop.push(k);
  }
  const confirmed = [...pending].filter((k) => serverKeys.has(k));
  return { push, drop, confirmed };
}

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
  for (const r of (data ?? []) as { job_id: string; other_user_id: string | null; archived_at: string }[]) {
    server[conversationKey(r.job_id, r.other_user_id)] = r.archived_at;
  }

  // Merge-up: a thread archived while this table didn't exist yet (or
  // before the account's local mirror had ever synced) only lives in
  // `local` — trusting `server` wholesale here would silently DROP it,
  // and the thread would resurface in the inbox with no warning the
  // next time this loads. Push local-only entries up before overwriting
  // the mirror, best-effort (a failed push just means it retries next
  // load — the entry stays in the merged result either way so this
  // session never loses it).
  //
  // Keys are canonicalised first (a pre-Q335 `${job}_null` becomes the
  // deleted-account key) and a key the server could never take is dropped,
  // never re-pushed on every load.
  //
  // Q511: only keys this device archived and never saw confirmed are
  // pushed; a key the server confirmed once and no longer has was restored
  // elsewhere (or cascaded away) and is dropped, so a restore sticks.
  const canonicalLocal = new Map<string, { jobId: string; otherUserId: string | null; archivedAt: string }>();
  for (const [k, archivedAt] of Object.entries(local)) {
    const parsed = parseConversationKey(k);
    if (!parsed) continue;
    canonicalLocal.set(conversationKey(parsed.jobId, parsed.otherUserId), { ...parsed, archivedAt });
  }
  const pending = readPending(userId);
  const plan = planMergeUp(canonicalLocal.keys(), new Set(Object.keys(server)), pending);
  for (const k of plan.confirmed) pending.delete(k);
  // A pending key with no mirror entry was restored here before its write
  // was confirmed; nothing to push.
  for (const k of [...pending]) if (!canonicalLocal.has(k)) pending.delete(k);
  const localOnly = new Map<string, { jobId: string; otherUserId: string | null; archivedAt: string }>();
  for (const k of plan.push) localOnly.set(k, canonicalLocal.get(k)!);
  if (localOnly.size > 0) {
    const toRow = (e: { jobId: string; otherUserId: string | null; archivedAt: string }) => ({
      user_id: userId,
      job_id: e.jobId,
      other_user_id: e.otherUserId,
      archived_at: e.archivedAt,
    });
    const upsert = (rows: ReturnType<typeof toRow>[]) =>
      (supabase.from("thread_archives" as any) as any).upsert(rows, {
        onConflict: "user_id,job_id,other_user_id",
      }) as Promise<{ error: { code?: string } | null }>;
    const code = (e: { code?: string } | null) => e?.code;
    // Rows the server can never accept: the person (or job) no longer exists
    // (23503 — an archive of someone who then deleted their account; their
    // thread is now the deleted-account thread), or a malformed id (22P02).
    const GONE = new Set(["23503", "22P02"]);
    const { error: batchError } = await upsert([...localOnly.values()].map(toRow));
    if (!batchError) for (const k of localOnly.keys()) pending.delete(k);
    // 23502: a deleted-account row (Q335) before 20260926041106 made
    // other_user_id nullable. Deploy lag; the batch retries on the next load.
    if (batchError && !isMissingTable(batchError) && code(batchError) !== "23502") {
      // One bad row fails the whole batch, so the good ones would never
      // sync. Retry row by row and drop only the rows that cannot exist.
      let unexpected: { code?: string } | null = null;
      for (const [k, e] of [...localOnly]) {
        const { error } = await upsert([toRow(e)]);
        if (!error) {
          pending.delete(k);
          continue;
        }
        if (GONE.has(code(error) ?? "")) {
          localOnly.delete(k);
          pending.delete(k);
        }
        else if (code(error) !== "23502" && !isMissingTable(error)) unexpected = error;
      }
      if (unexpected) {
        report(unexpected, { severity: "warning", tags: { source: "archivedConversations.mergeLocalArchives" } });
      }
    }
    for (const [k, e] of localOnly) server[k] = e.archivedAt;
  }
  writePending(userId, pending);

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
  otherUserId: string | null,
): void {
  if (!userId) return;
  const key = conversationKey(jobId, otherUserId);
  const archivedAt = new Date().toISOString();
  const map = { ...getArchiveMap(userId), [key]: archivedAt };
  cache.set(userId, map);
  writeLocal(userId, map);
  // Q511: pending until the server confirms it; only a pending key is pushed
  // by loadArchives' merge-up.
  setPending(userId, key, true);
  emitArchiveChanged();

  void (async () => {
    const { error } = await (supabase.from("thread_archives" as any) as any).upsert(
      { user_id: userId, job_id: jobId, other_user_id: otherUserId, archived_at: archivedAt },
      { onConflict: "user_id,job_id,other_user_id" },
    );
    if (!error) setPending(userId, key, false);
    if (error) {
      if (isMissingTable(error)) return; // pre-deploy — the mirror still holds it
      // Q335 deploy lag: before 20260926041106 other_user_id is NOT NULL
      // (23502). Same self-healing state as a missing table: keep the mirror,
      // and loadArchives' merge-up writes it once the column is nullable.
      if (otherUserId === null && (error as { code?: string }).code === "23502") return;
      const rollback = { ...getArchiveMap(userId) };
      delete rollback[key];
      cache.set(userId, rollback);
      writeLocal(userId, rollback);
      setPending(userId, key, false);
      emitArchiveChanged();
      report(error, { severity: "warning", tags: { source: "archivedConversations.archiveConversation" } });
    }
  })();
}

/** Restore a conversation to the inbox (undo `archiveConversation`). */
export function unarchiveConversation(
  userId: string,
  jobId: string,
  otherUserId: string | null,
): void {
  if (!userId) return;
  const key = conversationKey(jobId, otherUserId);
  const previous = getArchiveMap(userId)[key];
  const map = { ...getArchiveMap(userId) };
  delete map[key];
  cache.set(userId, map);
  writeLocal(userId, map);
  // Q511: a restore cancels any unconfirmed archive of the same thread.
  setPending(userId, key, false);
  emitArchiveChanged();

  void (async () => {
    const base = (supabase.from("thread_archives" as any) as any)
      .delete()
      .eq("user_id", userId)
      .eq("job_id", jobId);
    // Q335: the deleted-account row is other_user_id IS NULL; `.eq(col, null)`
    // would match nothing.
    const { error } = await (otherUserId === null
      ? base.is("other_user_id", null)
      : base.eq("other_user_id", otherUserId));
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
  otherUserId: string | null,
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
