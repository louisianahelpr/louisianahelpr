/**
 * LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM, POST-H3): on a "Have a Helpr list it" job the hired Helpr writes the
 * Declutter listings ON THE SELLER'S ACCOUNT. They wait as "awaiting your approval" in the seller's Selling tab; the
 * seller approves each (or all at once) and only then does one go live, through the normal publish path. Server rules:
 * migration 20261101034159_declutter_list_for_seller.sql (the Helpr only ever touches drafts of THAT open job, never
 * the seller's other listings, and never publishes). The job is done for the Helpr once the listings are SENT.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { DECLUTTER_PHOTO_BUCKET, purgeQueuedPhotos, rpcData } from "./api";
import { cleanListingPhoto, listingPhotoPath } from "./photos";

/** One listing of the job, as the Helpr sees it. After the seller decides, only "approved" or "declined". */
export interface HelprJobListing {
  item_id: string;
  title: string;
  description: string;
  category: string;
  condition_stars: number;
  delivery_size: string;
  price_cents: number;
  floor_price_cents: number;
  area_label: string;
  status: "draft" | "pending_seller_approval" | "approved" | "declined";
  photo_count: number;
  sent_at: string | null;
}

interface HelprListingFields {
  title: string;
  description: string;
  category: string;
  conditionStars: number;
  deliverySize: string;
  priceCents: number;
  floorPriceCents: number;
}

/** A listing waiting for the seller's OK. */
interface ListedForMe {
  item_id: string;
  job_id: string;
  title: string;
  price_cents: number;
  /** The lowest price the Helpr set (equal to the price when they set none). */
  floor_price_cents: number | null;
  helpr_first_name: string;
  sent_at: string | null;
}

/** One row of an approval: live / pending_review, or why it stays waiting. */
export interface ApprovalResult {
  item_id: string;
  status?: "live" | "pending_review";
  error?: string;
}

export async function fetchHelprJobListings(jobId: string): Promise<HelprJobListing[]> {
  const rows = rpcData(await supabase.rpc("declutter_helpr_job_listings", { p_job_id: jobId }),
    (e) => rpcErrorMessage("declutter_helpr_job_listings", e));
  return (rows ?? []) as HelprJobListing[];
}

export async function helprCreateListing(jobId: string, f: HelprListingFields, areaLabel: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_helpr_create_listing", {
    p_job_id: jobId, p_title: f.title, p_description: f.description, p_category: f.category,
    p_condition_stars: f.conditionStars, p_delivery_size: f.deliverySize, p_price_cents: f.priceCents,
    p_floor_price_cents: f.floorPriceCents, p_area_label: areaLabel,
  }), (e) => rpcErrorMessage("declutter_helpr_create_listing", e)) as string;
}

/** Edits the Helpr's own unsent draft (the area stays as written; the server refuses a sent one: item_not_a_draft). */
export async function helprUpdateListing(itemId: string, f: HelprListingFields): Promise<void> {
  rpcData(await supabase.rpc("declutter_helpr_update_listing", {
    p_item_id: itemId, p_title: f.title, p_description: f.description, p_category: f.category,
    p_condition_stars: f.conditionStars, p_delivery_size: f.deliverySize, p_price_cents: f.priceCents,
    p_floor_price_cents: f.floorPriceCents,
  }), (e) => rpcErrorMessage("declutter_helpr_update_listing", e));
}

/** The photo is the Helpr's own upload at `<helpr id>/declutter/<item id>/<name>` in job-photos. */
async function helprAddListingPhoto(itemId: string, storagePath: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_helpr_add_listing_photo", { p_item_id: itemId, p_storage_path: storagePath }),
    (e) => rpcErrorMessage("declutter_helpr_add_listing_photo", e)) as string;
}

/**
 * Clean and upload one photo into the HELPR's own folder for this item (the storage policy lets a member write only
 * their own folder), then attach it; a refused attach removes the upload again, best effort.
 */
export async function helprUploadListingPhoto(helprId: string, itemId: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = listingPhotoPath(helprId, itemId, nonce);
  const bucket = supabase.storage.from(DECLUTTER_PHOTO_BUCKET);
  const up = await bucket.upload(path, cleaned, { contentType: "image/jpeg", upsert: false, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
  if (up.error) throw Object.assign(new Error("photo_not_uploaded"), { userMessage: "That photo didn't upload. Try again." });
  try {
    return await helprAddListingPhoto(itemId, path);
  } catch (e) {
    const { error: rmErr } = await bucket.remove([path]);
    if (rmErr) console.warn("[declutter] could not remove a refused Helpr photo upload", rmErr.message);
    throw e;
  }
}

/**
 * Deletes the Helpr's unsent draft, then its photo objects: they sit in the Helpr's OWN folder
 * (`<helpr>/declutter/<item>/`), so only the Helpr can remove them, and once the rows are gone nothing else names
 * them. Best effort after the delete went through: a failed object delete is logged, never shown as a failed delete.
 */
export async function helprDeleteListing(helprId: string, itemId: string): Promise<void> {
  rpcData(await supabase.rpc("declutter_helpr_delete_listing", { p_item_id: itemId }),
    (e) => rpcErrorMessage("declutter_helpr_delete_listing", e));
  if (!helprId) return;
  const bucket = supabase.storage.from(DECLUTTER_PHOTO_BUCKET);
  const folder = `${helprId}/declutter/${itemId}`;
  const { data, error } = await bucket.list(folder, { limit: 100 });
  if (error) {
    console.warn("[declutter] could not list a deleted draft's photos", error.message);
    return;
  }
  const paths = (data ?? []).map((o) => `${folder}/${o.name}`);
  if (paths.length === 0) return;
  const { error: rmErr } = await bucket.remove(paths);
  if (rmErr) console.warn("[declutter] could not remove a deleted draft's photos", rmErr.message);
}

/** Sends every draft of the job to the seller; returns how many went. */
export async function helprSendListings(jobId: string): Promise<number> {
  return rpcData(await supabase.rpc("declutter_helpr_send_listings", { p_job_id: jobId }),
    (e) => rpcErrorMessage("declutter_helpr_send_listings", e)) as number;
}

export async function fetchListedForMe(): Promise<ListedForMe[]> {
  const rows = rpcData(await supabase.rpc("declutter_listed_for_me"), (e) => rpcErrorMessage("declutter_listed_for_me", e));
  return (rows ?? []) as ListedForMe[];
}

/**
 * The seller's approval of one or many: one tick of the four sales-tax statements (TAX_STATEMENTS, as on every sell
 * form) covers each, then each goes through the normal publish path. Run the photo check after for each one that is up.
 */
export async function approveListedForMe(itemIds: string[]): Promise<ApprovalResult[]> {
  const out = rpcData(await supabase.rpc("declutter_approve_listed_for_me", {
    p_item_ids: itemIds,
    p_bought_for_personal_use: true,
    p_not_in_the_business: true,
    p_not_a_frequent_seller: true,
    p_keeps_item_until_handover: true,
  }), (e) => rpcErrorMessage("declutter_approve_listed_for_me", e));
  return (Array.isArray(out) ? out : []) as unknown as ApprovalResult[];
}

export async function declineListedForMe(itemId: string): Promise<void> {
  rpcData(await supabase.rpc("declutter_decline_listed_for_me", { p_item_id: itemId }),
    (e) => rpcErrorMessage("declutter_decline_listed_for_me", e));
  // The decline detached the listing's photos (they sit in the Helpr's folder): the server removes them (B63).
  await purgeQueuedPhotos();
}
