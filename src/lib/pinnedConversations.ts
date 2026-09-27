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
import { isGoneReference } from "@/lib/goneReference";
import { planMergeUp } from "@/lib/archivedConversations";

const STORAGE_KEY_PREFIX = "helpr_pinned_threads_v2_";
/** Pre-server key. Read once so existing session pins aren't yanked away. */
const LEGACY_SESSION_PREFIX = "helpr_pinned_threads_session_";

/** Stable key for one conversation — a job + the other participant. */
export function pinnedKey(jobId: string, otherUserId: string): string {
  return `${jobId}_${otherUserId}`;
}

/**
 * Inverse of `pinnedKey`, for the local→server merge-up in `loadPins`. Safe
 * to split on the first `_`: both halves are Postgres uuids (hex digits and
 * hyphens only — never an underscore), so a job/user id pair can't itself
 * contain the separator.
 */
function parsePinnedKey(key: string): { jobId: string; otherUserId: string } | null {
  const i = key.indexOf("_");
  if (i === -1) return null;
  return { jobId: key.slice(0, i), otherUserId: key.slice(i + 1) };
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/** In-memory cache, keyed by user id. */
const cache = new Map<string, Set<string>>();

/**
 * Q813: generation per user. `loadPins` awaits the network, so two loads (or a
 * load and a toggle) can overlap; only the newest may write back, or an older
 * fetch resolving last overwrites newer pins with its stale snapshot.
 */
const loadGen = new Map<string, number>();
const bumpGen = (userId: string) => {
  const gen = (loadGen.get(userId) ?? 0) + 1;
  loadGen.set(userId, gen);
  return gen;
};

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
 * Q512: the pins THIS device made whose server write is not yet confirmed
 * (offline, a failed write, or the pre-deploy window). The merge-up used to
 * push EVERY local-only pin, so an Unpin on one device (server row deleted)
 * was re-pinned by another device's stale mirror on its next load. Only a
 * pending pin is this device's news to push; a local-only pin that is not
 * pending was confirmed once and has since been unpinned elsewhere (or its
 * job/person is gone), so it is dropped. Same rule as the archive store
 * (Q511, planMergeUp).
 */
function pendingStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}pending_${userId}`;
}

function readPending(userId: string): Set<string> {
  try {
    const raw = safeStorage.getItem(pendingStorageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []);
  } catch {
    // Corrupt: nothing pending. The worst case is one unconfirmed pin that
    // has to be made again, never a resurrected one.
    return new Set();
  }
}

function writePending(userId: string, pending: Set<string>): void {
  try {
    safeStorage.setItem(pendingStorageKey(userId), JSON.stringify([...pending]));
  } catch {
    /* best-effort — quota / private mode */
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
 * Hydrate the cache for a user. Call once when the inbox mounts.
 *
 * Resolves to the pinned set. On any server failure it resolves with the
 * local mirror instead of throwing — a pin list is not worth a blank inbox.
 */
export async function loadPins(userId: string): Promise<Set<string>> {
  if (!userId) return new Set();
  const gen = bumpGen(userId);
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

  // Merge-up: a pin made on this device whose write never landed (offline,
  // pre-deploy) only lives in `local` — trusting `server` wholesale here
  // would silently DROP it. Push it up before overwriting the mirror, best-
  // effort (a failed push just means it retries next load — the pin stays
  // in the merged result either way so this session never loses it).
  // Q512: only PENDING pins are pushed; a local-only pin the server once
  // confirmed was unpinned on another device and is dropped, so it stays
  // unpinned.
  const pending = readPending(userId);
  const plan = planMergeUp(local, server, pending);
  for (const k of plan.confirmed) pending.delete(k);
  // A pending key with no mirror entry was unpinned here before its write
  // was confirmed; nothing to push.
  for (const k of [...pending]) if (!local.has(k)) pending.delete(k);
  const localOnlyKeys = plan.push;
  if (localOnlyKeys.length > 0) {
    const rows = localOnlyKeys
      .map((k) => {
        const parsed = parsePinnedKey(k);
        if (!parsed) return null;
        return { user_id: userId, job_id: parsed.jobId, other_user_id: parsed.otherUserId };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const gone = new Set<string>();
    if (rows.length > 0) {
      // ignoreDuplicates (ON CONFLICT DO NOTHING): this table has no UPDATE policy, so a plain upsert on an existing row was refused by RLS. Write-contract audit, 2026-09-12.
      const pushPins = (batch: typeof rows) =>
        supabase
          .from("thread_pins")
          .upsert(batch, { onConflict: "user_id,job_id,other_user_id", ignoreDuplicates: true });
      const { error: mergeError } = await pushPins(rows);
      if (!mergeError) for (const r of rows) pending.delete(pinnedKey(r.job_id, r.other_user_id));
      if (isGoneReference(mergeError)) {
        // One pin to a deleted job fails the whole batch (Sentry JAVASCRIPT-2K,
        // 2026-09-25). Retry one at a time so the live pins still sync, and
        // drop the ones whose job or person is gone.
        for (const row of rows) {
          const { error: rowError } = await pushPins([row]);
          if (!rowError) pending.delete(pinnedKey(row.job_id, row.other_user_id));
          if (isGoneReference(rowError)) {
            gone.add(pinnedKey(row.job_id, row.other_user_id));
            pending.delete(pinnedKey(row.job_id, row.other_user_id));
          }
          else if (rowError && !isMissingTable(rowError)) {
            report(rowError, { severity: "warning", tags: { source: "pinnedConversations.mergeLocalPins" } });
          }
        }
      } else if (mergeError && !isMissingTable(mergeError)) {
        report(mergeError, { severity: "warning", tags: { source: "pinnedConversations.mergeLocalPins" } });
      }
    }
    for (const k of localOnlyKeys) if (!gone.has(k)) server.add(k);
  }
  // A newer load or a toggle started while this one awaited: its state wins.
  if (loadGen.get(userId) !== gen) return getPinnedSet(userId);
  writePending(userId, pending);

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
  bumpGen(userId);
  cache.set(userId, set);
  writeLocal(userId, set);
  // Q512: a pin is pending until the server confirms it; an unpin is never
  // pending (a stale pending pin must not be pushed back up).
  setPending(userId, k, next);

  void (async () => {
    const { error } = next
      ? await supabase.from("thread_pins").upsert(
          { user_id: userId, job_id: jobId, other_user_id: otherUserId },
          { onConflict: "user_id,job_id,other_user_id", ignoreDuplicates: true },
        )
      : await supabase
          .from("thread_pins")
          .delete()
          .eq("user_id", userId)
          .eq("job_id", jobId)
          .eq("other_user_id", otherUserId);

    if (!error) {
      if (next) setPending(userId, k, false);
      return;
    }
    if (isMissingTable(error)) return; // pre-deploy — the mirror (and pending) still holds it
    // Roll back so the UI stops claiming a pin the server rejected.
    const rollback = new Set(getPinnedSet(userId));
    if (next) {
      rollback.delete(k);
      setPending(userId, k, false);
    } else rollback.add(k);
    cache.set(userId, rollback);
    writeLocal(userId, rollback);
    // The thread's job (or person) was deleted while the inbox was open:
    // the pin can never be stored and the rollback above already dropped
    // it, so this is not a fault. Any other error still reports.
    if (isGoneReference(error)) return;
    report(error, { severity: "warning", tags: { source: "pinnedConversations.togglePinned" } });
  })();

  return next;
}
