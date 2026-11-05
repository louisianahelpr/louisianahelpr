/**
 * The hand-over from the entry's item-page reads (src/boot/declutterItemPrefetch.ts, B100 Q2708). The entry must never
 * import this file, nor this file the boot module (see guestJobsPrefetch.ts for why).
 *
 * fetchItem and fetchPhotos (api.ts) each take their part ONCE (a refetch must reach the server), only for the item
 * and the member it was read for, and only while fresh. `undefined` means nothing to hand over, and that read asks
 * Supabase as it always did; an item answer of null means the row policies returned no row (the page's "not found").
 */

/** Same string as DECLUTTER_ITEM_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhDeclutterItemPrefetch";
/** An answer older than this is not handed out: the page asks afresh. */
export const DECLUTTER_ITEM_PREFETCH_MAX_AGE_MS = 30_000;

type Part = "item" | "photos";
/** userId null: read as a guest (the anonymous role), handed only to a page with no session. */
type Slot = { at: number; userId: string | null; itemId: string; taken?: Set<Part> } & Record<Part, Promise<unknown[] | null>>;
type Member = string | null | undefined | (() => Promise<string | null | undefined>);

async function take(part: Part, itemId: string, member: Member, now: number): Promise<unknown[] | undefined> {
  const s = (window as unknown as Record<string, Slot | undefined>)[KEY];
  if (!s || s.itemId !== itemId || now - s.at > DECLUTTER_ITEM_PREFETCH_MAX_AGE_MS || s.taken?.has(part)) return undefined;
  const userId = typeof member === "function" ? await member() : member;
  // A member's answer only to that member; a guest's (userId null) only to a page with no session.
  if (s.userId === null ? userId != null : !userId || userId !== s.userId) return undefined;
  s.taken ??= new Set();
  if (s.taken.has(part)) return undefined;
  s.taken.add(part);
  const rows = await s[part];
  return Array.isArray(rows) ? rows : undefined;
}

/** The item's row (null: no row for this member), once; undefined when there is nothing to hand over. */
export async function takeItemPrefetch(itemId: string, member: Member, now: number = Date.now()): Promise<unknown | null | undefined> {
  const rows = await take("item", itemId, member, now);
  if (!rows || rows.length > 1) return undefined;
  return rows[0] ?? null;
}

/** The item's photo rows (in position order), once; undefined when there is nothing to hand over. */
export async function takeItemPhotosPrefetch(itemId: string, member: Member, now: number = Date.now()): Promise<unknown[] | undefined> {
  return take("photos", itemId, member, now);
}
