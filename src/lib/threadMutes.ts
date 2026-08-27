/**
 * threadMutes — per-user mute toggle (and time-bound snooze) for message
 * threads.
 *
 * Server source of truth lives in `public.thread_mutes` (migrations
 * 20260609100000 + 20260609150000). A "thread" is the (job_id,
 * otherUserId) pair derived from rows in `public.messages`; muting that
 * pair only affects the calling user — the other participant is
 * unaffected.
 *
 * Mute kinds:
 *   • forever — `mute_until` is NULL; the row stays until explicit unmute.
 *   • snoozed — `mute_until` is a future timestamptz; treated as muted
 *     until that moment, then automatically falls back to unmuted.
 *
 * Each helper ships a graceful fallback for PGRST202 ("function not
 * found"), because migrations don't auto-deploy: between merge and the
 * manual `supabase db push` the feature simply degrades to a binary
 * forever-mute rather than crashing every Messages render.
 *
 * Local fallback storage: when the RPC is unavailable we mirror the
 * mute state (and its TTL) to `safeStorage` so the toggle still feels
 * real on the user's device. The fallback is keyed per (user_id,
 * job_id, other_user_id) and is *not* a source of truth.
 */
import { supabase } from "@/integrations/supabase/client";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";

const STORAGE_KEY = "helpr_muted_threads_v2";
// Legacy key from before the snooze TTL existed — migrated lazily on
// first read so existing forever-mutes don't snap back to unmuted.
const LEGACY_STORAGE_KEY = "helpr_muted_threads_v1";

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

type LocalMute = {
  /** ISO timestamp when the mute ends. `null` means forever. */
  until: string | null;
};
type LocalMap = Record<string, LocalMute>;

function readLocalMap(): LocalMap {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as LocalMap;
      }
    }
    // Lazy migration from v1 (array of keys, all forever-mute).
    const legacy = safeStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy) as unknown;
      if (Array.isArray(arr)) {
        const map: LocalMap = {};
        for (const k of arr) {
          if (typeof k === "string") map[k] = { until: null };
        }
        try {
          safeStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        } catch { /* best-effort */ }
        return map;
      }
    }
    return {};
  } catch {
    return {};
  }
}

function writeLocalMap(map: LocalMap): void {
  try {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore — best-effort */
  }
}

/** Treat an expired snooze as un-muted. */
function isLiveMute(entry: LocalMute | undefined): boolean {
  if (!entry) return false;
  if (entry.until === null) return true;
  const ms = Date.parse(entry.until);
  return Number.isFinite(ms) && ms > Date.now();
}

export type MuteState = {
  /** True when the thread is currently muted (or snoozed-not-yet-expired). */
  muted: boolean;
  /** ISO timestamp when the snooze ends; `null` for forever-mute, also
   *  `null` when unmuted. */
  until: string | null;
};

/**
 * Toggle the mute state for one thread for the current user.
 *
 * Returns the new state. On RPC-not-deployed (PGRST202) we fall back to
 * local-storage only so the toggle feels real ahead of the manual db push.
 * A snoozed thread that's toggled off clears the snooze too.
 */
export async function toggleThreadMute(
  userId: string,
  jobId: string,
  otherUserId: string,
): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("toggle_thread_mute", {
    _job_id: jobId,
    _other_user_id: otherUserId,
  });

  if (error) {
    if (isMissingRpc(error)) {
      // Pre-deploy fallback — mirror the toggle into local storage.
      const map = readLocalMap();
      const k = localKey(userId, jobId, otherUserId);
      const wasMuted = isLiveMute(map[k]);
      if (wasMuted) delete map[k];
      else map[k] = { until: null };
      writeLocalMap(map);
      return !wasMuted;
    }
    throw error;
  }

  // Mirror server truth into local fallback. Toggle always sets forever
  // when it goes on (the RPC matches that semantic).
  const map = readLocalMap();
  const k = localKey(userId, jobId, otherUserId);
  if (data === true) map[k] = { until: null };
  else delete map[k];
  writeLocalMap(map);

  return data === true;
}

/**
 * Snooze a thread until the given future timestamp. `null` mutes forever.
 * Returns the resolved `until` timestamp the server (or local fallback)
 * settled on, so the caller can render "Muted for 8h" copy without a
 * follow-up read.
 */
export async function snoozeThread(
  userId: string,
  jobId: string,
  otherUserId: string,
  until: Date | null,
): Promise<string | null> {
  const untilIso = until ? until.toISOString() : null;
  const { data, error } = await (supabase.rpc as any)("set_thread_snooze", {
    _job_id: jobId,
    _other_user_id: otherUserId,
    _until: untilIso,
  });

  if (error) {
    if (isMissingRpc(error)) {
      // Pre-deploy fallback — record the snooze locally so it feels real.
      const map = readLocalMap();
      const k = localKey(userId, jobId, otherUserId);
      if (until && until.getTime() <= Date.now()) {
        delete map[k];
        writeLocalMap(map);
        return null;
      }
      map[k] = { until: untilIso };
      writeLocalMap(map);
      return untilIso;
    }
    throw error;
  }

  // Mirror server truth into local fallback.
  const map = readLocalMap();
  const k = localKey(userId, jobId, otherUserId);
  const serverUntil = typeof data === "string" ? data : null;
  // `set_thread_snooze` returns NULL only when the snooze was cleared
  // by passing a past timestamp. When passed a future ts it returns
  // that ts; when passed NULL it returns NULL (forever-mute).
  if (until === null) {
    map[k] = { until: null };
  } else if (until.getTime() > Date.now()) {
    map[k] = { until: serverUntil ?? untilIso };
  } else {
    delete map[k];
  }
  writeLocalMap(map);

  return serverUntil ?? (until ? untilIso : null);
}

/**
 * Explicit unmute — clears any mute (forever or snoozed) for one thread.
 */
export async function unmuteThread(
  userId: string,
  jobId: string,
  otherUserId: string,
): Promise<void> {
  const { error } = await (supabase.rpc as any)("clear_thread_mute", {
    _job_id: jobId,
    _other_user_id: otherUserId,
  });
  if (error && !isMissingRpc(error)) throw error;
  const map = readLocalMap();
  const k = localKey(userId, jobId, otherUserId);
  delete map[k];
  writeLocalMap(map);
}

/**
 * Fetch the muted subset of a list of (job, other) thread pairs for the
 * current user — single round-trip. Falls back to the local-storage set
 * when the bulk RPC isn't deployed yet (PGRST202).
 *
 * Returns a `Map` keyed by `${jobId}::${otherUserId}` whose value is the
 * resolved `MuteState` (muted bool + until). Callers can cheaply check
 * `muteMap.get(threadKey)?.muted` per row.
 */
export async function getMutedThreadMap(
  userId: string,
  pairs: Array<{ jobId: string; otherUserId: string }>,
): Promise<Map<string, MuteState>> {
  if (!userId || pairs.length === 0) return new Map();
  const localMap = readLocalMap();
  const localResolved = new Map<string, MuteState>();
  for (const p of pairs) {
    const entry = localMap[localKey(userId, p.jobId, p.otherUserId)];
    if (isLiveMute(entry)) {
      localResolved.set(`${p.jobId}::${p.otherUserId}`, {
        muted: true,
        until: entry!.until,
      });
    }
  }

  const { data, error } = await (supabase.rpc as any)("get_muted_threads", {
    _pairs: pairs.map((p) => ({ job_id: p.jobId, other_user_id: p.otherUserId })),
  });

  if (error) {
    // A missing RPC is the expected pre-deploy state — the local fallback IS
    // the answer there, so stay quiet. Any OTHER failure is indistinguishable
    // from "nothing is muted": every server-side mute badge silently
    // disappears and muted threads start notifying again. Same fallback, but
    // no longer invisible.
    if (!isMissingRpc(error)) {
      report(error, {
        severity: "warning",
        tags: { source: "threadMutes.get_muted_threads" },
        context: { pair_count: pairs.length },
      });
    }
    return localResolved;
  }

  const result = new Map<string, MuteState>();
  type Row = {
    job_id: string;
    other_user_id: string;
    mute_until?: string | null;
  };
  const rows = (data ?? []) as Row[];
  for (const row of rows) {
    result.set(`${row.job_id}::${row.other_user_id}`, {
      muted: true,
      until: row.mute_until ?? null,
    });
  }
  // Reconcile local mirror against authoritative server answer.
  const fresh = readLocalMap();
  for (const p of pairs) {
    const k = localKey(userId, p.jobId, p.otherUserId);
    const sk = `${p.jobId}::${p.otherUserId}`;
    const state = result.get(sk);
    if (state) fresh[k] = { until: state.until };
    else delete fresh[k];
  }
  writeLocalMap(fresh);

  return result;
}

/**
 * Back-compat shim: prior callers wanted a Set<threadKey>. Derives one
 * from the richer `getMutedThreadMap`. New code should call
 * `getMutedThreadMap` directly to access the `until` timestamp.
 */
export async function getMutedThreadSet(
  userId: string,
  pairs: Array<{ jobId: string; otherUserId: string }>,
): Promise<Set<string>> {
  const map = await getMutedThreadMap(userId, pairs);
  return new Set([...map.keys()]);
}

/**
 * Stable thread-key helper for callers using the returned Set/Map above.
 */
export function threadMuteKey(jobId: string, otherUserId: string): string {
  return `${jobId}::${otherUserId}`;
}

/**
 * Render-ready "Muted for 8h" / "Muted until 8:00 AM tomorrow" etc.
 * label for the chat header. Returns `null` for forever-mute (callers
 * fall back to a plain "Muted" pill) or when the thread is not muted.
 */
export function snoozeRemainingLabel(until: string | null): string | null {
  if (!until) return null;
  const ms = Date.parse(until) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `Muted for ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Muted for ${hours}h`;
  const days = Math.round(hours / 24);
  return `Muted for ${days}d`;
}

/**
 * Snooze preset options surfaced in the mute picker. Each option
 * resolves to a future Date (or `null` for "forever") computed AT
 * SELECTION TIME so a stale option list doesn't drift past midnight.
 */
export type SnoozePreset = {
  /** Stable id for the option list — used as a React key. */
  id: "1h" | "8h" | "tomorrow" | "forever";
  label: string;
  resolveUntil: () => Date | null;
};

export const SNOOZE_PRESETS: SnoozePreset[] = [
  {
    id: "1h",
    label: "For 1 hour",
    resolveUntil: () => new Date(Date.now() + 60 * 60 * 1000),
  },
  {
    id: "8h",
    label: "For 8 hours",
    resolveUntil: () => new Date(Date.now() + 8 * 60 * 60 * 1000),
  },
  {
    id: "tomorrow",
    label: "Until tomorrow 8 AM",
    resolveUntil: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
      return d;
    },
  },
  {
    id: "forever",
    label: "Until I turn it back on",
    resolveUntil: () => null,
  },
];
