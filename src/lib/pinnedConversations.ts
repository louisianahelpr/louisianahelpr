/**
 * pinnedConversations — per-user pin/unpin for message threads.
 *
 * Server source of truth is `public.thread_pins` (migration
 * 20260811120000). A "thread" is the (job_id, otherUserId) pair derived from
 * rows in `public.messages` — there is no conversation table — so this mirrors
 * `threadMutes.ts` and its owner-only RLS shape.
 *
 * This used to be sessionStorage-only, with a comment explaining that a real
 * cross-device pin "would need schema + RLS work that's out of scope". The
 * consequence was that pinning a thread and force-quitting lost it, and a pin
 * never followed the user to another device — the affordance looked real and
 * quietly wasn't. That schema now exists.
 *
 * ── Why the read API is still synchronous ──────────────────────────────
 * The inbox sorts pinned threads to the top inside a `useMemo`, which cannot
 * await. So the module keeps an in-memory cache: `loadPins()` fills it from
 * the server once per session, and `getPinnedSet()` reads it synchronously.
 * Callers re-render via the existing pin nonce.
 *
 * ── Local mirror ──────────────────────────────────────────────────────
 * The cache is mirrored to `safeStorage` (durable — Capacitor Preferences on
 * device), NOT sessionStorage. That gives correct pins on the very first
 * paint after a cold launch, before the server round-trip lands, and keeps the
 * toggle working offline. It is a cache, never a source of truth: a successful
 * server read replaces it wholesale.
 */
import { supabase } from "@/integrations/supabase/client";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";

const STORAGE_KEY_PREFIX = "helpr_pinned_threads_v2_";
/** Pre-server key. Read once so existing session pins aren't yanked away. */
const LEGACY_SESSION_PREFIX = "helpr_pinned_threads_session_";

/** Stable key for one conversation — a job + the other participant. */
export function pinnedKey(jobId: string, otherUserId: string): string {
  return `${jobId}_${otherUserId}`;
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/** In-memory cache, keyed by user id. */
const cache = new Map<string, Set<string>>();

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

function readLocal(userId: string): Set<string> {
  try {
    const raw = safeStorage.getItem(storageKey(userId));
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
    }
    // One-time carry-over from the old session-scoped store.
    if (typeof window !== "undefined") {
      const legacy = window.sessionStorage?.getItem(`${LEGACY_SESSION_PREFIX}${userId}`);
      if (legacy) {
        const arr = JSON.parse(legacy) as unknown;
        if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
      }
    }
  } catch {
    /* corrupt JSON / private mode — treat as no pins */
  }
  return new Set();
}

function writeLocal(userId: string, set: Set<string>): void {
  try {
    safeStorage.setItem(storageKey(userId), JSON.stringify([...set]));
  } catch {
    /* best-effort — quota / private mode */
  }
}

/**
 * Hydrate the cache for a user. Call once when the inbox mounts.
 *
 * Resolves to the pinned set. On any server failure it resolves with the
 * local mirror instead of throwing — a pin list is not worth a blank inbox.
 */
export async function loadPins(userId: string): Promise<Set<string>> {
  if (!userId) return new Set();
  // Seed from the mirror first so the very first paint is right.
  const local = readLocal(userId);
  cache.set(userId, local);

  const { data, error } = await supabase
    .from("thread_pins")
    .select("job_id, other_user_id")
    .eq("user_id", userId);

  if (error) {
    // Never swallow silently (see CLAUDE.md) — but a not-yet-deployed table is
    // an expected, self-healing state, so it isn't worth paging anyone over.
    if (!isMissingTable(error)) {
      report(error, { severity: "warning", tags: { source: "pinnedConversations.loadPins" } });
    }
    return local;
  }

  const server = new Set((data ?? []).map((r) => pinnedKey(r.job_id, r.other_user_id)));
  cache.set(userId, server);
  writeLocal(userId, server);
  return server;
}

/**
 * The full pinned-key set — used by the inbox to sort pinned threads to the
 * top in one synchronous pass. Falls back to the durable mirror when
 * `loadPins` hasn't resolved yet.
 */
export function getPinnedSet(userId: string): Set<string> {
  if (!userId) return new Set();
  const cached = cache.get(userId);
  if (cached) return cached;
  const local = readLocal(userId);
  cache.set(userId, local);
  return local;
}

/**
 * Toggle pin state. Returns the new pinned flag immediately (optimistic) and
 * reconciles with the server in the background.
 *
 * Optimistic on purpose: a pin is a cheap, reversible, per-user preference, so
 * making the row jump instantly is worth more than a spinner. If the write
 * fails the cache is rolled back and the error is reported, so the row snaps
 * back rather than lying about a pin that was never stored.
 */
export function togglePinned(userId: string, jobId: string, otherUserId: string): boolean {
  if (!userId) return false;
  const set = new Set(getPinnedSet(userId));
  const k = pinnedKey(jobId, otherUserId);
  const next = !set.has(k);
  if (next) set.add(k);
  else set.delete(k);
  cache.set(userId, set);
  writeLocal(userId, set);

  void (async () => {
    const { error } = next
      ? await supabase.from("thread_pins").upsert(
          { user_id: userId, job_id: jobId, other_user_id: otherUserId },
          { onConflict: "user_id,job_id,other_user_id" },
        )
      : await supabase
          .from("thread_pins")
          .delete()
          .eq("user_id", userId)
          .eq("job_id", jobId)
          .eq("other_user_id", otherUserId);

    if (error) {
      if (isMissingTable(error)) return; // pre-deploy — the mirror still holds it
      // Roll back so the UI stops claiming a pin the server rejected.
      const rollback = new Set(getPinnedSet(userId));
      if (next) rollback.delete(k);
      else rollback.add(k);
      cache.set(userId, rollback);
      writeLocal(userId, rollback);
      report(error, { severity: "warning", tags: { source: "pinnedConversations.togglePinned" } });
    }
  })();

  return next;
}
