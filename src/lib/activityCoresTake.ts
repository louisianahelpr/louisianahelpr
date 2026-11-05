/**
 * The hand-over from the entry's get_my_activity_cores read (src/boot/activityCoresPrefetch.ts, B100 Q2708). The entry
 * must never import this file, nor this file the boot module (see guestJobsPrefetch.ts for why).
 *
 * Taken ONCE (a refetch must reach the server), only for the member it was read for, and only while fresh; null
 * otherwise, and fetchActivityCores asks Supabase as it always did.
 */

/** Same string as ACTIVITY_CORES_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhActivityCoresPrefetch";
/** An answer older than this is not handed out: the read asks afresh. */
export const ACTIVITY_CORES_PREFETCH_MAX_AGE_MS = 30_000;

/**
 * The boot read's answers, one per core. On most links both are the SAME promise (one call, every key). On a
 * Posted-first link (Q2706) they are two calls, p_parts {posted} and {applied}, each carrying only its part's keys.
 */
export type ActivityCoresPrefetchAnswers = { posted: Promise<unknown>; applied: Promise<unknown> };
type Slot = { at: number; userId: string } & ActivityCoresPrefetchAnswers;

/** The boot read's answers (still promises; they may be in flight), once, for `userId`, while fresh; null otherwise. */
export function takeActivityCoresPrefetch(userId: string, now: number = Date.now()): ActivityCoresPrefetchAnswers | null {
  const w = window as unknown as Record<string, Slot | undefined>;
  const s = w[KEY];
  if (!s || s.userId !== userId || now - s.at > ACTIVITY_CORES_PREFETCH_MAX_AGE_MS) return null;
  w[KEY] = undefined;
  return { posted: s.posted, applied: s.applied };
}
