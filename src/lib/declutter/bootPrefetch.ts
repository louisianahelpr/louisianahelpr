/**
 * The hand-over from the entry's /declutter read (src/boot/declutterPrefetch.ts, public.declutter_first_screen). The
 * entry must never import this file (see the boot module for why).
 *
 * Each query's read takes its own part, ONCE (a refetch must reach the server), and only while it covers everything
 * that read was asked. Anything else is null, and that read asks Supabase as it always did: the answer missing, failed
 * or old (the RPC is not deployed yet), another member's, or a list the answer stopped short of.
 */

/** Same string as DECLUTTER_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhDeclutterPrefetch";
/** An answer older than this is not handed out: the page asks afresh. */
const DECLUTTER_PREFETCH_MAX_AGE_MS = 30_000;

export interface FirstScreenAnswer {
  switches: Record<string, unknown>;
  items: { id: string; seller_id: string; sale_mode: string | null; last_price_drop_on: string | null; drop_pct?: number | null; drops_stopped?: boolean | null }[];
  /** There are more listings than the answer holds, so it can stand in only for the top of the list. */
  more: boolean;
  /** The position the items were sorted from; null = newest first. */
  near: { lat: number; lng: number } | null;
  /** The profile's ZIP and get_parish_for_zip's answer; null when the member has a position, or no ZIP. */
  zip_parish?: { zip: string; parish: string | null } | null;
  photos: { item_id: string }[];
  watching: string[];
  bundle_sellers: string[];
}

type Slot = { at: number; userId: string; answer: Promise<unknown>; taken?: Set<string> };

const slot = (): Slot | undefined => (window as unknown as Record<string, Slot | undefined>)[KEY];

/** Only the shape we read: a wrong answer must fall back, not paint. */
function usable(a: unknown): FirstScreenAnswer | null {
  const x = a as Partial<FirstScreenAnswer> | null;
  const ok =
    !!x && typeof x === "object" && !!x.switches && typeof x.switches === "object" && Array.isArray(x.items) && typeof x.more === "boolean" &&
    Array.isArray(x.photos) && Array.isArray(x.watching) && Array.isArray(x.bundle_sellers);
  return ok ? (x as FirstScreenAnswer) : null;
}

async function take(part: string, now: number, userId?: string): Promise<FirstScreenAnswer | null> {
  const s = slot();
  if (!s || now - s.at > DECLUTTER_PREFETCH_MAX_AGE_MS) return null;
  if (userId !== undefined && userId !== s.userId) return null;
  s.taken ??= new Set();
  if (s.taken.has(part)) return null;
  s.taken.add(part);
  return usable(await s.answer);
}

export async function takeFirstScreenSwitches(userId: string | null, now: number = Date.now()): Promise<Record<string, unknown> | null> {
  if (!userId) return null;
  return (await take("switches", now, userId))?.switches ?? null;
}

/** The whole live list, only when it all fit in the answer. */
export async function takeFirstScreenItems(now: number = Date.now()): Promise<FirstScreenAnswer["items"] | null> {
  const a = await take("items", now);
  return a && !a.more ? a.items : null;
}

export async function takeFirstScreenPhotos(itemIds: string[], now: number = Date.now()): Promise<unknown[] | null> {
  const a = await take("photos", now);
  if (!a) return null;
  const covered = new Set(a.items.map((i) => i.id));
  if (!itemIds.every((id) => covered.has(id))) return null;
  const wanted = new Set(itemIds);
  return a.photos.filter((p) => wanted.has(p.item_id));
}

export async function takeFirstScreenDropStates(itemIds: string[], now: number = Date.now()): Promise<FirstScreenAnswer["items"] | null> {
  const a = await take("drops", now);
  if (!a) return null;
  const wanted = new Set(itemIds);
  const rows = a.items.filter((i) => wanted.has(i.id));
  return rows.length === wanted.size ? rows : null;
}

export async function takeFirstScreenBundleSellers(sellerIds: string[], now: number = Date.now()): Promise<string[] | null> {
  const a = await take("bundles", now);
  if (!a) return null;
  const asked = new Set(a.items.map((i) => i.seller_id));
  return sellerIds.every((id) => asked.has(id)) ? a.bundle_sellers : null;
}

export async function takeFirstScreenWatching(userId: string, now: number = Date.now()): Promise<string[] | null> {
  return (await take("watching", now, userId))?.watching ?? null;
}

/** The parish of `zip`, once, if the answer asked the server about that same ZIP and it knew. */
export async function takeFirstScreenZipParish(zip: string, now: number = Date.now()): Promise<string | null> {
  const known = (await take("zip", now))?.zip_parish;
  return known?.zip === zip && known.parish ? known.parish : null;
}

/**
 * The capped answer, for Browse to show while the full list loads. Not taken: it reads only, and a refetch never asks.
 * Null when there is none, or when the answer was the whole list (the items query has it then).
 */
export async function readFirstScreenPreview(now: number = Date.now()): Promise<Pick<FirstScreenAnswer, "items" | "near"> | null> {
  const s = slot();
  if (!s || now - s.at > DECLUTTER_PREFETCH_MAX_AGE_MS) return null;
  const a = usable(await s.answer);
  return a?.more ? { items: a.items, near: a.near ?? null } : null;
}

/**
 * Are the preview's cards exactly the top of the final list? Only then may they show ahead of it, so nothing moves when
 * the rest arrive: the default order, nothing narrowing it, and the browser's origin the one the server sorted from.
 */
export function previewIsTopOfList(
  near: { lat: number; lng: number } | null,
  origin: { lat: number; lng: number } | null,
  defaultView: boolean,
): boolean {
  if (!defaultView) return false;
  if (!near || !origin) return !near && !origin;
  return Number(near.lat) === Number(origin.lat) && Number(near.lng) === Number(origin.lng);
}
