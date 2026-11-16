/**
 * The hand-over from the entry's signed-in /jobs reads (src/boot/jobsPrefetch.ts). The entry must never import this
 * file; only useDashboardData does.
 *
 * Each answer is handed out ONCE (a refetch must reach the server), only for the member it was read for, only while
 * fresh, and only within a short wait (a stalled prefetch must never hold the feed: the query then reads for itself).
 * Anything else is null, and the query reads Supabase as it always did.
 */

/** Same string as JOBS_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhJobsPrefetch";
/** An answer older than this is not handed out: the query asks afresh. */
export const JOBS_PREFETCH_MAX_AGE_MS = 30_000;
/** The longest the query waits on a prefetch still in flight before reading for itself. */
const JOBS_PREFETCH_WAIT_MS = 3_000;

type Row = Record<string, unknown>;
export interface JobsFeedPrefetch {
  rows: Row[];
  /** Present only when the posters' reads also answered, for exactly these ids. */
  posterIds?: string[];
  crewIds?: string[];
  profiles?: Row[];
  stats?: Row[];
  crew?: Row[];
}
export interface JobsCtxPrefetch { fee: Row[]; availability: Row[]; applied: Row[]; blocks: Row[] }

type Part = "feed" | "ctx" | "me";
type Slot = { at: number; userId: string } & Partial<Record<Part, Promise<unknown>>>;

const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

const isRows = (x: unknown): x is Row[] => Array.isArray(x);

function take(part: Part, userId: string, now: number): Promise<unknown> | null {
  const w = window as unknown as Record<string, Slot | undefined>;
  const s = w[KEY];
  if (!s) return null;
  const p = s[part];
  s[part] = undefined;
  if (!s.feed && !s.ctx && !s.me) w[KEY] = undefined;
  if (!p || now - s.at > JOBS_PREFETCH_MAX_AGE_MS || s.userId !== userId) return null;
  return p;
}

/** The feed's first page (and, when they answered, its posters' reads); null means read as always. */
export async function takeJobsFeedPrefetch(userId: string, now: number = Date.now()): Promise<JobsFeedPrefetch | null> {
  const p = take("feed", userId, now);
  if (!p) return null;
  return feedShape(await within(p, JOBS_PREFETCH_WAIT_MS));
}

function feedShape(v: unknown): JobsFeedPrefetch | null {
  const x = v as Partial<JobsFeedPrefetch> | null;
  if (!x || !isRows(x.rows)) return null;
  const posters = isRows(x.profiles) && isRows(x.stats) && isRows(x.crew) && Array.isArray(x.posterIds) && Array.isArray(x.crewIds);
  return posters ? (x as JobsFeedPrefetch) : { rows: x.rows };
}

/** The dashboard context's four reads; null means read as always. */
export async function takeJobsCtxPrefetch(userId: string, now: number = Date.now()): Promise<JobsCtxPrefetch | null> {
  const p = take("ctx", userId, now);
  if (!p) return null;
  return ctxShape(await within(p, JOBS_PREFETCH_WAIT_MS));
}

function ctxShape(v: unknown): JobsCtxPrefetch | null {
  const x = v as Partial<JobsCtxPrefetch> | null;
  return x && isRows(x.fee) && isRows(x.availability) && isRows(x.applied) && isRows(x.blocks) ? (x as JobsCtxPrefetch) : null;
}

/** True when the prefetched posters' reads cover every id the query would ask for (they asked for a superset). */
export function coversPosters(pre: JobsFeedPrefetch, posterIds: readonly string[], crewIds: readonly string[]): boolean {
  if (!pre.posterIds || !pre.crewIds) return false;
  const p = new Set(pre.posterIds);
  const c = new Set(pre.crewIds);
  // A null id (an ownerless job) has no profile to read either way.
  return posterIds.every((id) => typeof id !== "string" || p.has(id)) && crewIds.every((id) => c.has(id));
}

/**
 * useCurrentUser's two reads: the member's own profile row and their admin-role row. maybeSingle() semantics: no row is
 * null, one row is that row, more is left to the query's own read. Admin only on a real `admin` row; any failure
 * means null and the query reads (and fails closed) exactly as before.
 */
export async function takeJobsMePrefetch(userId: string, now: number = Date.now()): Promise<{ profile: Row | null; isAdmin: boolean } | null> {
  const p = take("me", userId, now);
  if (!p) return null;
  return meShape(await within(p, JOBS_PREFETCH_WAIT_MS), userId);
}

function meShape(v: unknown, userId: string): { profile: Row | null; isAdmin: boolean } | null {
  const x = v as { profile?: unknown; admin?: unknown } | null;
  if (!x || !isRows(x.profile) || !isRows(x.admin) || x.profile.length > 1 || x.admin.length > 1) return null;
  const profile = x.profile[0] ?? null;
  if (profile && profile.user_id !== userId) return null;
  return { profile, isAdmin: x.admin[0]?.role === "admin" };
}

/**
 * Builder 2 (speed7, 11-15): the answers that have ALREADY arrived, readable during a render. Signed-in /jobs drew its
 * skeleton first and the cards only in a second render (~450 ms of CPU at 4x on a phone), although the entry's reads had
 * answered before the app's code finished downloading. So each query seeds itself from an answer already in hand
 * (initialData), and the first draw has the cards. This module loads with the page's code, so the .then below is
 * attached before the first render; an answer still in flight is simply not seeded (the query takes it as before).
 */
const settled: Partial<Record<Part, { value: unknown }>> = {};
{
  const s = typeof window === "undefined" ? undefined : (window as unknown as Record<string, Slot | undefined>)[KEY];
  for (const part of ["feed", "ctx", "me"] as const) {
    // A failed read is never seeded: the query reads for itself, as before.
    s?.[part]?.then((value) => { settled[part] = { value }; }, () => undefined);
  }
}

/**
 * The settled answer for `part`, shaped, and accepted by `use`; else undefined. Taken ONCE and only when `use` accepts
 * it (the query's own take then finds nothing), under the same member and freshness rules as take().
 */
function takeSettled<T, U>(part: Part, userId: string, shape: (v: unknown) => T | null, use: (x: T) => U | undefined, now: number): { at: number; value: U } | undefined {
  const s = (window as unknown as Record<string, Slot | undefined>)[KEY];
  const done = settled[part];
  if (!s || !s[part] || !done || now - s.at > JOBS_PREFETCH_MAX_AGE_MS || s.userId !== userId) return undefined;
  const x = shape(done.value);
  const value = x ? use(x) : undefined;
  if (value === undefined) return undefined;
  take(part, userId, now);
  return { at: s.at, value };
}

/** The feed's settled first page turned into what `use` draws (undefined when it cannot: nothing is taken). */
export const takeSettledJobsFeed = <U,>(userId: string, use: (x: JobsFeedPrefetch) => U | undefined, now: number = Date.now()) =>
  takeSettled("feed", userId, feedShape, use, now);
export const takeSettledJobsCtx = <U,>(userId: string, use: (x: JobsCtxPrefetch) => U | undefined, now: number = Date.now()) =>
  takeSettled("ctx", userId, ctxShape, use, now);
export const takeSettledJobsMe = (userId: string, now: number = Date.now()) =>
  takeSettled("me", userId, (v) => meShape(v, userId), (x) => x, now);
