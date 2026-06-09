/**
 * threadMutes — per-user mute toggle for message threads.
 *
 * Server source of truth lives in `public.thread_mutes` (migration
 * 20260609100000). A "thread" is the (job_id, otherUserId) pair derived
 * from rows in `public.messages`; muting that pair only affects the
 * calling user — the other participant is unaffected.
 *
 * The toggle / bulk-lookup / single-thread predicate are all RPCs so a
 * single round-trip serves the inbox. Each helper ships a graceful
 * fallback for PGRST202 ("function not found"), because migrations don't
 * auto-deploy: between merge and the manual `supabase db push` the
 * feature simply no-ops rather than crashing every Messages render.
 *
 * Local fallback storage: when the RPC is unavailable we mirror the mute
 * state to `safeStorage` so the toggle still feels real on the user's
 * device. The fallback is keyed per (user_id, job_id, other_user_id) and
 * is *not* a source of truth — it just keeps the optimistic toggle from
 * snapping back to "unmuted" if the user backgrounds the app.
 */
import { supabase } from "@/integrations/supabase/client";
import { safeStorage } from "@/lib/safeStorage";

const STORAGE_KEY = "helpr_muted_threads_v1";

/** True when the Supabase RPC error code means "function not deployed". */
function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "PGRST202";
}

/** Stable composite key — mirrors the (user, job, other) tuple. */
function localKey(userId: string, jobId: string, otherUserId: string): string {
  return `${userId}::${jobId}::${otherUserId}`;
}

function readLocalSet(): Set<string> {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function writeLocalSet(set: Set<string>): void {
  try {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore — best-effort */
  }
}

/**
 * Toggle the mute state for one thread for the current user.
 *
 * Returns the new state (true = muted, false = unmuted). On
 * RPC-not-deployed (PGRST202) we fall back to local-storage only so the
 * toggle feels real ahead of the manual db push.
 */
export async function toggleThreadMute(
  userId: string,
  jobId: string,
  otherUserId: string,
): Promise<boolean> {
  // Prefer server. The RPC owns the canonical state and returns the new
  // muted bool atomically so the UI can reconcile without a follow-up read.
  //
  // Cast through `any` until the next `supabase gen types` lands — these
  // RPCs are added in migration 20260609100000 which hasn't been
  // reflected in `src/integrations/supabase/types.ts` yet. The runtime
  // shape (a single boolean) is exact.
  const { data, error } = await (supabase.rpc as any)("toggle_thread_mute", {
    _job_id: jobId,
    _other_user_id: otherUserId,
  });

  if (error) {
    if (isMissingRpc(error)) {
      // Pre-deploy fallback — mirror the toggle into local storage.
      const set = readLocalSet();
      const k = localKey(userId, jobId, otherUserId);
      const wasMuted = set.has(k);
      if (wasMuted) set.delete(k);
      else set.add(k);
      writeLocalSet(set);
      return !wasMuted;
    }
    throw error;
  }

  // Mirror server truth into local fallback so the inbox can render the
  // muted bell while the bulk RPC is still in-flight on next mount.
  const set = readLocalSet();
  const k = localKey(userId, jobId, otherUserId);
  if (data === true) set.add(k);
  else set.delete(k);
  writeLocalSet(set);

  return data === true;
}

/**
 * Fetch the muted subset of a list of (job, other) thread pairs for the
 * current user — single round-trip. Falls back to the local-storage set
 * when the bulk RPC isn't deployed yet (PGRST202).
 *
 * Returns a `Set<string>` keyed by `${jobId}::${otherUserId}` so callers
 * can do `mutedSet.has(threadKey)` cheaply per row.
 */
export async function getMutedThreadSet(
  userId: string,
  pairs: Array<{ jobId: string; otherUserId: string }>,
): Promise<Set<string>> {
  if (!userId || pairs.length === 0) return new Set();
  const localSet = readLocalSet();
  const localMuted = new Set(
    pairs
      .filter((p) => localSet.has(localKey(userId, p.jobId, p.otherUserId)))
      .map((p) => `${p.jobId}::${p.otherUserId}`),
  );

  // Same RPC-type-cast story as `toggle_thread_mute` above — both ship
  // in migration 20260609100000 and aren't yet in the generated types.
  const { data, error } = await (supabase.rpc as any)("get_muted_threads", {
    _pairs: pairs.map((p) => ({ job_id: p.jobId, other_user_id: p.otherUserId })),
  });

  if (error) {
    if (isMissingRpc(error)) {
      // RPC not deployed yet — fall back to local mirror.
      return localMuted;
    }
    // Other errors: keep the inbox rendering. Return whatever the local
    // mirror knows about; a transient network hiccup shouldn't blank the
    // muted-bell affordance on already-muted threads.
    return localMuted;
  }

  const set = new Set<string>();
  const rows = (data ?? []) as Array<{ job_id: string; other_user_id: string }>;
  for (const row of rows) {
    set.add(`${row.job_id}::${row.other_user_id}`);
  }
  // Reconcile local mirror to match the server's authoritative answer
  // for the pairs we just queried (drop any local-only mutes the server
  // says aren't muted; keep ones it confirms).
  const fresh = readLocalSet();
  for (const p of pairs) {
    const k = localKey(userId, p.jobId, p.otherUserId);
    if (set.has(`${p.jobId}::${p.otherUserId}`)) fresh.add(k);
    else fresh.delete(k);
  }
  writeLocalSet(fresh);

  return set;
}

/**
 * Stable thread-key helper for callers using the returned Set above.
 */
export function threadMuteKey(jobId: string, otherUserId: string): string {
  return `${jobId}::${otherUserId}`;
}
