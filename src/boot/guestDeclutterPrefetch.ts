/**
 * Q2705 (lead 11-07, option A): a GUEST's cold /declutter starts its first screen from the entry, as a member's does
 * (declutterPrefetch.ts), so the page does not wait on a serial chain.
 *
 * Measured 2026-11-07 (cwv-lab, prod www, guest, chromium, Slow 4G + 4x, 375, 1 run; ~/.lh-shots/b2-q2705-1107):
 * LCP 13,280 ms, the first card photo. Each read waited on the one before it: the guest gate's
 * features_open_to_everyone at 6.3-7.1 s (after auth-ready and a lazy Supabase import, 2.3 s after the app drew), the
 * items at 8.3-9.3 s, the photo rows at 9.3-10.2 s, the card images at 10.3-13.3 s. A member's single boot read,
 * declutter_first_screen, is not open to a guest (it raises not_authenticated; anon has no EXECUTE).
 *
 * So, for a visitor with no stored session, the entry fires the guest page's own reads at once, with the public key
 * (exactly the requests the page would make: the anon row policies decide what comes back):
 *   - features_open_to_everyone (STABLE): the guest gate's answer (DeclutterGuestGate, useSectionsOpen);
 *   - the PREVIEW (declutter_guest_preview, 20261107212823): the list's top 24 with the card's columns only, their
 *     photo rows and drop columns, for Browse to show while it reads the full list itself (11-07);
 *   - with no preview, the live list (fetchLiveItems' read) and its photo rows (fetchPhotos' read): in one read,
 *     declutter_guest_first_screen (option B, 20261107172400), else the two REST reads, the photos after the list;
 *   - and, when the link opens on Browse and Declutter is open to everyone, the first row's card photos.
 * The page takes each answer ONCE (src/lib/declutter/guestBootPrefetch.ts). A failed, missing or old answer: the page
 * reads for itself, as before.
 *
 * NOTHING outside the entry's prefetch chunk may import this file, and it imports nothing from src/lib (the entry
 * budget, see guestJobsPrefetch.ts). The columns are a COPY of src/lib/declutter/myReads.ts ITEM_COLUMNS, and
 * src/boot/guestDeclutterPrefetch.test.ts holds the two equal.
 */
import { firstCardPhotoPreloads, preloadFirstCardPhotos } from "./declutterPrefetch";

/** Same string as the lib side's KEY (the test pins it). */
export const GUEST_DECLUTTER_PREFETCH_KEY = "__lhGuestDeclutterPrefetch";

/** COPY of ITEM_COLUMNS (src/lib/declutter/myReads.ts). */
export const GUEST_ITEM_COLUMNS =
  "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers";
/** fetchLiveItems' limit. */
export const GUEST_ITEMS_LIMIT = 500;

const rest = (base: string) => `${base.replace(/\/$/, "")}/rest/v1`;
const noSpaces = (cols: string) => cols.replace(/\s+/g, "");

/** fetchLiveItems' read: live or reserved, newest first, at most 500. */
export function guestItemsUrl(base: string): string {
  const u = new URL(`${rest(base)}/declutter_items`);
  u.searchParams.set("select", noSpaces(GUEST_ITEM_COLUMNS));
  u.searchParams.set("status", "in.(live,reserved)");
  u.searchParams.set("order", "live_at.desc");
  u.searchParams.set("limit", String(GUEST_ITEMS_LIMIT));
  return u.toString();
}

/** fetchPhotos' read for these items, by position. */
export function guestPhotosUrl(base: string, itemIds: string[]): string {
  const u = new URL(`${rest(base)}/declutter_item_photos`);
  u.searchParams.set("select", "id,item_id,storage_path,position");
  u.searchParams.set("item_id", `in.(${itemIds.join(",")})`);
  u.searchParams.set("order", "position.asc");
  return u.toString();
}

/** declutter_guest_preview's answer (see startGuestDeclutterPrefetch). */
type GuestPreview = { items: unknown[]; photos: unknown[]; more: boolean };

const json = (r: Response) => (r.ok ? (r.json() as Promise<unknown>) : null);
const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : null);

/** Called from startDeclutterPrefetch when there is no usable session (that function checked the route). */
export function startGuestDeclutterPrefetch(base: string, key: string, search: string): void {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  // A failed read is not an error anywhere below: the page reads for itself.
  const open = fetch(`${rest(base)}/rpc/features_open_to_everyone`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  })
    .then(json)
    .then((v) => (list(v)?.every((x) => typeof x === "string") ? (v as string[]) : null))
    .catch(() => null);
  // Q2705 (lead 11-07): the PREVIEW first, declutter_guest_preview (20261107212823, SECURITY INVOKER): the top 24 of the
  // list with only the card's columns (no descriptions), their photo rows and `more`. 11-07 the whole list was 67 KB gz
  // and every card photo waited on it; Browse now shows the preview and reads the full list itself once the first
  // photos are in. With a preview, nothing is handed over as the list (`items` null), only its photo rows.
  const preview = fetch(`${rest(base)}/rpc/declutter_guest_preview`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  })
    .then(json)
    .then((v) => {
      const p = v as { items?: unknown; photos?: unknown; more?: unknown } | null;
      const ok = !!p && Array.isArray(p.items) && Array.isArray(p.photos) && typeof p.more === "boolean";
      return ok ? (p as GuestPreview) : null;
    })
    .catch(() => null);
  // Option B: the list and its photo rows in ONE read (declutter_guest_first_screen, SECURITY INVOKER: anon's row
  // policies decide, as for the two REST reads), so the photos do not wait a round for the list. Only when there is no
  // preview (not deployed yet, refused or malformed); that one failing too: the two REST reads below, as in option A.
  const one = preview.then((pre) => pre ? null : fetch(`${rest(base)}/rpc/declutter_guest_first_screen`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  })
    .then(json)
    .then((v) => {
      const a = v as { items?: unknown; photos?: unknown } | null;
      return a && Array.isArray(a.items) && Array.isArray(a.photos) ? { items: a.items as unknown[], photos: a.photos as unknown[] } : null;
    }))
    .catch(() => null);
  const items = preview.then((pre) => pre ? null : one
    .then((a) => a?.items ?? fetch(guestItemsUrl(base), { headers }).then(json).then(list)))
    .catch(() => null);
  const photos = preview.then((pre) => pre ? pre.photos : one
    .then((a) => a?.photos ?? items.then((rows) => {
      if (!rows) return null;
      const ids = rows.map((r) => (r as { id?: unknown }).id).filter((id): id is string => typeof id === "string");
      if (ids.length === 0) return [];
      return fetch(guestPhotosUrl(base, ids), { headers }).then(json).then(list);
    })))
    .catch(() => null);
  (window as unknown as Record<string, unknown>)[GUEST_DECLUTTER_PREFETCH_KEY] = { at: Date.now(), open, preview, items, photos };
  // The photos above the fold, as for a member (B96), only when the link opens on Browse and the guest will see it.
  const q = new URLSearchParams(search);
  const opensOnBrowse = (q.get("tab") ?? "browse") === "browse" && (q.get("view") ?? "browse") === "browse";
  if (!opensOnBrowse) return;
  void Promise.all([open, preview, items, photos]).then(([o, pre, i, p]) => {
    if (!o?.includes("declutter")) return;
    preloadFirstCardPhotos(firstCardPhotoPreloads(base, { items: pre?.items ?? i, photos: p }, ""));
  });
}
