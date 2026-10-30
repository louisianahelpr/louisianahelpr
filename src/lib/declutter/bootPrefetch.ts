/**
 * The hand-over from the entry's /declutter prefetch (src/boot/declutterPrefetch.ts). Imported by
 * src/lib/declutter/api.ts ONLY; the entry must never import this file (see the boot module for why).
 */

/** Same string as DECLUTTER_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhDeclutterPrefetch";
/** A prefetch older than this is not handed out: the page asks afresh. */
export const DECLUTTER_PREFETCH_MAX_AGE_MS = 30_000;

type PhotoRead = { ids: string[]; rows: unknown[] } | null;
type Prefetch = { at: number; items?: Promise<unknown[] | null>; photos?: Promise<PhotoRead> };

const slot = (): Prefetch | undefined => (window as unknown as Record<string, Prefetch | undefined>)[KEY];

/** The prefetched live items, ONCE (a refetch must reach the server), or null. */
export function takeDeclutterItemsPrefetch(now: number = Date.now()): Promise<unknown[] | null> | null {
  const p = slot();
  if (!p || now - p.at > DECLUTTER_PREFETCH_MAX_AGE_MS || !p.items) return null;
  const { items } = p;
  p.items = undefined;
  return items;
}

/** The prefetched photos of `itemIds`, ONCE; null when the prefetch did not cover every one of them. */
export async function takeDeclutterPhotosPrefetch(itemIds: string[], now: number = Date.now()): Promise<unknown[] | null> {
  const p = slot();
  if (!p || now - p.at > DECLUTTER_PREFETCH_MAX_AGE_MS || !p.photos) return null;
  const { photos } = p;
  p.photos = undefined;
  const read = await photos;
  if (!read) return null;
  const covered = new Set(read.ids);
  if (!itemIds.every((id) => covered.has(id))) return null;
  const wanted = new Set(itemIds);
  return read.rows.filter((r) => wanted.has((r as { item_id: string }).item_id));
}
