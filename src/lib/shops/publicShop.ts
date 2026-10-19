/**
 * SH2/SH2b: the shop page anyone with the link can look at (owner
 * 2026-10-19), and the one share helper every "Share my shop" button calls.
 *
 * fetchPublicShop reads shops_public_shop (migration
 * 20261019042744_shops_public_page), the ONLY shop read anon may call: it
 * returns exactly what the public page shows (never the owner id, the pin,
 * the SoS number, the hidden reason, the pickup address or the owner's
 * person rating) and NULL for a shop that is hidden, paused or switched off.
 * NULL is one answer on purpose, so the page says "not available" for all of
 * them, and so does a link whose id is not a shop id at all.
 * Photos come back as ids; publicPhotoUrl turns one into an image URL.
 */
import { supabase } from "@/integrations/supabase/client";
import { shareNative, type ShareOutcome } from "@/lib/nativeShare";
import { rpcErrorMessage } from "./rpcErrorCopy";
import type { ShopBadges, ShopHour, ShopPhotoKind } from "./api";
import type { ShopItem } from "./items";

/** Built from this constant, never window.location: a native build's origin is capacitor://localhost. */
const SHOP_LINK_ORIGIN = "https://www.louisianahelpr.com";

export interface PublicShop {
  id: string;
  name: string;
  about: string;
  category: string;
  category_label: string | null;
  group_label: string | null;
  parishes_served: string[];
  area_label: string;
  storefront: boolean;
  offers_selling: boolean;
  offers_quotes: boolean;
  badges: ShopBadges;
  hours: ShopHour[];
  /** By id only: a storage path names the owner's user id (see publicPhotoUrl). */
  photos: { id: string; kind: ShopPhotoKind; position: number }[];
  items: PublicShopItem[];
}

type PublicShopItem = Omit<ShopItem, "photos"> & { photos: { id: string; position: number }[] };

/**
 * A public page photo, by id, through the shop-photo edge function: it serves
 * the image only while the shop is link-visible and never says the storage
 * path (which starts with the owner's user id).
 */
export function publicPhotoUrl(photoId: string, kind: "shop" | "item", width = 640): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/shop-photo?id=${encodeURIComponent(photoId)}&kind=${kind}&w=${width}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A shop id is a uuid; anything else in /shops/:id is a link to no shop. */
export function isShopId(value: string): boolean {
  return UUID_RE.test(value);
}

export async function fetchPublicShop(shopId: string): Promise<PublicShop | null> {
  // Not a uuid: no shop, and no request (Postgres would answer 22P02, which
  // read as "couldn't load, try again" for a link that will never work).
  if (!isShopId(shopId)) return null;
  const { data, error } = await supabase.rpc("shops_public_shop", { p_shop_id: shopId });
  // PGRST202 = the function is not deployed yet (migrations land on merge, so
  // a fresh client can run against a database that has not caught up): the
  // shop is not available, not an error with a retry that cannot help.
  if ((error as { code?: string } | null)?.code === "PGRST202") return null;
  if (error) {
    const words = rpcErrorMessage("shops_public_shop", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
  return (data as unknown as PublicShop | null) ?? null;
}

/** The link to a shop's public page. */
export function shopLink(shopId: string): string {
  return `${SHOP_LINK_ORIGIN}/shops/${encodeURIComponent(shopId)}`;
}

/** What a share says: the shop's name and what it is, then the link. */
function shopShareText(shop: { name: string; category_label?: string | null; area_label?: string | null }): string {
  const what = [shop.category_label, shop.area_label].filter(Boolean).join(" in ");
  return what ? `${shop.name}: ${what}. See the shop on Louisiana Helpr.` : `${shop.name} on Louisiana Helpr.`;
}

/**
 * Share a shop: the OS share sheet on iOS/Android (Messages, Facebook,
 * Instagram, copy), the Web Share API where a browser has one, else the link
 * is copied with a visible confirmation (shareNative's ladder). The ONE
 * helper for every "Share my shop" / "Share this shop" button.
 */
export function shareShop(shop: { id: string; name: string; category_label?: string | null; area_label?: string | null }): Promise<ShareOutcome> {
  return shareNative({
    title: shop.name,
    text: shopShareText(shop),
    url: shopLink(shop.id),
    dialogTitle: "Share this shop",
  });
}
