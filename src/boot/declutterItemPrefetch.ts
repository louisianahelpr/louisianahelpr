/**
 * Start a Declutter item page's two first reads, and its first photo, from the ENTRY (B100, Q2708; same idea as
 * declutterPrefetch.ts and B96's first-card photo preload).
 *
 * Measured 11-04 (cwv-lab, prod, 375 Fast 4G + 4x CPU, the test poster): an item page's largest paint is its first
 * photo, at 2.45 s; 1.8 s of it was waiting to START (loadDelay). The item row and photo rows were asked for only when
 * DeclutterItemPage's chunk had downloaded and run (~1.75 s), and the photo only after they answered.
 *
 * So the entry asks the SAME two REST reads with plain fetch, and once the photo rows are in, preloads the first photo
 * with the gallery's exact src, srcset and sizes (DeclutterGallery, pagePhoto.ts), so the gallery's own request is
 * answered from the preload. fetchItem and fetchPhotos (src/lib/declutter/api.ts) each take their answer ONCE, for
 * this item and member, while fresh (src/lib/declutter/itemPrefetchTake.ts); a refetch reaches the server. No usable
 * session, any failure, or an answer not in the expected shape: nothing is handed over, and the page reads as before.
 *
 * NOTHING outside the entry's own chunks may import this file (see guestJobsPrefetch.ts). So the URLs and the photo
 * sizes are COPIES, and src/boot/declutterItemPrefetch.test.ts holds them equal to the originals.
 */
import { anyStoredSession, storedSession } from "./storedSession";

export const DECLUTTER_ITEM_PREFETCH_KEY = "__lhDeclutterItemPrefetch";

/** Copy of ITEM_COLUMNS (src/lib/declutter/myReads.ts; the test holds them equal). */
export const ITEM_SELECT =
  "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers";
/** Copies of DECLUTTER_PHOTO_BUCKET (api.ts), PAGE_PHOTO_WIDTHS (pagePhoto.ts) and the gallery's sizes (DeclutterGallery.tsx). */
const BUCKET = "job-photos";
const WIDTHS = [720, 1080] as const;
export const GALLERY_SIZES = "(min-width: 640px) 680px, calc(100vw - 40px)";

const ITEM_PATH = /^\/declutter\/item\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** The REST URLs supabase-js sends for fetchItem(id) and fetchPhotos([id]) (see the test). */
export function declutterItemUrls(supabaseUrl: string, itemId: string): { item: string; photos: string } {
  const rest = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/`;
  const item = new URL(`${rest}declutter_items`);
  item.searchParams.set("select", ITEM_SELECT.replace(/\s/g, ""));
  item.searchParams.set("id", `eq.${itemId}`);
  const photos = new URL(`${rest}declutter_item_photos`);
  photos.searchParams.set("select", "id,item_id,storage_path,position");
  photos.searchParams.set("item_id", `in.(${itemId})`);
  photos.searchParams.set("order", "position.asc");
  return { item: item.toString(), photos: photos.toString() };
}

/**
 * The gallery's first frame for these photo rows: pagePhoto(photoPublicUrl(path)) of the lowest position. A path that
 * a URL would have to encode, or anything not in the expected shape: none (the gallery then loads it as before).
 */
export function firstGalleryPhoto(supabaseUrl: string, rows: unknown): { href: string; srcset: string } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const path = (rows[0] as { storage_path?: unknown })?.storage_path;
  if (typeof path !== "string" || !/^[A-Za-z0-9/_.-]+$/.test(path)) return null;
  const at = (w: number) => `${supabaseUrl.replace(/\/$/, "")}/storage/v1/render/image/public/${BUCKET}/${path}?width=${w}&quality=75`;
  return { href: at(720), srcset: WIDTHS.map((w) => `${at(w)} ${w}w`).join(", ") };
}

/** A list answer, or null (a refusal, an error body, anything else). */
const listOf = (r: Response): Promise<unknown[] | null> =>
  r.ok ? (r.json() as Promise<unknown>).then((x) => (Array.isArray(x) ? x : null)) : Promise.resolve(null);

/**
 * Called by the entry (through signedInPrefetch.ts). No-op unless this is a cold load of an item page, by a member with a
 * live session or by a GUEST (no stored session at all).
 *
 * GUESTS (Q2707/Q2708, measured 11-04 on prod, item 55e18296, guest, cwv-lab with the HTTP cache kept): a shared item
 * link is how most guests arrive, and its first photo painted at 9.2 s on Slow 4G (2.5 s on Fast 4G), because a
 * guest's reads waited for the guest route's whole chain (DeclutterGuestRoute, auth, the sections-open read, the page)
 * and started only at ~6.7 s. A guest now gets the same two reads as the anonymous role (the page's own reads, the
 * anon policies of 20261031060656_declutter_guest_read.sql) and the photo preload; the hand-over is for a guest page
 * only (userId null on both sides, itemPrefetchTake.ts). A stored session that is expiring or unreadable: nothing
 * (supabase-js refreshes it first, and the page reads as that member).
 */
export function startDeclutterItemPrefetch(pathname: string): void {
  const itemId = ITEM_PATH.exec(pathname)?.[1]?.toLowerCase();
  if (!itemId || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const session = storedSession(Date.now() / 1000);
  const guest = !session && !anyStoredSession();
  if (!base || !key || (!session && !guest)) return;
  const urls = declutterItemUrls(base, itemId);
  // The anonymous role sends the publishable key as its bearer, as supabase-js does for a signed-out client.
  const headers = { apikey: key, Authorization: `Bearer ${session ? session.token : key}`, Accept: "application/json" };
  // A failed prefetch is not an error: the page runs today's reads.
  const read = (url: string) => fetch(url, { headers }).then(listOf).catch(() => null);
  const slot = { at: Date.now(), userId: session ? session.userId : null, itemId, item: read(urls.item), photos: read(urls.photos) };
  (window as unknown as Record<string, unknown>)[DECLUTTER_ITEM_PREFETCH_KEY] = slot;
  void slot.photos.then((rows) => {
    const p = firstGalleryPhoto(base, rows);
    if (!p) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.setAttribute("as", "image");
    link.href = p.href;
    link.setAttribute("imagesrcset", p.srcset);
    link.setAttribute("imagesizes", GALLERY_SIZES);
    link.setAttribute("fetchpriority", "high");
    document.head.appendChild(link);
  });
}
