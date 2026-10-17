/**
 * Shops client calls (docs/specs/local-shops-prep.md; migration
 * 20261017061155_shops_profiles). Every write is a shops_* RPC (no client role
 * can write a shop table); each one refuses server-side without the 'shops'
 * switch, so this file is never the protection. Screens turn errors into
 * plain words with shopsErrorMessage().
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { removeShopObjects } from "./storageCleanup";

/** Shop photos live in job-photos under <owner uid>/shops/ (purged with the account). */
const SHOP_PHOTO_BUCKET = "job-photos";

function rpcData<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return result.data;
}

export interface ShopBadges {
  id_checked: boolean;
  licensed: boolean;
  insured: boolean;
  registered: boolean;
  permit: boolean;
}

export interface ShopHour {
  weekday: number;
  opens: string;
  closes: string;
}

export type ShopPhotoKind = "logo" | "cover" | "gallery";

interface ShopPhoto {
  id: string;
  kind: ShopPhotoKind;
  storage_path: string;
  position: number;
}

export interface ShopPage {
  id: string;
  owner_id: string;
  name: string;
  about: string;
  category: string;
  parishes_served: string[];
  area_label: string;
  storefront: boolean;
  pin_lat: number;
  pin_lng: number;
  offers_selling: boolean;
  offers_quotes: boolean;
  paused: boolean;
  badges: ShopBadges;
  rating: number | null;
  review_count: number;
  follower_count: number;
  following: boolean;
  mine: boolean;
  sos_number: string | null;
  hidden: boolean | null;
  hidden_reason: string | null;
  hours: ShopHour[];
  photos: ShopPhoto[];
  created_at: string;
}

export interface ShopCard {
  id: string;
  name: string;
  category: string;
  area_label: string;
  pin_lat: number;
  pin_lng: number;
  paused: boolean;
  miles: number | null;
  rating: number | null;
  review_count: number;
  badges: ShopBadges;
  logo_path: string | null;
}

export interface ShopCategory {
  slug: string;
  group_slug: string;
  group_label: string;
  label: string;
  position: number;
}

export interface ShopFields {
  name: string;
  about: string;
  category: string;
  parishesServed: string[];
  areaLabel: string;
  storefront: boolean;
  pinLat: number;
  pinLng: number;
  offersSelling: boolean;
  offersQuotes: boolean;
  sosNumber: string;
}

export async function fetchShopCategories(): Promise<ShopCategory[]> {
  const rows = unwrap(
    await supabase.from("shop_categories").select("slug, group_slug, group_label, label, position").order("position", { ascending: true }),
  );
  return (rows ?? []) as ShopCategory[];
}

export async function browseShops(args: { lat: number | null; lng: number | null; category?: string | null; group?: string | null }): Promise<ShopCard[]> {
  const rows = rpcData(
    await supabase.rpc("shops_browse", {
      p_lat: args.lat as number,
      p_lng: args.lng as number,
      ...(args.category ? { p_category: args.category } : {}),
      ...(args.group ? { p_group: args.group } : {}),
      p_limit: 60,
    }),
    (e) => rpcErrorMessage("shops_browse", e),
  );
  return (rows ?? []) as unknown as ShopCard[];
}

export async function fetchShop(shopId: string): Promise<ShopPage> {
  return rpcData(await supabase.rpc("shops_get_shop", { p_shop_id: shopId }), (e) => rpcErrorMessage("shops_get_shop", e)) as unknown as ShopPage;
}

export async function fetchMyShopId(): Promise<string | null> {
  return (rpcData(await supabase.rpc("shops_my_shop_id"), (e) => rpcErrorMessage("shops_my_shop_id", e)) as string | null) ?? null;
}

export async function saveMyShop(f: ShopFields): Promise<string> {
  return rpcData(
    await supabase.rpc("shops_save_my_shop", {
      p_name: f.name,
      p_about: f.about,
      p_category: f.category,
      p_parishes_served: f.parishesServed,
      p_area_label: f.areaLabel,
      p_storefront: f.storefront,
      p_pin_lat: f.pinLat,
      p_pin_lng: f.pinLng,
      p_offers_selling: f.offersSelling,
      p_offers_quotes: f.offersQuotes,
      p_sos_number: f.sosNumber,
    }),
    (e) => rpcErrorMessage("shops_save_my_shop", e),
  ) as string;
}

export async function setShopHours(hours: ShopHour[]): Promise<number> {
  return rpcData(await supabase.rpc("shops_set_hours", { p_hours: hours.map((h) => ({ weekday: h.weekday, opens: h.opens, closes: h.closes })) }), (e) => rpcErrorMessage("shops_set_hours", e)) as number;
}

export async function setShopPaused(paused: boolean): Promise<boolean> {
  return rpcData(await supabase.rpc("shops_set_paused", { p_paused: paused }), (e) => rpcErrorMessage("shops_set_paused", e)) as boolean;
}

export async function setShopFollow(shopId: string, follow: boolean): Promise<boolean> {
  return rpcData(await supabase.rpc("shops_set_follow", { p_shop_id: shopId, p_follow: follow }), (e) => rpcErrorMessage("shops_set_follow", e)) as boolean;
}

export function shopPhotoUrl(path: string): string {
  return supabase.storage.from(SHOP_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** `<owner uid>/shops/<nonce>.jpg`: the folder the server's attach check and the account purge both read. */
function shopPhotoPath(ownerId: string, nonce: string): string {
  const safe = nonce.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "photo";
  return `${ownerId}/shops/${safe}.jpg`;
}

/**
 * Remove storage objects the server detached. The rows are already gone; a
 * failed or short object delete leaves an unattached object, public by URL,
 * that the owner's account deletion still removes (<uid>/shops/), so it is
 * counted and reported (removeShopObjects; lh-silent-failure re-review).
 */
async function removeObjects(paths: string[]): Promise<void> {
  await removeShopObjects(SHOP_PHOTO_BUCKET, paths, "photo objects");
}

/**
 * Clean (re-encode, no location metadata), upload and attach one photo. The
 * object is uploaded first (the server attaches only an object that exists
 * and is the owner's); when the attach is refused the object is deleted again.
 */
export async function addShopPhoto(ownerId: string, kind: ShopPhotoKind, file: File): Promise<void> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = shopPhotoPath(ownerId, nonce);
  const bucket = supabase.storage.from(SHOP_PHOTO_BUCKET);
  const { error: upErr } = await bucket.upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    // A fresh random name per upload: the object never changes (Q655).
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (upErr) throw new Error("photo_not_uploaded");
  const { data, error } = await supabase.rpc("shops_attach_photo", { p_kind: kind, p_storage_path: path });
  if (error) {
    await removeShopObjects(SHOP_PHOTO_BUCKET, [path], "refused photo upload");
    const words = rpcErrorMessage("shops_attach_photo", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
  const replaced = (data as { replaced_path?: string | null } | null)?.replaced_path;
  if (replaced) await removeObjects([replaced]);
}

export async function removeShopPhoto(photoId: string): Promise<void> {
  const path = rpcData(await supabase.rpc("shops_remove_photo", { p_photo_id: photoId }), (e) => rpcErrorMessage("shops_remove_photo", e));
  await removeObjects(path ? [path as string] : []);
}

export async function closeMyShop(): Promise<void> {
  const paths = rpcData(await supabase.rpc("shops_close_my_shop"), (e) => rpcErrorMessage("shops_close_my_shop", e));
  await removeObjects((paths ?? []) as string[]);
}
