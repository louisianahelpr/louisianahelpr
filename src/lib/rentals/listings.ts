/**
 * Homes -> Rent listings (20261019043000) data access. Every write is an RPC
 * (no client write privilege on the tables). Browsing and the listing page go
 * through definer RPCs that return the coarse fields only (city + ZIP, never
 * the street: Q12); the owner reads their own rows directly (owner-only RLS).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { removeShopObjects } from "@/lib/shops/storageCleanup";
import { RentalsCopyError } from "./copy";

type Fns = Database["public"]["Functions"];
export type RentalListing = Database["public"]["Tables"]["rental_listings"]["Row"];
export type RentalListingPhoto = Database["public"]["Tables"]["rental_listing_photos"]["Row"];
export type BrowseListing = Fns["rentals_browse_listings"]["Returns"][number];
export type BrowseSaleListing = Fns["rentals_browse_sale_listings"]["Returns"][number];
export type ListingDetail = Fns["rentals_listing"]["Returns"][number];

/** Listing photos live in job-photos under <owner uid>/rental-listings/<listing id>/ (purged with the account). */
const LISTING_PHOTO_BUCKET = "job-photos";

/** The fields a landlord types; the server refuses any other key (no "who may live here" field exists). */
export interface ListingFields {
  headline: string;
  description: string;
  rent_cents: number;
  rent_frequency: "monthly" | "biweekly" | "weekly";
  deposit_cents: number | null;
  beds: number;
  baths: number;
  sq_ft: number | null;
  available_on: string;
  lease_months_min: number | null;
  lease_months_max: number | null;
  pets: "none" | "cats" | "dogs" | "cats_dogs" | "ask";
  pet_rules: string;
  parking: "none" | "street" | "driveway" | "garage" | "lot";
  utilities_included: string[];
  accepts_vouchers: "yes" | "ask";
  accessibility: string[];
}

/**
 * Homes -> Buy (20261019061241): what an owner types for a home for sale. No
 * rent, lease or deposit; the server refuses any other key.
 */
export interface SaleListingFields {
  headline: string;
  description: string;
  sale_price_cents: number;
  beds: number;
  baths: number;
  sq_ft: number | null;
  lot_sq_ft: number | null;
  year_built: number | null;
  parking: "none" | "street" | "driveway" | "garage" | "lot";
  accessibility: string[];
}

/**
 * Not deployed yet (the migration ships with this code; db-deploy runs on
 * merge): PostgREST answers PGRST202 for a missing function and PGRST205 for a
 * missing table. Until then there are simply no listings, never an error
 * screen (CLAUDE.md: a graceful PGRST202 fallback for brand-new RPCs).
 */
function listingsNotDeployed(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  return code === "PGRST202" || code === "PGRST205";
}

export async function fetchBrowseListings(filters: { city?: string; minBeds?: number | null; maxRentCents?: number | null } = {}): Promise<BrowseListing[]> {
  const res = await supabase.rpc("rentals_browse_listings", {
    p_city: filters.city?.trim() || undefined,
    p_min_beds: filters.minBeds ?? undefined,
    p_max_rent_cents: filters.maxRentCents ?? undefined,
  });
  if (res.error && listingsNotDeployed(res.error)) return [];
  return (unwrap(res) ?? []) as BrowseListing[];
}

/** Homes for sale (Buy). Same not-deployed fallback as Rent. */
export async function fetchBrowseSaleListings(filters: { city?: string; minBeds?: number | null; maxPriceCents?: number | null } = {}): Promise<BrowseSaleListing[]> {
  const res = await supabase.rpc("rentals_browse_sale_listings", {
    p_city: filters.city?.trim() || undefined,
    p_min_beds: filters.minBeds ?? undefined,
    p_max_price_cents: filters.maxPriceCents ?? undefined,
  });
  if (res.error && listingsNotDeployed(res.error)) return [];
  return (unwrap(res) ?? []) as BrowseSaleListing[];
}

/** One listing for its page; null when it is not there for this caller (paused, expired, removed, or someone else's draft). */
export async function fetchListing(id: string): Promise<ListingDetail | null> {
  const rows = unwrap(await supabase.rpc("rentals_listing", { p_listing_id: id })) as ListingDetail[] | null;
  return rows?.[0] ?? null;
}

export async function fetchMyListings(uid: string): Promise<RentalListing[]> {
  const res = await supabase.from("rental_listings").select("*").eq("owner_id", uid).neq("status", "removed").order("created_at");
  if (res.error && listingsNotDeployed(res.error)) return [];
  return (unwrap(res) ?? []) as RentalListing[];
}

export async function fetchListingPhotos(listingId: string): Promise<RentalListingPhoto[]> {
  return (unwrap(
    await supabase.from("rental_listing_photos").select("*").eq("listing_id", listingId).order("position"),
  ) ?? []) as RentalListingPhoto[];
}

export function listingPhotoUrl(path: string): string {
  return supabase.storage.from(LISTING_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Create a draft (listingId null, unitId set) or save an edit. Returns the listing id. */
export async function saveListing(listingId: string | null, unitId: string | null, fields: ListingFields): Promise<string> {
  const { data, error } = await supabase.rpc("rentals_save_listing", {
    // nullable-arg: NULL creates a new draft (rentals_save_listing's p_listing_id IS NULL branch).
    p_listing_id: listingId as string,
    // nullable-arg: NULL when editing an existing listing (the unit comes from the listing row).
    p_unit_id: unitId as string,
    p_fields: fields as unknown as Json,
  });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_save_listing", error), error);
  if (data == null) throw new Error("empty_response");
  return data;
}

/** Create a sale draft for a property (listingId null, propertyId set) or save an edit. Returns the listing id. */
export async function saveSaleListing(listingId: string | null, propertyId: string | null, fields: SaleListingFields): Promise<string> {
  const { data, error } = await supabase.rpc("rentals_save_sale_listing", {
    // nullable-arg: NULL creates a new draft (rentals_save_sale_listing's p_listing_id IS NULL branch).
    p_listing_id: listingId as string,
    // nullable-arg: NULL when editing an existing listing (the property comes from the listing row).
    p_property_id: propertyId as string,
    p_fields: fields as unknown as Json,
  });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_save_sale_listing", error), error);
  if (data == null) throw new Error("empty_response");
  return data;
}

export async function setListingStatus(listingId: string, status: "live" | "paused" | "leased" | "sold" | "removed"): Promise<void> {
  const { error } = await supabase.rpc("rentals_set_listing_status", { p_listing_id: listingId, p_status: status });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_set_listing_status", error), error);
}

/** Never throws; a miss is reported to Sentry with its count (the shared Shops cleanup). */
const removeObject = (path: string) => removeShopObjects(LISTING_PHOTO_BUCKET, [path], "rental listing photo");

/**
 * Clean (re-encode, no location metadata: Declutter's cleanListingPhoto),
 * upload and attach one photo. The object is uploaded first (the server
 * attaches only an object that exists and is the owner's, in this listing's
 * folder); when the attach is refused the object is deleted again.
 */
export async function addListingPhoto(ownerId: string, listingId: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const safe = nonce.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "photo";
  const path = `${ownerId}/rental-listings/${listingId}/${safe}.jpg`;
  const { error: upErr } = await supabase.storage.from(LISTING_PHOTO_BUCKET).upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (upErr) throw new RentalsCopyError(rpcErrorMessage("rentals_add_listing_photo", { message: "photo_not_uploaded" }), upErr);
  const { data, error } = await supabase.rpc("rentals_add_listing_photo", { p_listing_id: listingId, p_storage_path: path });
  if (error) {
    await removeObject(path);
    throw new RentalsCopyError(rpcErrorMessage("rentals_add_listing_photo", error), error);
  }
  if (data == null) throw new Error("empty_response");
  return data;
}

export async function removeListingPhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase.rpc("rentals_remove_listing_photo", { p_photo_id: photoId });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_remove_listing_photo", error), error);
  if (data) await removeObject(data);
}

/** The caller's own listing (owner-only RLS); null when it is not theirs or not there. */
export async function fetchMyListing(id: string): Promise<RentalListing | null> {
  return (unwrap(await supabase.from("rental_listings").select("*").eq("id", id).maybeSingle()) ?? null) as RentalListing | null;
}
