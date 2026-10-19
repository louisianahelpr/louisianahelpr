/**
 * Homes -> Rent listings (20261019043000) data access. Every write is an RPC
 * (no client write privilege on the tables). Browsing and the listing page go
 * through definer RPCs that return the coarse fields only (city + ZIP, never
 * the street: Q12); the owner reads their own rows directly (owner-only RLS).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { loadAdminRpcErrorCopy, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { removeShopObjects } from "@/lib/shops/storageCleanup";
import { RentalsCopyError } from "./copy";

type Fns = Database["public"]["Functions"];
export type RentalListing = Database["public"]["Tables"]["rental_listings"]["Row"];
/** The owner's editor list (rentals_my_listing_photos): id, order and an owner photo ref. Never a path. */
export type RentalListingPhoto = Fns["rentals_my_listing_photos"]["Returns"][number];
export type BrowseListing = Fns["rentals_browse_listings"]["Returns"][number];
export type BrowseSaleListing = Fns["rentals_browse_sale_listings"]["Returns"][number];
export type ListingDetail = Fns["rentals_listing"]["Returns"][number];

/**
 * Listing photos live in the PRIVATE listing-photos bucket under
 * <owner uid>/rental-listings/<listing id>/ (20261019071203; purged with the
 * account). Nobody reads them from Storage: every read returns signed photo
 * refs and the listing-photo edge function serves the re-encoded, metadata-free
 * image (Q2211-Q2213). Only the owner's upload and clean-up name the path.
 */
const LISTING_PHOTO_BUCKET = "listing-photos";

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
  // The CURRENT listings only, newest first, so an old removed row never hides the live one (lead review must-fix 3).
  // A take-down is shown from the property (listings_taken_down_reason), not from a removed row.
  const res = await supabase.from("rental_listings").select("*").eq("owner_id", uid).neq("status", "removed").order("created_at", { ascending: false });
  if (res.error && listingsNotDeployed(res.error)) return [];
  return (unwrap(res) ?? []) as RentalListing[];
}

/** The owner's own listing photos, in order, as owner refs (no path). */
export async function fetchListingPhotos(listingId: string): Promise<RentalListingPhoto[]> {
  const res = await supabase.rpc("rentals_my_listing_photos", { p_listing_id: listingId });
  if (res.error && listingsNotDeployed(res.error)) return [];
  return (unwrap(res) ?? []) as RentalListingPhoto[];
}

/**
 * One listing photo by its signed ref (from any listing read), through the
 * listing-photo edge function: re-encoded, stripped of location metadata, and
 * served only while the ref's rule still holds (Q2211, Q2212).
 */
export function listingPhotoUrl(ref: string, width = 640): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/listing-photo?r=${encodeURIComponent(ref)}&w=${width}`;
}

/** True when a photo ref's expiry (its third part, epoch seconds) has passed or is within a minute. */
export function listingRefExpired(ref: string, now = Date.now()): boolean {
  const exp = Number(ref.split(".")[2]);
  return !Number.isFinite(exp) || exp * 1000 <= now + 60_000;
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

/**
 * "review": the call went through but a lister's FIRST listing waits for an
 * admin instead of going live (owner 2026-10-19; 20261019185022). Read back
 * from the row the owner can see, so the toast never says "live" when it isn't.
 */
export async function setListingStatus(listingId: string, status: "live" | "paused" | "leased" | "sold" | "removed"): Promise<"done" | "review"> {
  const { error } = await supabase.rpc("rentals_set_listing_status", { p_listing_id: listingId, p_status: status });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_set_listing_status", error), error);
  if (status !== "live") return "done";
  const row = unwrap(await supabase.from("rental_listings").select("status, first_review").eq("id", listingId).maybeSingle());
  return row && row.status !== "live" && row.first_review === "pending_review" ? "review" : "done";
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

/** Admin -> Settings, Homes listings (Q2187): live/paused listings to take down, and properties under a take-down. */
export interface AdminListings {
  open: { id: string; kind: "rent" | "sale"; status: string; headline: string; slug: string; published_at: string | null; property_label: string; city: string; zip_code: string }[];
  open_total: number;
  taken_down: { property_id: string; property_label: string; city: string; zip_code: string; reason: string | null; taken_down_at: string }[];
  taken_down_total: number;
  page_size: number;
}

/** One page of each list (the server's page size, 25), filtered by a link code, headline/label words or a ZIP (round 4 #5). */
export async function fetchAdminListings(query = "", openOffset = 0, takenOffset = 0): Promise<AdminListings> {
  const data = unwrap(
    await supabase.rpc("rentals_admin_listings", { p_query: query.trim() || undefined, p_open_offset: openOffset, p_taken_offset: takenOffset }),
  ) as unknown as Partial<AdminListings> | null;
  return {
    open: data?.open ?? [],
    open_total: data?.open_total ?? 0,
    taken_down: data?.taken_down ?? [],
    taken_down_total: data?.taken_down_total ?? 0,
    page_size: data?.page_size ?? 25,
  };
}

/**
 * Takes down a live or paused listing's whole property (every open listing on it), with a reason the owner
 * sees. Admin-only: its copy lives in ADMIN_RPC_ERROR_COPY and is fetched only on a refusal.
 */
export async function adminRemoveListing(listingId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_admin_remove_listing", { p_listing_id: listingId, p_reason: reason });
  if (!error) return;
  const admin = await loadAdminRpcErrorCopy();
  throw new RentalsCopyError(admin?.rpcErrorMessage("rentals_admin_remove_listing", error) ?? null, error);
}

/** Lifts a mistaken take-down: the listings go back to draft or paused for the owner to publish again. Admin-only copy, as above. */
export async function adminLiftTakedown(propertyId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_admin_lift_takedown", { p_property_id: propertyId, p_note: note });
  if (!error) return;
  const admin = await loadAdminRpcErrorCopy();
  throw new RentalsCopyError(admin?.rpcErrorMessage("rentals_admin_lift_takedown", error) ?? null, error);
}

/** The caller's own listing (owner-only RLS); null when it is not theirs or not there. */
export async function fetchMyListing(id: string): Promise<RentalListing | null> {
  return (unwrap(await supabase.from("rental_listings").select("*").eq("id", id).maybeSingle()) ?? null) as RentalListing | null;
}

/**
 * Admin -> Settings, Homes: a lister's FIRST listing waits for an admin before it goes live (owner 2026-10-19,
 * 20261019185022). The row is the listing plus what the admin checks it against; photo refs are owner-scope
 * and short-lived. first_review_submitted_at is passed back with the decision: an edit since then is refused.
 */
export interface FirstListingReview {
  id: string;
  kind: "rent" | "sale";
  status: string;
  headline: string;
  description: string;
  rent_cents: number | null;
  rent_frequency: string | null;
  sale_price_cents: number | null;
  beds: number;
  baths: number;
  owner_name: string | null;
  owner_id_verified: boolean;
  ownership_status: string;
  street_address: string;
  city: string;
  zip_code: string;
  photo_refs: string[];
  first_review_submitted_at: string;
}

export async function fetchFirstListingsQueue(): Promise<FirstListingReview[]> {
  const res = await supabase.rpc("rentals_admin_first_listings");
  // Before the migration deploys the queue simply isn't there yet: nothing waits.
  if (res.error && isMissingRpcNamed(res.error, "rentals_admin_first_listings")) return [];
  const data = unwrap(res) as unknown as FirstListingReview[] | null;
  return Array.isArray(data) ? data : [];
}

export async function reviewFirstListing(listingId: string, approve: boolean, note: string, submittedAt: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_admin_review_first_listing", {
    p_listing_id: listingId,
    p_approve: approve,
    p_note: note,
    p_submitted_at: submittedAt,
  });
  if (!error) return;
  const admin = await loadAdminRpcErrorCopy();
  throw new RentalsCopyError(admin?.rpcErrorMessage("rentals_admin_review_first_listing", error) ?? null, error);
}
