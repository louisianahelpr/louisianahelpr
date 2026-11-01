/**
 * The hand-over from the entry's /declutter tab-row reads (src/boot/declutterMinePrefetch.ts, B81 2026-11-01). The
 * entry must never import this file, nor this file the boot module (see guestJobsPrefetch.ts for why).
 *
 * Each read (fetchMyCart, fetchMyOffers, fetchMyItems in api.ts) takes its own part ONCE (a refetch must reach the
 * server), only for the member it was read for, and only while fresh. Anything else is null, and that read asks
 * Supabase as it always did.
 */

/** Same string as DECLUTTER_MINE_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhDeclutterMinePrefetch";
/** An answer older than this is not handed out: the page asks afresh. */
export const DECLUTTER_MINE_PREFETCH_MAX_AGE_MS = 30_000;

export type MinePart = "cart" | "offers" | "items";
type Slot = { at: number; userId: string; taken?: Set<MinePart | "questions">; questions?: Promise<{ ids: string[]; rows: unknown[] } | null> } & Record<
  MinePart,
  Promise<unknown[] | null>
>;

/** The prefetched rows for `part`, once, for `userId`, while fresh; null otherwise (the caller reads for itself). */
export async function takeMinePrefetch(
  part: MinePart,
  /** The member, or a reader of the signed-in member (asked only when there is an answer to hand out). */
  member: string | null | undefined | (() => Promise<string | null | undefined>),
  now: number = Date.now(),
): Promise<unknown[] | null> {
  const s = (window as unknown as Record<string, Slot | undefined>)[KEY];
  if (!s || now - s.at > DECLUTTER_MINE_PREFETCH_MAX_AGE_MS || s.taken?.has(part)) return null;
  const userId = typeof member === "function" ? await member() : member;
  if (!userId || s.userId !== userId) return null;
  s.taken ??= new Set();
  if (s.taken.has(part)) return null;
  s.taken.add(part);
  const rows = await s[part];
  return Array.isArray(rows) ? rows : null;
}

/**
 * B82: the unanswered questions read for exactly these listing ids (sorted, as useUnansweredQuestions asks), once, for
 * `userId`, while fresh; null otherwise (a different set of listings asks the server).
 */
export async function takeMineQuestions(
  itemIds: string[],
  member: string | null | undefined | (() => Promise<string | null | undefined>),
  now: number = Date.now(),
): Promise<unknown[] | null> {
  const s = (window as unknown as Record<string, Slot | undefined>)[KEY];
  if (!s?.questions || now - s.at > DECLUTTER_MINE_PREFETCH_MAX_AGE_MS || s.taken?.has("questions")) return null;
  const userId = typeof member === "function" ? await member() : member;
  if (!userId || userId !== s.userId) return null;
  s.taken ??= new Set();
  if (s.taken.has("questions")) return null;
  s.taken.add("questions");
  const got = await s.questions;
  return got && got.ids.join(",") === [...itemIds].sort().join(",") ? got.rows : null;
}
