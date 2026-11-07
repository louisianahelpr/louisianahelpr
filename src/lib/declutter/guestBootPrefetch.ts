/**
 * The hand-over from the entry's GUEST /declutter reads (src/boot/guestDeclutterPrefetch.ts, Q2705). The entry must
 * never import this file.
 *
 * Each read takes its part ONCE (a refetch must reach the server), only while the answer is fresh, and only while
 * nobody is signed in (the reads were made with the public key: a member reads as the member). Anything else is null,
 * and that read asks Supabase as it always did.
 */
import { definitelyGuest } from "@/lib/persistedAuthToken";

/** Same string as GUEST_DECLUTTER_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhGuestDeclutterPrefetch";
/** An answer older than this is not handed out: the page asks afresh. */
const GUEST_PREFETCH_MAX_AGE_MS = 30_000;

type Slot = {
  at: number;
  open: Promise<string[] | null>;
  items: Promise<unknown[] | null>;
  photos: Promise<unknown[] | null>;
  taken?: Set<string>;
};

const slot = (): Slot | undefined => (window as unknown as Record<string, Slot | undefined>)[KEY];

function claim(part: string, now: number): Slot | null {
  const s = slot();
  if (!s || now - s.at > GUEST_PREFETCH_MAX_AGE_MS || !definitelyGuest()) return null;
  s.taken ??= new Set();
  if (s.taken.has(part)) return null;
  s.taken.add(part);
  return s;
}

/** features_open_to_everyone's answer, for the guest gate (useSectionsOpen). */
export async function takeGuestSectionsOpen(now: number = Date.now()): Promise<string[] | null> {
  const s = claim("open", now);
  return s ? await s.open : null;
}

/** fetchLiveItems' rows. */
export async function takeGuestItems(now: number = Date.now()): Promise<unknown[] | null> {
  const s = claim("items", now);
  return s ? await s.items : null;
}

/** fetchPhotos' rows for these items, only when the answer covered every one of them. */
export async function takeGuestPhotos(itemIds: string[], now: number = Date.now()): Promise<unknown[] | null> {
  const s = slot();
  if (!s) return null;
  // Peek before claiming: a photo read for other items (an item page) must not use up the list's answer.
  const items = await s.items;
  if (!items) return null;
  const covered = new Set(items.map((i) => (i as { id?: unknown }).id));
  if (!itemIds.every((id) => covered.has(id))) return null;
  const c = claim("photos", now);
  if (!c) return null;
  const rows = await c.photos;
  if (!rows) return null;
  const wanted = new Set(itemIds);
  return rows.filter((p) => wanted.has((p as { item_id?: unknown }).item_id as string));
}
