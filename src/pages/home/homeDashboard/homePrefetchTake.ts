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

/** Same string as HOME_PAGE_PREFETCH_KEY in the boot module (the test pins it). */
const PAGE_KEY = "__lhHomePagePrefetch";
type PageSlot = { at: number; userId: string; page: Promise<{ handle?: unknown; data?: unknown } | null> };

/**
 * public_profile_by_handle's raw answer for the member's own handle, read by the entry beside the app's download
 * (`data` may be null: no page to show). Null when the entry has none for this member and handle, or it is old: the
 * card then reads for itself. Handed out once.
 */
export async function takeHomeOwnPagePrefetch(userId: string, handle: string, now: number = Date.now()): Promise<{ data: unknown } | null> {
  const w = window as unknown as Record<string, PageSlot | undefined>;
  const s = w[PAGE_KEY];
  w[PAGE_KEY] = undefined;
  if (!s || s.userId !== userId || now - s.at > HOME_PREFETCH_MAX_AGE_MS) return null;
  const a = await s.page.catch(() => null);
  return a && a.handle === handle && "data" in a ? { data: a.data } : null;
}
