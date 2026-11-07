/**
 * The hand-over from the entry's GUEST /declutter reads (src/boot/guestDeclutterPrefetch.ts, Q2705). The entry must
 * never import this file.
 *
 * Each read takes its part ONCE (a refetch must reach the server), only while the answer is fresh, and only while
 * nobody is signed in (the reads were made with the public key: a member reads as the member). Anything else is null,
 * and that read asks Supabase as it always did.
 */
import { definitelyGuest } from "@/lib/persistedAuthToken";
import type { FirstScreenAnswer } from "./bootPrefetch";

/** Same string as GUEST_DECLUTTER_PREFETCH_KEY in the boot module (the test pins it). */
const KEY = "__lhGuestDeclutterPrefetch";
/** An answer older than this is not handed out: the page asks afresh. */
const GUEST_PREFETCH_MAX_AGE_MS = 30_000;

type Slot = {
  at: number;
  open: Promise<string[] | null>;
  /** declutter_guest_preview's answer (Q2705, 11-07); absent from a slot an older entry made. */
  preview?: Promise<{ items: unknown[]; photos: unknown[]; more: boolean } | null>;
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
  // Peek before claiming: a photo read for other items (an item page) must not use up the list's answer. The photo rows
  // cover the list, or with a preview the preview's items (then there is no list).
  const items = (await s.items) ?? (await s.preview)?.items;
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

/**
 * The guest PREVIEW (Q2705, 11-07; declutter_guest_preview): the top 24 of the list, card columns only, for Browse to
 * show while it reads the full list (as a member's readFirstScreenPreview). Not taken: it reads only. `near` is always
 * null (the server sorted newest first, from no position), so Browse shows it only when it has no position either.
 * The preview carries no descriptions: each item's description is "" (the preview shows only with no search). Null
 * when there is none, it is old, or someone is signed in.
 */
export async function readGuestPreview(now: number = Date.now()): Promise<{ items: FirstScreenAnswer["items"]; near: null } | null> {
  const s = slot();
  if (!s?.preview || now - s.at > GUEST_PREFETCH_MAX_AGE_MS || !definitelyGuest()) return null;
  const p = await s.preview;
  return p ? { items: p.items.map((i) => ({ description: "", ...(i as FirstScreenAnswer["items"][number]) })), near: null } : null;
}

/** fetchDropStates' rows for these items, from the preview (its items carry the drop columns), taken once. */
export async function takeGuestDropStates(itemIds: string[], now: number = Date.now()): Promise<unknown[] | null> {
  const s = slot();
  const p = s?.preview ? await s.preview : null;
  if (!p) return null;
  const wanted = new Set(itemIds);
  const rows = p.items.filter((i) => wanted.has((i as { id?: unknown }).id as string));
  if (rows.length !== wanted.size) return null;
  return claim("drops", now) ? rows : null;
}
