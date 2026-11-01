/**
 * The hand-over from the entry's Home reads (src/boot/homePrefetch.ts). The entry must never import this file, and only
 * useFirstJobState (FirstJobHome.tsx) does, so it stays in Home's own chunk.
 *
 * Handed out ONCE (a refetch must reach the server), only for the member it was read for, and only while fresh.
 * Anything else is null, and the query reads Supabase as it always did.
 */

/** Same string as HOME_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhHomePrefetch";
/** An answer older than this is not handed out: the query asks afresh. */
export const HOME_PREFETCH_MAX_AGE_MS = 30_000;

export interface HomeFirstJobAnswer {
  appCount: number;
  jobCount: number;
  prefs: { job_matches?: boolean | null; email_job_matches?: boolean | null } | null;
}

type Slot = { at: number; userId: string; answer: Promise<unknown> };

/** Only the shape we read: a wrong answer must fall back, not paint. */
function usable(a: unknown): HomeFirstJobAnswer | null {
  const x = a as Partial<HomeFirstJobAnswer> | null;
  const ok = !!x && typeof x === "object" && typeof x.appCount === "number" && typeof x.jobCount === "number" &&
    (x.prefs === null || (typeof x.prefs === "object" && x.prefs !== undefined));
  return ok ? (x as HomeFirstJobAnswer) : null;
}

export async function takeHomeFirstJobPrefetch(userId: string, now: number = Date.now()): Promise<HomeFirstJobAnswer | null> {
  const w = window as unknown as Record<string, Slot | undefined>;
  const s = w[KEY];
  w[KEY] = undefined;
  if (!s || now - s.at > HOME_PREFETCH_MAX_AGE_MS || s.userId !== userId) return null;
  return usable(await s.answer);
}
