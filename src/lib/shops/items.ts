/**
 * Shop items, client calls and the words the maker ticks (Shops slice 2,
 * migration 20261016212915_shops_items; docs/specs/local-shops-prep.md
 * L5-L22, L51, L52 and the dated D1-D11 defaults). Every write is a shops_*
 * RPC; each refuses server-side without the 'shops' switch, so this file is
 * never the protection. No orders, checkout or money here (S3).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { captureException } from "@/lib/sentry";
import { SHOP_ITEM_TYPES, type ShopItemKind } from "../../../supabase/functions/declutter-ai-draft/shopItemSanitize";

export { SHOP_ITEM_TYPES, type ShopItemKind };

/** Item photos live in job-photos under <owner uid>/shop-items/<item id>/ (purged with the account). */
const ITEM_PHOTO_BUCKET = "job-photos";

export type ShopItemStatus = "draft" | "pending_review" | "live" | "withdrawn" | "rejected";

export const SHOP_ITEM_KIND_LABEL: Record<ShopItemKind, string> = {
  made: "Made by me",
  home_food: "Home-kitchen food",
  farm: "From my farm or yard",
};

export const SHOP_ITEM_TYPE_LABEL: Record<string, string> = {
  candles: "Candles",
  crafts: "Crafts",
  decor: "Decor",
  furniture: "Furniture",
  adult_clothing: "Clothing (adult)",
  art: "Art",
  baked_goods: "Baked goods",
  candy: "Candy",
  cane_syrup: "Cane syrup",
  dried_mixes: "Dry mixes",
  honey: "Honey",
  jams_jellies: "Jams, jellies and preserves",
  pickles: "Pickles and acidified foods",
  sauces_syrups: "Sauces and syrups",
  spices: "Spices",
  eggs: "Eggs (own hens)",
  produce: "Fruit and vegetables (whole, uncut)",
};

/**
 * The confirmation each statement key stands for (L7, L9, L10, L12-L16;
 * R.S. 40:4.9). The server's shop_item_required_statements decides which a
 * kind needs; src/test/shopsItems.test.ts holds the two lists equal.
 */
export const SHOP_ITEM_STATEMENTS: Record<string, string> = {
  made_by_me: "I made this myself.",
  new_not_used: "It is new, not used or second-hand (used things go in Declutter).",
  not_for_children: "It is not a toy or an item made for babies or children.",
  not_skin_product: "It is not soap, lotion, a balm or another skin product.",
  not_banned: "It is not on the list of things Shops cannot sell (alcohol, CBD or THC, vapes, raw milk, medicines, live animals, weapons).",
  made_in_my_home_kitchen: "I made it in my own home kitchen, and nobody I pay helps make it.",
  low_risk_no_meat_fish: "It is on Louisiana's home-kitchen list and has no meat, poultry, fish or seafood in it.",
  label_says_home_kitchen: "My package label says it was made in a home kitchen that is not licensed or inspected by the health department.",
  kitchen_rules: "My kitchen is clean, no pets are in it while I cook, and anything that spoils is kept at 45°F or colder.",
  no_cbd_or_alcohol: "It has no CBD, THC or alcohol in it.",
  sales_tax_registered: "I am registered to collect sales tax in my parish.",
  own_hens: "These eggs are from my own hens.",
  kept_cold: "I keep the eggs cold (45°F or colder) until pickup.",
  no_cracked_dirty: "I take out cracked or dirty eggs.",
  home_grown: "I grew it myself.",
  whole_uncut: "It is whole and uncut (cut or cooked produce needs a permit).",
};

/** The statements the maker ticks for this kind and type, in order. Mirrors shop_item_required_statements. */
export function requiredStatements(kind: ShopItemKind, subtype: string): string[] {
  if (kind === "made") return ["made_by_me", "new_not_used", "not_for_children", "not_skin_product", "not_banned"];
  if (kind === "home_food") {
    return ["made_in_my_home_kitchen", "low_risk_no_meat_fish", "label_says_home_kitchen", "kitchen_rules", "no_cbd_or_alcohol", "sales_tax_registered", "not_banned"];
  }
  if (subtype === "eggs") return ["own_hens", "kept_cold", "no_cracked_dirty", "not_banned"];
  return ["home_grown", "whole_uncut", "not_banned"];
}

/** L7: the notice the app shows on every home-food item (R.S. 40:4.9 D(1)). */
export const HOME_KITCHEN_NOTICE =
  "Made in a home kitchen that is not licensed or inspected by the Louisiana Department of Health.";

interface ShopItemPhoto {
  id: string;
  storage_path: string;
  position: number;
}

export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  subtype: string;
  status: ShopItemStatus;
  title: string;
  description: string;
  price_cents: number;
  lead_time_days: number;
  stock_count: number | null;
  home_kitchen: boolean;
  photos: ShopItemPhoto[];
}

export interface ShopItemFields {
  kind: ShopItemKind;
  subtype: string;
  title: string;
  description: string;
  priceCents: number;
  leadTimeDays: number;
  stockCount: number | null;
}

export interface CottageStatus {
  year: number;
  cap_cents: number;
  sales_cents: number;
  warn: boolean;
  reached: boolean;
  confirmed: boolean;
}

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

export async function fetchShopItems(shopId: string): Promise<ShopItem[]> {
  const rows = rpcData(await supabase.rpc("shops_shop_items", { p_shop_id: shopId }), (e) => rpcErrorMessage("shops_shop_items", e));
  return (rows ?? []) as unknown as ShopItem[];
}

const itemArgs = (f: ShopItemFields) => ({
  p_kind: f.kind,
  p_subtype: f.subtype,
  p_title: f.title,
  p_description: f.description,
  p_price_cents: f.priceCents,
  p_lead_time_days: f.leadTimeDays,
  // The generated type says number; NULL (made to order) is what the RPC takes.
  p_stock_count: f.stockCount as number,
});

export async function createShopItem(f: ShopItemFields): Promise<string> {
  return rpcData(await supabase.rpc("shops_create_item", itemArgs(f)), (e) => rpcErrorMessage("shops_create_item", e)) as string;
}

export async function updateShopItem(itemId: string, f: ShopItemFields): Promise<string> {
  return rpcData(await supabase.rpc("shops_update_item", { p_item_id: itemId, ...itemArgs(f) }), (e) => rpcErrorMessage("shops_update_item", e)) as string;
}

export async function setShopItemStock(itemId: string, stockCount: number | null, leadTimeDays: number): Promise<void> {
  rpcData(
    await supabase.rpc("shops_set_item_stock", { p_item_id: itemId, p_stock_count: stockCount as number, p_lead_time_days: leadTimeDays }),
    (e) => rpcErrorMessage("shops_set_item_stock", e),
  );
}

/** The shop's daily order limit (L22), or null when none is set. */
export async function fetchDailyOrderCap(shopId: string): Promise<number | null> {
  const row = unwrap(await supabase.from("shops").select("daily_order_cap").eq("id", shopId).maybeSingle());
  return (row as { daily_order_cap: number | null } | null)?.daily_order_cap ?? null;
}

export async function setDailyOrderCap(cap: number | null): Promise<void> {
  rpcData(await supabase.rpc("shops_set_daily_order_cap", { p_cap: cap as number }), (e) => rpcErrorMessage("shops_set_daily_order_cap", e));
}

export async function attestShopItem(itemId: string, statements: string[]): Promise<void> {
  rpcData(await supabase.rpc("shops_attest_item", { p_item_id: itemId, p_statements: statements }), (e) => rpcErrorMessage("shops_attest_item", e));
}

export async function publishShopItem(itemId: string): Promise<"pending_review" | "live"> {
  return rpcData(await supabase.rpc("shops_publish_item", { p_item_id: itemId }), (e) => rpcErrorMessage("shops_publish_item", e)) as "pending_review" | "live";
}

export async function fetchMyItemReview(itemId: string): Promise<{ review_note: string | null; ai_flagged: boolean; text_flagged: boolean } | null> {
  const rows = rpcData(await supabase.rpc("shops_my_item_review", { p_item_id: itemId }), (e) => rpcErrorMessage("shops_my_item_review", e));
  return ((rows ?? []) as { review_note: string | null; ai_flagged: boolean; text_flagged: boolean }[])[0] ?? null;
}

export async function fetchCottageStatus(): Promise<CottageStatus> {
  return rpcData(await supabase.rpc("shops_my_cottage_status"), (e) => rpcErrorMessage("shops_my_cottage_status", e)) as unknown as CottageStatus;
}

export async function confirmCottageYear(): Promise<number> {
  return rpcData(await supabase.rpc("shops_confirm_cottage_year"), (e) => rpcErrorMessage("shops_confirm_cottage_year", e)) as number;
}

export function itemPhotoUrl(path: string): string {
  return supabase.storage.from(ITEM_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Remove storage objects the server detached. */
async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { data, error } = await supabase.storage.from(ITEM_PHOTO_BUCKET).remove(paths);
  // The rows are already gone; an object left behind is unattached (the
  // owner's delete policy, a retry, or the account deletion removes it,
  // <uid>/shop-items/), but it stays public by URL until then, so a short
  // count is reported, not only logged (lh-silent-failure review nit 6).
  const removed = Array.isArray(data) ? data.length : 0;
  if (error || removed < paths.length) {
    console.warn("[shops] item photo objects not removed", error?.message ?? `${removed} of ${paths.length}`);
    captureException(error ?? new Error("shop item photo objects not removed"), { removed, wanted: paths.length }, "warning");
  }
}

/**
 * Clean (re-encode, no location metadata: Declutter's cleanListingPhoto),
 * upload and attach one photo to a DRAFT item. The object is uploaded first
 * (the server attaches only an object that exists and is the owner's, in this
 * item's folder); when the attach is refused the object is deleted again.
 */
export async function addShopItemPhoto(ownerId: string, itemId: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const safe = nonce.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "photo";
  const path = `${ownerId}/shop-items/${itemId}/${safe}.jpg`;
  const bucket = supabase.storage.from(ITEM_PHOTO_BUCKET);
  const { error: upErr } = await bucket.upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    // A fresh random name per upload: the object never changes (Q655).
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (upErr) throw new Error("photo_not_uploaded");
  const { data, error } = await supabase.rpc("shops_add_item_photo", { p_item_id: itemId, p_storage_path: path });
  if (error) {
    const { error: rmErr } = await bucket.remove([path]);
    if (rmErr) console.warn("[shops] could not remove a refused item photo upload", rmErr.message);
    const words = rpcErrorMessage("shops_add_item_photo", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
  return data as string;
}

export async function removeShopItemPhoto(photoId: string): Promise<void> {
  const path = rpcData(await supabase.rpc("shops_remove_item_photo", { p_photo_id: photoId }), (e) => rpcErrorMessage("shops_remove_item_photo", e));
  await removeObjects(path ? [path as string] : []);
}

export async function withdrawShopItem(itemId: string): Promise<void> {
  const paths = rpcData(await supabase.rpc("shops_withdraw_item", { p_item_id: itemId }), (e) => rpcErrorMessage("shops_withdraw_item", e));
  await removeObjects((paths ?? []) as string[]);
}

/** AI help from the item's photos (L51): the shared declutter-ai-draft edge function, target 'shop_item'. */
export interface ShopItemAiDraft {
  title: string;
  description: string;
  kind: ShopItemKind;
  subtype: string;
  flagged: boolean;
}

async function invokeAi(itemId: string, mode: "draft" | "check"): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("declutter-ai-draft", { body: { itemId, mode, target: "shop_item" } });
  if (error) {
    // FunctionsHttpError keeps the JSON body on its context.
    const ctx = (error as { context?: Response }).context;
    const body: { error?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: fall through to ai_unavailable.
          console.warn("[shops] AI error body was not JSON", parseErr);
          return null;
        })
      : null;
    // The rate limiter answers 429 with a sentence, not a code (review nit 8).
    if (ctx?.status === 429) throw new Error("ai_busy");
    const code = typeof body?.error === "string" ? body.error : "";
    throw new Error(code || "ai_unavailable");
  }
  return data;
}

/** Suggestions from the photos for the maker to edit. Saves nothing. */
export async function requestShopItemAiDraft(itemId: string): Promise<ShopItemAiDraft> {
  return (await invokeAi(itemId, "draft")) as ShopItemAiDraft;
}

/**
 * The banned-item check of the SAVED item, recorded server-side. Run right
 * before publishing; if it fails the item still publishes, to an admin's
 * review (the server's fail-safe), so the caller may ignore a failure.
 */
export async function requestShopItemAiCheck(itemId: string): Promise<{ checked: boolean; flagged: boolean }> {
  return (await invokeAi(itemId, "check")) as { checked: boolean; flagged: boolean };
}

/** Admin queue (L52). */
export interface PendingShopItem {
  item_id: string;
  shop_id: string;
  shop_name: string;
  owner_id: string;
  kind: ShopItemKind;
  subtype: string;
  title: string;
  description: string;
  price_cents: number;
  ai_checked_at: string | null;
  ai_flag_reason: string | null;
  text_flag_reason: string | null;
  approved_items: number;
  photo_paths: string[];
}

export async function fetchPendingShopItems(): Promise<PendingShopItem[]> {
  return (rpcData(await supabase.rpc("shops_admin_pending_items"), (e) => rpcErrorMessage("shops_admin_pending_items", e)) ?? []) as unknown as PendingShopItem[];
}

export async function reviewShopItem(itemId: string, approve: boolean, note: string | null): Promise<string> {
  return rpcData(
    await supabase.rpc("shops_admin_review_item", { p_item_id: itemId, p_approve: approve, p_note: note ?? "" }),
    (e) => rpcErrorMessage("shops_admin_review_item", e),
  ) as string;
}

/** "$18" or "$18.50". */
export function formatItemPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** "Ready now (6 left)", "Sold out", "Ready in 2 days", "Ready the same day". */
export function readinessLabel(item: Pick<ShopItem, "stock_count" | "lead_time_days">): string {
  if (item.stock_count != null) return item.stock_count > 0 ? `Ready now (${item.stock_count} left)` : "Sold out for now";
  if (item.lead_time_days === 0) return "Ready the same day";
  return `Ready in ${item.lead_time_days} ${item.lead_time_days === 1 ? "day" : "days"}`;
}
