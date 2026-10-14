/**
 * Declutter client calls (docs/specs/declutter-auctions.md). Every write is a
 * declutter_* RPC (no client role can write a Declutter table); each one
 * refuses server-side without the 'declutter' switch, so this file is never
 * the protection. Errors are thrown as they come from Supabase; screens turn
 * them into plain words with declutterErrorMessage().
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto, listingPhotoPath, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";

const DECLUTTER_PHOTO_BUCKET = "job-photos";

/**
 * A Declutter RPC's data, or a throw carrying the plain words for its refusal
 * (RPC_ERROR_COPY via rpcErrorMessage at each call site, the rpcErrorCopyCoverage
 * rule) on `userMessage`, the original error kept as `cause` for reporting.
 */
function rpcData<T>(result: { data: T; error: { message: string } | null; status?: number }, words: (e: unknown) => string | null): T {
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

export type DeclutterStatus =
  | "draft" | "pending_review" | "live" | "reserved" | "sold" | "completed"
  | "ended" | "withdrawn" | "rejected" | "removed";

export type DeliverySize = "small" | "large" | "xl";

export interface DeclutterItem {
  id: string;
  seller_id: string;
  status: DeclutterStatus;
  title: string;
  description: string;
  category: string;
  condition_stars: number;
  delivery_size: DeliverySize;
  price_cents: number;
  current_price_cents: number;
  area_label: string;
  area_lat: number;
  area_lng: number;
  created_at: string;
  live_at: string | null;
}

export interface DeclutterPhoto {
  id: string;
  item_id: string;
  storage_path: string;
  position: number;
}

export interface DeclutterQuestion {
  id: string;
  item_id: string;
  asker_id: string;
  question: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

export interface DraftFields {
  title: string;
  description: string;
  category: string;
  conditionStars: number;
  deliverySize: DeliverySize;
  priceCents: number;
  floorPriceCents: number;
  areaLabel: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
}

const ITEM_COLUMNS =
  "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at";

/** Live (and reserved) listings the switch lets this member read; RLS decides. */
export async function fetchLiveItems(): Promise<DeclutterItem[]> {
  const rows = unwrap(
    await supabase
      .from("declutter_items")
      .select(ITEM_COLUMNS)
      .in("status", ["live", "reserved"])
      .order("live_at", { ascending: false })
      .limit(500),
  );
  return (rows ?? []) as DeclutterItem[];
}

/** The member's own listings, every status. */
export async function fetchMyItems(userId: string): Promise<DeclutterItem[]> {
  const rows = unwrap(
    await supabase.from("declutter_items").select(ITEM_COLUMNS).eq("seller_id", userId).order("created_at", { ascending: false }),
  );
  return (rows ?? []) as DeclutterItem[];
}

export async function fetchItem(itemId: string): Promise<DeclutterItem | null> {
  const row = unwrap(await supabase.from("declutter_items").select(ITEM_COLUMNS).eq("id", itemId).maybeSingle());
  return (row ?? null) as DeclutterItem | null;
}

export async function fetchPhotos(itemIds: string[]): Promise<DeclutterPhoto[]> {
  if (itemIds.length === 0) return [];
  const rows = unwrap(
    await supabase
      .from("declutter_item_photos")
      .select("id, item_id, storage_path, position")
      .in("item_id", itemIds)
      .order("position", { ascending: true }),
  );
  return (rows ?? []) as DeclutterPhoto[];
}

export async function fetchQuestions(itemId: string): Promise<DeclutterQuestion[]> {
  const rows = unwrap(
    await supabase
      .from("declutter_questions")
      .select("id, item_id, asker_id, question, answer, answered_at, created_at")
      .eq("item_id", itemId)
      .order("created_at", { ascending: true }),
  );
  return (rows ?? []) as DeclutterQuestion[];
}

export async function fetchWatching(userId: string): Promise<Set<string>> {
  const rows = unwrap(await supabase.from("declutter_watchlist").select("item_id").eq("user_id", userId));
  return new Set((rows ?? []).map((r: { item_id: string }) => r.item_id));
}

export async function fetchMyPickupWindows(userId: string) {
  const rows = unwrap(
    await supabase
      .from("declutter_pickup_windows")
      .select("weekday, starts_local, ends_local")
      .eq("seller_id", userId)
      .order("weekday", { ascending: true }),
  );
  return (rows ?? []) as { weekday: number; starts_local: string; ends_local: string }[];
}

export function photoPublicUrl(path: string): string {
  return supabase.storage.from(DECLUTTER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** The seller's shared star rating (the jobs' public aggregate, row 45). */
export async function fetchSellerRating(sellerId: string): Promise<{ avg: number; count: number } | null> {
  const rows = unwrap(await supabase.rpc("get_public_profile_stats", { p_user_ids: [sellerId] })) ?? [];
  const row = (rows as { user_id: string; avg_rating: number | null; review_count: number | null }[]).find((r) => r.user_id === sellerId);
  return row ? { avg: Number(row.avg_rating ?? 0), count: row.review_count ?? 0 } : null;
}

export async function setWatch(itemId: string, watch: boolean): Promise<string> {
  return rpcData(await supabase.rpc("declutter_set_watch", { p_item_id: itemId, p_watch: watch }), (e) => rpcErrorMessage("declutter_set_watch", e)) as string;
}

export async function askQuestion(itemId: string, question: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_ask_question", { p_item_id: itemId, p_question: question }), (e) => rpcErrorMessage("declutter_ask_question", e)) as string;
}

export async function answerQuestion(questionId: string, answer: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_answer_question", { p_question_id: questionId, p_answer: answer }), (e) => rpcErrorMessage("declutter_answer_question", e)) as string;
}

const draftArgs = (f: DraftFields) => ({
  p_title: f.title,
  p_description: f.description,
  p_category: f.category,
  p_condition_stars: f.conditionStars,
  p_delivery_size: f.deliverySize,
  p_price_cents: f.priceCents,
  p_floor_price_cents: f.floorPriceCents,
  p_area_label: f.areaLabel,
  p_pickup_address: f.pickupAddress,
  p_pickup_lat: f.pickupLat,
  p_pickup_lng: f.pickupLng,
});

export async function createDraft(f: DraftFields): Promise<string> {
  return rpcData(await supabase.rpc("declutter_create_item", draftArgs(f)), (e) => rpcErrorMessage("declutter_create_item", e)) as string;
}

export async function updateDraft(itemId: string, f: DraftFields): Promise<string> {
  return rpcData(await supabase.rpc("declutter_update_draft", { p_item_id: itemId, ...draftArgs(f) }), (e) => rpcErrorMessage("declutter_update_draft", e)) as string;
}

/**
 * Clean, upload and attach one photo. The object is uploaded first (the
 * server only attaches an object that exists and is the seller's); when the
 * attach is refused the object is deleted again, best effort, and the
 * refusal is thrown.
 */
export async function addPhoto(sellerId: string, itemId: string, file: File): Promise<string> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = listingPhotoPath(sellerId, itemId, nonce);
  const bucket = supabase.storage.from(DECLUTTER_PHOTO_BUCKET);
  const { error: upErr } = await bucket.upload(path, cleaned, {
    contentType: "image/jpeg",
    upsert: false,
    // A fresh random name per upload: the object never changes (Q655).
    cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL,
  });
  if (upErr) throw new Error("photo_not_uploaded");
  const { data, error } = await supabase.rpc("declutter_add_item_photo", { p_item_id: itemId, p_storage_path: path });
  if (error) {
    const { error: rmErr } = await bucket.remove([path]);
    if (rmErr) console.warn("[declutter] could not remove a refused photo upload", rmErr.message);
    const words = rpcErrorMessage("declutter_add_item_photo", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
  return data as string;
}

/** Remove storage objects the server detached (photo removed, listing withdrawn). */
async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(DECLUTTER_PHOTO_BUCKET).remove(paths);
  // The rows are already gone; a failed object delete leaves an unattached
  // object the seller's account deletion (or a retry) still removes (B4/B5).
  if (error) console.warn("[declutter] photo objects not removed", error.message);
}

export async function removePhoto(photoId: string): Promise<void> {
  const path = rpcData(await supabase.rpc("declutter_remove_item_photo", { p_photo_id: photoId }), (e) => rpcErrorMessage("declutter_remove_item_photo", e));
  await removeObjects(path ? [path as string] : []);
}

export async function withdrawItem(itemId: string): Promise<void> {
  const paths = rpcData(await supabase.rpc("declutter_withdraw_item", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_withdraw_item", e));
  await removeObjects((paths ?? []) as string[]);
}

export async function attestItem(itemId: string): Promise<void> {
  rpcData(
    await supabase.rpc("declutter_attest_item", {
      p_item_id: itemId,
      p_bought_for_personal_use: true,
      p_not_in_the_business: true,
      p_not_a_frequent_seller: true,
      p_keeps_item_until_handover: true,
    }), (e) => rpcErrorMessage("declutter_attest_item", e));
}

// A type alias (not an interface) so it is assignable to the RPC's Json arg without a cast.
export type PickupWindow = {
  weekday: number;
  starts: string;
  ends: string;
};

export async function setPickupWindows(windows: PickupWindow[]): Promise<number> {
  return rpcData(await supabase.rpc("declutter_set_pickup_windows", { p_windows: windows }), (e) => rpcErrorMessage("declutter_set_pickup_windows", e)) as number;
}

export async function publishItem(itemId: string): Promise<"pending_review" | "live"> {
  return rpcData(await supabase.rpc("declutter_publish_item", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_publish_item", e)) as "pending_review" | "live";
}

export async function fetchMyItemPrivate(itemId: string) {
  const rows = rpcData(await supabase.rpc("declutter_seller_item_private", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_seller_item_private", e));
  return (rows ?? [])[0] ?? null;
}

export async function fetchMyItemReview(itemId: string) {
  const rows = rpcData(await supabase.rpc("declutter_my_item_review", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_my_item_review", e));
  return (rows ?? [])[0] ?? null;
}

/** AI draft from the item's uploaded photos (edge function declutter-ai-draft). */
export interface AiDraft {
  title: string;
  description: string;
  category: string;
  deliverySize: DeliverySize;
  conditionStars: number;
  flagged: boolean;
}

async function invokeAi(itemId: string, mode: "draft" | "check"): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("declutter-ai-draft", { body: { itemId, mode } });
  if (error) {
    // FunctionsHttpError keeps the JSON body on its context.
    const ctx = (error as { context?: Response }).context;
    const body: { error?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: fall through to ai_unavailable.
          console.warn("[declutter] AI error body was not JSON", parseErr);
          return null;
        })
      : null;
    const code = typeof body?.error === "string" ? body.error : "";
    throw new Error(code || "ai_unavailable");
  }
  return data;
}

/** Suggestions from the photos for the seller to edit (row 32). Saves nothing. */
export async function requestAiDraft(itemId: string): Promise<AiDraft> {
  return (await invokeAi(itemId, "draft")) as AiDraft;
}

/**
 * The banned-item check of the SAVED listing (row 34), recorded server-side.
 * Run right before publishing; if it fails the listing still publishes, to
 * an admin's review (the server's fail-safe), so the caller may ignore it.
 */
export async function requestAiCheck(itemId: string): Promise<{ checked: boolean; flagged: boolean }> {
  return (await invokeAi(itemId, "check")) as { checked: boolean; flagged: boolean };
}

/** Admin queue (row 33, B8). */
export async function fetchPendingForAdmin() {
  return rpcData(await supabase.rpc("declutter_admin_pending_items"), (e) => rpcErrorMessage("declutter_admin_pending_items", e)) ?? [];
}

export async function reviewListing(itemId: string, approve: boolean, note: string | null): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_admin_review_item", { p_item_id: itemId, p_approve: approve, p_note: note ?? "" }), (e) => rpcErrorMessage("declutter_admin_review_item", e)) as string;
}
