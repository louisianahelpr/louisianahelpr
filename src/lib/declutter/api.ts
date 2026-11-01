/**
 * Declutter client calls (docs/specs/declutter-auctions.md). Every write is a
 * declutter_* RPC (no client role can write a Declutter table); each one
 * refuses server-side without the 'declutter' switch, so this file is never
 * the protection. Errors are thrown as they come from Supabase; screens turn
 * them into plain words with declutterErrorMessage().
 */
import { uploadSteadily, PhotoUploadRefused, type UploadHooks } from "@/lib/declutter/steadyUpload";
import { isNetworkFailure } from "@/lib/networkFailure";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage, unwrap } from "@/lib/supabaseResult";
import { loadAdminRpcErrorCopy, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { blobToBase64, cleanListingPhoto, listingPhotoPath, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { AI_DRAFT_PHOTOS } from "@/lib/declutter/photoRules";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { isNativePlatform } from "@/lib/nativeInit";
import { offerPushAfterAction } from "@/hooks/useNotificationPermissionPrompt";
import { identityRefusal, openIdentityCheck } from "@/lib/identityCheck";
import { freeClaimFeeRefusal, openFreeClaimFirstTime, promptAccountSetupFee, setupFeeRefusal } from "@/lib/declutter/setupFee";
import { pickRequestedProfile, type SafeProfileIdRow } from "@/lib/safeProfiles";
import { takeMinePrefetch } from "@/lib/declutter/minePrefetchTake";
import { takeFirstScreenDropStates, takeFirstScreenItems, takeFirstScreenPhotos, takeFirstScreenWatching } from "@/lib/declutter/bootPrefetch";

/** Row 24 handover choices open at launch (row 63: Helpr delivery comes later). */
/** Slice 5 adds "delivery": a Helpr picks it up and brings it (rows 24, 29-30, 40-43). */
/** 20261027153244 adds "seller_delivery": the seller brings it at a time the buyer picks (switch declutter_seller_delivery). */
// Q2425 (20261027204500): "meetup" is a safe public spot an admin curated; the seller's address is never shared.
export type Handover = "pickup_home" | "porch" | "delivery" | "seller_delivery" | "meetup";

export const DECLUTTER_PHOTO_BUCKET = "job-photos";

/** A Declutter refusal that is the ID check (identity_required_to_buy / _to_list) opens the one ID sheet. */
function openIdentitySheetFor(err: unknown): void {
  const kind = identityRefusal(err);
  if (kind === "buy" || kind === "list" || kind === "claim") openIdentityCheck(kind);
  // A first free claim (owner 2026-10-30): the one-time fee first, on its one short screen.
  else if (freeClaimFeeRefusal(err)) openFreeClaimFirstTime();
  // Q2352: the first listing's one-time setup fee (after the ID check): offer the fee page.
  else if (setupFeeRefusal(err)) promptAccountSetupFee();
}

/**
 * A Declutter RPC's data, or a throw carrying the plain words for its refusal
 * (RPC_ERROR_COPY via rpcErrorMessage at each call site, the rpcErrorCopyCoverage
 * rule) on `userMessage`, the original error kept as `cause` for reporting.
 */
export function rpcData<T>(result: { data: T; error: { message: string } | null; status?: number }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data;
  // Stripe Identity once, at the first Declutter purchase or listing (20261021202226): open the one ID sheet
  // instead of a dead-end message. A trigger raises it under any buy/list RPC, so it is read here, for all.
  openIdentitySheetFor(result.error);
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
  | "draft" | "pending_review" | "live" | "paused" | "reserved" | "sold" | "completed"
  | "ended" | "withdrawn" | "rejected" | "removed"
  // Declutter audit 2 A2-5 (20261028192719): the seller sold it somewhere else; kept in their history.
  | "sold_elsewhere"
  // LEAD-LIST-FOR-SELLER (20261101034159): written by the seller's hired Helpr, waiting for the seller's approval.
  | "pending_seller_approval";

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
  /** Row 101: porch pickup allowed (the default). False = meet at the seller's home only. */
  porch_ok: boolean;
  /** Smart offers (20261029162620): false = Buy only, the item page shows no "Make an offer". Absent = on (older fixtures, other reads). */
  accepts_offers?: boolean;
  /** The ways the seller ticked (20261028235247); read only on the seller's own list (fetchMyItems). */
  handovers?: SellerHandover[] | null;
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
  "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers";

type ItemRead = { data: unknown; error: { message: string; code?: string } | null; status?: number };
/** Columns a newer migration adds, with the default an item has before it is live (each column's own DEFAULT). */
const NEWER_ITEM_COLUMNS: Record<string, boolean> = { porch_ok: true, accepts_offers: true };

/**
 * Row 101's column, porch_ok (20261017055504), and smart offers' accepts_offers
 * (20261029162620) reach prod through db-deploy, and the web app through
 * prod-deploy; both start on the push to main, in no fixed order. If the app is
 * live first, the read is refused with 42703 naming the column: read again
 * without it, every item at that column's default (porch on, offers on). Every
 * other refusal is thrown as before. Remove a column's entry once its migration
 * is live on prod (lh-money-escrow review, porch default #2).
 */
async function readItems(run: (columns: string) => PromiseLike<ItemRead>): Promise<unknown> {
  let columns = ITEM_COLUMNS;
  const defaults: Record<string, boolean> = {};
  for (;;) {
    const res = await run(columns);
    const missing = res.error?.code === "42703"
      ? Object.keys(NEWER_ITEM_COLUMNS).find((c) => !(c in defaults) && res.error!.message.includes(c))
      : undefined;
    if (!missing) {
      const data = unwrap(res);
      if (Object.keys(defaults).length === 0) return data;
      const fill = (r: unknown) => (r && typeof r === "object" ? { ...r, ...defaults } : r);
      return Array.isArray(data) ? data.map(fill) : fill(data);
    }
    defaults[missing] = NEWER_ITEM_COLUMNS[missing];
    columns = columns.replace(`, ${missing}`, "");
  }
}

/** Live (and reserved) listings the switch lets this member read; RLS decides. */
export async function fetchLiveItems(): Promise<DeclutterItem[]> {
  // Started at boot on a cold /declutter (src/boot/declutterPrefetch.ts); taken once. Failed, old, not deployed yet, or
  // a list longer than the answer: ask as before. It leaves out the member's own listings; every caller drops them.
  const prefetched = await takeFirstScreenItems();
  if (prefetched) return prefetched as unknown as DeclutterItem[];
  const rows = await readItems((cols) =>
    supabase
      .from("declutter_items")
      .select(cols)
      .in("status", ["live", "reserved"])
      .order("live_at", { ascending: false })
      .limit(500),
  );
  return (rows ?? []) as DeclutterItem[];
}

/** A Browse map pin: the item's ROUGH AREA (owner 2026-10-28), never its pickup point. */
export interface DeclutterMapPin {
  lat: number;
  lng: number;
}

/**
 * The Browse map's pins, one per listed item (declutter_map_pins, 20261028151144): the item's public area point
 * (the 2-decimal cell) moved up to 300 m ON THE SERVER by a salted, stable offset; the server never even reads the
 * pickup point for it, so the seller's house never reaches the browser. The map
 * plots these and nothing else (never area_lat/area_lng). Before the RPC is deployed: no pins (an empty map), never
 * a fallback to another point.
 */
export async function fetchMapPins(): Promise<Map<string, DeclutterMapPin>> {
  const res = await supabase.rpc("declutter_map_pins");
  if (res.error && isMissingRpcNamed(res.error, "declutter_map_pins")) {
    console.warn("[declutter] declutter_map_pins not deployed yet; the map shows no pins");
    return new Map();
  }
  const rows = rpcData(res, (e) => rpcErrorMessage("declutter_map_pins", e)) ?? [];
  return new Map(rows.map((r) => [r.item_id, { lat: Number(r.pin_lat), lng: Number(r.pin_lng) }]));
}

/**
 * The item page's "More from this seller" row: the seller's other live (and
 * reserved) listings, newest first. The same table read as Browse, so RLS and
 * the 'declutter' switch decide exactly as they do there; no private field.
 */
export async function fetchSellerItems(sellerId: string, exceptItemId: string): Promise<DeclutterItem[]> {
  const rows = await readItems((cols) =>
    supabase
      .from("declutter_items")
      .select(cols)
      .eq("seller_id", sellerId)
      .in("status", ["live", "reserved"])
      .neq("id", exceptItemId)
      .order("live_at", { ascending: false })
      .limit(12),
  );
  return (rows ?? []) as DeclutterItem[];
}

/**
 * The item page's "Similar items" row: other sellers' live listings in the
 * same category, newest first (this seller's own are in the row above).
 */
export async function fetchSimilarItems(category: string, exceptItemId: string, sellerId: string): Promise<DeclutterItem[]> {
  const rows = await readItems((cols) =>
    supabase
      .from("declutter_items")
      .select(cols)
      .eq("category", category)
      .in("status", ["live", "reserved"])
      .neq("id", exceptItemId)
      .neq("seller_id", sellerId)
      .order("live_at", { ascending: false })
      .limit(12),
  );
  return (rows ?? []) as DeclutterItem[];
}

/** The member's own listings, every status. */
export async function fetchMyItems(userId: string): Promise<DeclutterItem[]> {
  // B81: started at boot on a cold /declutter (src/boot/declutterMinePrefetch.ts); taken once, for this member.
  const prefetched = await takeMinePrefetch("items", userId);
  if (prefetched) return prefetched as DeclutterItem[];
  const rows = await readItems((cols) =>
    // B48 live check 2026-10-29: the Selling row names every way the seller ticked (handovers), not only the porch.
    supabase.from("declutter_items").select(`${cols}, handovers`).eq("seller_id", userId).order("created_at", { ascending: false }),
  );
  return (rows ?? []) as DeclutterItem[];
}

/** These items' statuses now (RLS: the seller's own). An id with no row is gone: taken down, or never there. */
export async function fetchItemStatuses(itemIds: string[]): Promise<Map<string, string>> {
  const rows = unwrap(await supabase.from("declutter_items").select("id, status").in("id", itemIds));
  return new Map((rows ?? []).map((r) => [r.id, r.status]));
}

/** One of the seller's sales: what the item sold for and its order (deep audit #60 reads the order's payout). */
export interface MySale {
  cents: number;
  orderId: string | null;
}

/**
 * What each of the seller's sold items sold for (deep audit SE-5, 2026-10-28: Selling showed the $40 list price on
 * a mug that sold for $32), and its order: the paid cart line's price and order_id, by item id; the newest paid line
 * wins. RLS lets each side read its own lines ("declutter cart: the two sides read"). Not declutter_my_cart: it stops
 * at 30 days.
 */
export async function fetchMySales(userId: string): Promise<Map<string, MySale>> {
  const rows = unwrap(
    await supabase
      .from("declutter_cart_items")
      .select("item_id, price_cents, order_id")
      .eq("seller_id", userId)
      .eq("status", "paid")
      .order("closed_at", { ascending: false }),
  ) as { item_id: string | null; price_cents: number; order_id: string | null }[] | null;
  const sales = new Map<string, MySale>();
  for (const r of rows ?? []) if (r.item_id && !sales.has(r.item_id)) sales.set(r.item_id, { cents: r.price_cents, orderId: r.order_id });
  return sales;
}

export async function fetchItem(itemId: string): Promise<DeclutterItem | null> {
  const row = await readItems((cols) => supabase.from("declutter_items").select(cols).eq("id", itemId).maybeSingle());
  return (row ?? null) as DeclutterItem | null;
}

/**
 * The columns the price-drop rule reads (src/lib/declutter/priceDrop.ts), read
 * apart from ITEM_COLUMNS so Browse's reads are untouched. RLS decides; null
 * when the member can't read the item.
 */
export async function fetchItemDropState(itemId: string): Promise<DropStateRow | null> {
  const row = await readDropColumns((cols) => supabase.from("declutter_items").select(cols).eq("id", itemId).maybeSingle());
  return (row ?? null) as DropStateRow | null;
}

/** The price-drop columns a buyer may read; drop_pct is the seller's step (20261028160637). */
export type DropStateRow = { sale_mode: string | null; last_price_drop_on: string | null; drop_pct?: number | null; drops_stopped?: boolean | null };
const DROP_COLUMNS = "sale_mode, last_price_drop_on, drop_pct, drops_stopped";
const DROP_COLUMNS_BEFORE_STOPPED = "sale_mode, last_price_drop_on, drop_pct";
const DROP_COLUMNS_BEFORE_PCT = "sale_mode, last_price_drop_on";

/**
 * The drop columns, with drop_pct. Before 20261028160637 reaches prod the read
 * is refused with 42703 naming drop_pct: read again without it (every listing
 * then had the 5% step, which priceDrop.ts reads for an absent column). Every
 * other refusal is thrown. Remove once the migration is live on prod. The same for
 * drops_stopped before 20261031020705: read without it, and a stopped listing shows
 * its line until the next sweep, as it did before that column.
 */
async function readDropColumns(run: (columns: string) => PromiseLike<ItemRead>, extra = ""): Promise<unknown> {
  const first = await run(extra + DROP_COLUMNS);
  if (first.error?.code === "42703" && first.error.message.includes("drops_stopped")) return readDropColumnsBeforeStopped(run, extra);
  if (first.error?.code === "42703" && first.error.message.includes("drop_pct")) return unwrap(await run(extra + DROP_COLUMNS_BEFORE_PCT));
  return unwrap(first);
}

async function readDropColumnsBeforeStopped(run: (columns: string) => PromiseLike<ItemRead>, extra: string): Promise<unknown> {
  const second = await run(extra + DROP_COLUMNS_BEFORE_STOPPED);
  if (second.error?.code === "42703" && second.error.message.includes("drop_pct")) return unwrap(await run(extra + DROP_COLUMNS_BEFORE_PCT));
  return unwrap(second);
}

/** Owner 2026-10-28: the seller's nightly drop, 0 (off), 5, 10, 15 or 20 percent (declutter_set_drop_pct). */
export async function setDropPct(itemId: string, pct: number): Promise<number> {
  const res = await supabase.rpc("declutter_set_drop_pct", { p_item_id: itemId, p_pct: pct });
  // Before 20261028160637 reaches prod (PGRST202) every listing drops 5%: a 5% choice is already true, and
  // "off" is kept by the lowest price being the price; any other step cannot be honoured yet, so say so.
  if (res.error && isMissingRpcNamed(res.error, "declutter_set_drop_pct")) {
    if (pct === 0 || pct === 5) return pct;
    throw new Error("drop_pct_unavailable");
  }
  return rpcData(res, (e) => rpcErrorMessage("declutter_set_drop_pct", e)) as number;
}

/**
 * Browse's batch of the same two columns (board 25's "May drop tonight" tag and
 * the "Price drops" filter), one read for every card; RLS decides as above.
 */
export async function fetchDropStates(itemIds: string[]): Promise<Map<string, DropStateRow>> {
  const out = new Map<string, DropStateRow>();
  if (itemIds.length === 0) return out;
  const prefetched = await takeFirstScreenDropStates(itemIds);
  const rows = prefetched ?? (await readDropColumns((cols) => supabase.from("declutter_items").select(cols).in("id", itemIds), "id, ")) as
    (DropStateRow & { id: string })[] | null;
  for (const r of rows ?? []) out.set(r.id, { sale_mode: r.sale_mode, last_price_drop_on: r.last_price_drop_on, drop_pct: r.drop_pct, drops_stopped: r.drops_stopped });
  return out;
}

/**
 * BUY-52: the live listings whose price dropped from over `maxDollars` since `since` (a saved search's "N new" counts
 * them; saved_search_new_counts and this read share declutter_dropped_into_budget). Before that function is on the
 * server (PGRST202 / 42883) the answer is none, so Browse marks by live_at alone, as it did.
 */
export async function fetchDroppedIntoBudget(since: string, maxDollars: number): Promise<Set<string>> {
  const res = await supabase.rpc("declutter_dropped_into_budget", { p_since: since, p_max_budget: maxDollars });
  if (res.error && (isMissingRpcNamed(res.error, "declutter_dropped_into_budget") || res.error.code === "42883")) return new Set();
  return new Set((unwrap(res) ?? []) as string[]);
}

export async function fetchPhotos(itemIds: string[]): Promise<DeclutterPhoto[]> {
  if (itemIds.length === 0) return [];
  const prefetched = await takeFirstScreenPhotos(itemIds);
  if (prefetched) return prefetched as DeclutterPhoto[];
  const rows = unwrap(
    await supabase
      .from("declutter_item_photos")
      .select("id, item_id, storage_path, position")
      .in("item_id", itemIds)
      .order("position", { ascending: true }),
  );
  return (rows ?? []) as DeclutterPhoto[];
}

/**
 * Q2278: an item's questions, never who asked them (the page says "Asked by a neighbor"). Read through
 * declutter_item_questions (20261021122157, SECURITY INVOKER: the table's row policy decides, as before). Until that
 * migration is on prod (PGRST202 naming it), the same rows come from the table read, still without asker_id: members
 * keep a grant on every other column once the asker column is withheld (ready/declutter-narrow-floor2).
 */
export async function fetchQuestions(itemId: string): Promise<DeclutterQuestion[]> {
  const res = await supabase.rpc("declutter_item_questions", { p_item_id: itemId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_item_questions")) {
    console.warn("[declutter] declutter_item_questions not deployed yet; reading the questions table");
    const rows = unwrap(
      await supabase
        .from("declutter_questions")
        .select("id, item_id, question, answer, answered_at, created_at")
        .eq("item_id", itemId)
        .order("created_at", { ascending: true }),
    );
    return (rows ?? []) as DeclutterQuestion[];
  }
  return (rpcData(res, (e) => rpcErrorMessage("declutter_item_questions", e)) ?? []) as DeclutterQuestion[];
}

/**
 * AUD31-15: which of this item's questions the caller asked, so the page can say "Your question" on them. Read through
 * declutter_my_question_ids (20261031183631, SECURITY DEFINER): it answers only the caller's own question ids, so who
 * asked any other question stays hidden (Q2278). Until that migration is on prod (PGRST202 naming it), none are marked.
 */
export async function fetchMyQuestionIds(itemId: string): Promise<Set<string>> {
  const res = await supabase.rpc("declutter_my_question_ids", { p_item_id: itemId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_my_question_ids")) {
    console.warn("[declutter] declutter_my_question_ids not deployed yet; no question is marked as yours");
    return new Set();
  }
  return new Set((rpcData(res, (e) => rpcErrorMessage("declutter_my_question_ids", e)) ?? []) as string[]);
}

/**
 * Audit DC-9: the questions still waiting for the seller's answer on these listings (the seller's own, from
 * myItemsQuery), oldest first, for Selling's "To answer". The table read keeps asker_id out (members have no grant
 * on it); its row policy hides removed questions.
 */
export async function fetchUnansweredQuestions(itemIds: string[]): Promise<Pick<DeclutterQuestion, "id" | "item_id" | "question" | "created_at">[]> {
  if (!itemIds.length) return [];
  const rows = unwrap(
    await supabase
      .from("declutter_questions")
      .select("id, item_id, question, created_at")
      .in("item_id", itemIds)
      .is("answer", null)
      .is("removed_at", null)
      .order("created_at", { ascending: true }),
  );
  return (rows ?? []) as Pick<DeclutterQuestion, "id" | "item_id" | "question" | "created_at">[];
}

export async function fetchWatching(userId: string): Promise<Set<string>> {
  const prefetched = await takeFirstScreenWatching(userId);
  if (prefetched) return new Set(prefetched);
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

/**
 * A Browse card's photo is shown at most ~250 CSS px wide (162 at 375); 480 px covers it at 2x-3x (owner 10-31:
 * "When you're scrolling on declutter it takes the pictures awhile to load").
 */
export const CARD_PHOTO_PX = 480;

/**
 * THE CARD-SIZED PHOTO (owner 10-31, via the lead): a small square thumbnail from Supabase's image transform
 * (storage/v1/render/image/public, WebP when the browser accepts it), never the full-size original. Measured
 * 2026-10-31 on 12 live listing photos (GET only): originals 356-560 KB each, these 16-54 KB. The transform answered
 * 200 that day (it 403'd on 2026-08-31, src/lib/imageUrl.ts), so a card falls back to photoPublicUrl when it fails.
 * The item page shows its own resized photo (src/lib/declutter/pagePhoto.ts), its viewer the original. Guard:
 * src/test/declutterCardsLoadThumbnails.test.tsx.
 */
export function photoCardUrl(path: string): string {
  return supabase.storage
    .from(DECLUTTER_PHOTO_BUCKET)
    .getPublicUrl(path, { transform: { width: CARD_PHOTO_PX, height: CARD_PHOTO_PX, resize: "cover", quality: 70 } }).data.publicUrl;
}

/** The seller's shared star rating (the jobs' public aggregate, row 45). */
export async function fetchSellerRating(sellerId: string): Promise<{ avg: number; count: number } | null> {
  const rows = unwrap(await supabase.rpc("get_public_profile_stats", { p_user_ids: [sellerId] })) ?? [];
  const row = (rows as { user_id: string; avg_rating: number | null; review_count: number | null }[]).find((r) => r.user_id === sellerId);
  return row ? { avg: Number(row.avg_rating ?? 0), count: row.review_count ?? 0 } : null;
}

/**
 * Q2265: the quick tags buyers gave this seller, from their VISIBLE reviews only (declutter_visible_reviews: the
 * blind rule and the seed switch apply server-side; blocks do not filter reviews). Before migration 20261021023530 the rows carry no
 * tags, so nothing shows.
 */
export async function fetchSellerReviewTags(sellerId: string): Promise<string[][]> {
  const rows = (unwrap(await supabase.rpc("declutter_visible_reviews", { p_user_id: sellerId })) ?? []) as { reviewer_side: string; tags?: string[] | null }[];
  return rows.filter((r) => r.reviewer_side === "buyer").map((r) => r.tags ?? []);
}

/** What the item page's seller card shows: public fields only (get_safe_profiles, granted to every member). */
export interface SellerCard {
  name: string | null;
  avatarUrl: string | null;
  joinedAt: string | null;
}

/**
 * The seller card's name, photo and join date. Re-matched by user_id
 * (pickRequestedProfile): get_safe_profiles also answers profile ids, so a
 * row for a different person is never shown as this seller.
 */
export async function fetchSellerCard(sellerId: string): Promise<SellerCard | null> {
  const rows = (unwrap(await supabase.rpc("get_safe_profiles", { user_ids: [sellerId] })) ?? []) as SafeProfileIdRow[];
  const row = pickRequestedProfile(rows, sellerId) as (SafeProfileIdRow & { full_name?: string | null; avatar_url?: string | null; created_at?: string | null }) | null;
  return row ? { name: row.full_name ?? null, avatarUrl: row.avatar_url ?? null, joinedAt: row.created_at ?? null } : null;
}

/**
 * BUY-16: a guest's seller line, the seller's FIRST name only (owner 10-30: "no seller full name"), from
 * declutter_guest_seller_first_name (20261031062900). Null when the server gives none (not a guest-readable listing, no
 * name on the profile) or before it is deployed (the page then shows no seller line, as before).
 */
export async function fetchGuestSellerFirstName(itemId: string): Promise<string | null> {
  const res = await supabase.rpc("declutter_guest_seller_first_name", { p_item_id: itemId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_guest_seller_first_name")) return null;
  // The function raises nothing of its own (it answers NULL instead), so a failure is the transport's: thrown as is.
  const name = unwrap(res);
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

/**
 * SS-5 (Watching under Buying): the hearted items the member can still read. An item RLS no longer shows (sold to
 * someone else, taken down) is left out; the caller counts those from fetchWatching's ids.
 */
export async function fetchWatchedItems(ids: readonly string[]): Promise<DeclutterItem[]> {
  if (ids.length === 0) return [];
  const rows = await readItems((cols) => supabase.from("declutter_items").select(cols).in("id", [...ids]));
  return (rows ?? []) as DeclutterItem[];
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

/**
 * A new draft. `withId` is the id the app picked when the first photo was added, so those photos were already uploaded
 * into its folder (LEAD-POST-SLOW (a), migration 20261031160546). Before that migration reaches prod (PGRST202) the
 * draft gets a fresh id instead; the caller compares and uploads the photos again into the right folder.
 */
export async function createDraft(f: DraftFields, withId?: string): Promise<string> {
  if (withId) {
    const res = await supabase.rpc("declutter_create_item_with_id", { p_item_id: withId, ...draftArgs(f) });
    // The id already made: a first Post whose answer was lost made this seller's draft with it. Review of 62f90f3368
    // (4): that draft is reused (its fields saved again), never a second draft with the photos uploaded twice. A
    // draft row reads back only for its own seller (the declutter_items read policy), so a row that reads back as a
    // draft is the caller's own; anything else gets a fresh id below.
    const taken = !!res.error && /item_id_taken/.test(res.error.message ?? "");
    const mine = taken ? await readMyItem(withId) : null;
    if (mine === "draft") {
      await updateDraft(withId, f);
      return withId;
    }
    // LEAD-RESUME-REPOSTS (owner 2026-10-31, prod duplicates of c87b7de4 / 019dd0b3): the id is the caller's own item and
    // it is already past draft (posted). A fresh id here made a second copy of it; it is never made again.
    if (mine) throw new AlreadyPosted(withId);
    // Before 20261031160546 (PGRST202), or an id taken by a row that is not the caller's: a fresh id.
    const retry = res.error && (isMissingRpcNamed(res.error, "declutter_create_item_with_id") || /item_id_taken/.test(res.error.message ?? ""));
    if (!retry) {
      return rpcData(res, (e) => rpcErrorMessage("declutter_create_item_with_id", e)) as string;
    }
  }
  return rpcData(await supabase.rpc("declutter_create_item", draftArgs(f)), (e) => rpcErrorMessage("declutter_create_item", e)) as string;
}

/**
 * LEAD-RESUME-REPOSTS: Post with an id that is already the seller's posted item. Never a second copy: the screen says
 * "Already posted" and opens it (itemId).
 */
export class AlreadyPosted extends Error {
  readonly userMessage = "Already posted. It's under Selling.";
  constructor(readonly itemId: string) {
    super("already_posted");
  }
}

/**
 * The caller's own item with this id: its status, or null when it is really not the caller's (no row, or another
 * seller's). A draft reads back only for its own seller (the declutter_items read policy); a posted item reads for
 * everyone, so the seller is compared too.
 * A failed read THROWS (lead review, 10-31): null there meant a fresh id, and when the run's status read had failed too
 * nothing else knew the id was already posted, so the item was posted twice. Not knowing stops this item; Try again asks
 * again with the same id.
 */
const CANT_CHECK = "We couldn't check whether this item is already posted. Try again.";
async function readMyItem(itemId: string): Promise<string | null> {
  const r = await supabase.from("declutter_items").select("id, status, seller_id").eq("id", itemId).maybeSingle();
  if (r.error) throw Object.assign(new Error(`item_read_failed: ${r.error.message}`), { userMessage: CANT_CHECK });
  const row = r.data as { status?: string; seller_id?: string } | null;
  if (!row?.status) return null;
  if (row.status === "draft") return "draft";
  const me = (await supabase.auth.getSession()).data.session?.user.id;
  // Who is signed in can't be read: whether a posted row is theirs is unknown, so the same as a failed read.
  if (!me) throw Object.assign(new Error("item_read_failed: no session"), { userMessage: CANT_CHECK });
  return row.seller_id === me ? row.status : null;
}

export async function updateDraft(itemId: string, f: DraftFields): Promise<string> {
  return rpcData(await supabase.rpc("declutter_update_draft", { p_item_id: itemId, ...draftArgs(f) }), (e) => rpcErrorMessage("declutter_update_draft", e)) as string;
}

/** The ways a seller can tick on step 4 (owner 2026-10-28; pickup at the door is no longer one of them). */

export type SellerHandover = "porch" | "seller_delivery" | "meetup" | "delivery";

/**
 * Owner 2026-10-28: the ways buyers can get this draft (declutter_set_handovers; also sets porch_ok). Before
 * migration 20261028235247 reaches prod (PGRST202) only porch can be recorded, so it falls back to setPorchOk.
 */
export async function setHandovers(itemId: string, ways: SellerHandover[]): Promise<SellerHandover[]> {
  const res = await supabase.rpc("declutter_set_handovers", { p_item_id: itemId, p_handovers: ways });
  if (res.error && isMissingRpcNamed(res.error, "declutter_set_handovers")) {
    await setPorchOk(itemId, ways.includes("porch"));
    return ways;
  }
  return rpcData(res, (e) => rpcErrorMessage("declutter_set_handovers", e)) as SellerHandover[];
}

/** A draft's saved ways (null = none recorded, an older item). Before 20261028235247 (42703): null. */
export async function fetchItemHandovers(itemId: string): Promise<SellerHandover[] | null> {
  const r = await supabase.from("declutter_items").select("handovers").eq("id", itemId).maybeSingle();
  if (r.error?.code === "42703") return null;
  const row = unwrap(r) as { handovers: SellerHandover[] | null } | null;
  return row?.handovers ?? null;
}

/** Row 101: may buyers pick this draft up from the porch? On by default; the server refuses porch checkout when off. */
async function setPorchOk(itemId: string, porchOk: boolean): Promise<boolean> {
  return rpcData(
    await supabase.rpc("declutter_set_porch_ok", { p_item_id: itemId, p_porch_ok: porchOk }),
    (e) => rpcErrorMessage("declutter_set_porch_ok", e),
  ) as boolean;
}

/**
 * Clean, upload and attach one photo. The object is uploaded first (the
 * server only attaches an object that exists and is the seller's); when the
 * attach is refused the object is deleted again, best effort, and the
 * refusal is thrown.
 */
/**
 * What Sell a bunch lists with: the listing's copy, a little smaller than the single form's, because many go up one
 * after another on whatever signal the seller has.
 */
const BUNCH_UPLOAD_SIZE = 1600;
const BUNCH_UPLOAD_QUALITY = 0.78;

/**
 * Every listing photo goes up here, on any connection: the photo is made ready once, then each step is tried again by
 * itself with backoff, and never stores or attaches it twice (lib/declutter/steadyUpload.ts). Throws once it is out of
 * tries. The copy is Sell a bunch's unless the caller asks for the one-item form's (FULL_LISTING_COPY).
 */
export async function addPhotoSteadily(
  sellerId: string,
  itemId: string,
  file: File,
  options: UploadHooks & { size?: number; quality?: number; uploadedPath?: string } = {},
): Promise<string> {
  const { size = BUNCH_UPLOAD_SIZE, quality = BUNCH_UPLOAD_QUALITY, uploadedPath, ...hooks } = options;
  // Already in this item's folder (stageListingPhoto, when it was added): only the attach is left.
  const cleaned = uploadedPath ? null : await cleanListingPhoto(file, size, quality);
  if (cleaned && !LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const path = uploadedPath ?? listingPhotoPath(sellerId, itemId, photoNonce());
  const bucket = supabase.storage.from(DECLUTTER_PHOTO_BUCKET);
  return uploadSteadily({
    store: async (again) => {
      if (!cleaned) return;
      const { error } = await bucket.upload(path, cleaned, { contentType: "image/jpeg", upsert: false, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
      if (!error) return;
      // The first try landed and only its answer was lost.
      if (again && /already exists|duplicate/i.test(error.message)) return;
      const status = (error as { status?: unknown }).status;
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429) throw new PhotoUploadRefused("photo_not_uploaded");
      throw new Error("photo_not_uploaded");
    },
    attach: async () => {
      const { data, error } = await supabase.rpc("declutter_add_item_photo", { p_item_id: itemId, p_storage_path: path });
      if (!error) return data as string;
      // Dropped on the wire: we don't know yet, so the file stays and the next try asks first.
      if (isNetworkFailure(error)) throw new Error(error.message);
      const { error: rmErr } = await bucket.remove([path]);
      if (rmErr) console.warn("[declutter] could not remove a refused photo upload", rmErr.message);
      const words = rpcErrorMessage("declutter_add_item_photo", error);
      throw Object.assign(new PhotoUploadRefused(error.message), error, words ? { userMessage: words } : {});
    },
    findAttached: async () => {
      const { data, error } = await supabase.from("declutter_item_photos").select("id").eq("item_id", itemId).eq("storage_path", path).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.id ?? null;
    },
  }, hooks);
}

const photoNonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

/**
 * LEAD-POST-SLOW (a): a NEW listing's photo goes up the moment it is added, into the folder of the id the app picked
 * for it (createDraft(fields, withId)). Only the object is stored; Post attaches it (addPhotoSteadily with
 * `uploadedPath`). `cleaned` is cleanListingPhoto's copy at the one-item form's size. null when it could not go up now: Post then uploads it the usual way, with its retries.
 */
export async function stageListingPhoto(sellerId: string, itemId: string, cleaned: File): Promise<string | null> {
  try {
    if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) return null;
    const path = listingPhotoPath(sellerId, itemId, photoNonce());
    const { error } = await supabase.storage
      .from(DECLUTTER_PHOTO_BUCKET)
      .upload(path, cleaned, { contentType: "image/jpeg", upsert: false, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
    if (error) {
      console.warn("[declutter] early photo upload failed; it goes up at Post", error.message);
      return null;
    }
    return path;
  } catch (err) {
    // Not silent: the photo stays held and Post uploads it (or says why it can't).
    console.warn("[declutter] early photo upload failed; it goes up at Post", err);
    return null;
  }
}

/**
 * LEAD-BUNCH-34-SLOW: Sell a bunch's early upload of one sorted item's photo, at the copy Sell a bunch lists with, into
 * the folder of the id that item will be created with (declutter_create_item_with_id), so List only attaches it. Null
 * when it can't go now: listing then cleans and uploads it as before.
 */
export async function stageBunchPhoto(sellerId: string, itemId: string, file: File): Promise<string | null> {
  try {
    return await stageListingPhoto(sellerId, itemId, await cleanListingPhoto(file, BUNCH_UPLOAD_SIZE, BUNCH_UPLOAD_QUALITY));
  } catch (err) {
    // Not silent: the photo goes up at listing instead (addPhotoSteadily), and says why if it can't.
    console.warn("[declutter] early bunch photo upload failed; it goes up at listing", err);
    return null;
  }
}

/** Early uploads Post did not use (the photo was removed first): best effort, as removeObjects. */
export async function dropStagedPhotos(paths: string[]): Promise<void> {
  await removeObjects(paths);
}

/** Remove storage objects the server detached (photo removed, listing withdrawn). */
async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(DECLUTTER_PHOTO_BUCKET).remove(paths);
  // The rows are already gone; a failed object delete leaves an unattached
  // object the seller's account deletion (or a retry) still removes (B4/B5).
  if (error) console.warn("[declutter] photo objects not removed", error.message);
  await purgeQueuedPhotos();
}

/**
 * B63: a photo a Helpr uploaded for the seller sits in the HELPR's folder, so the remove above is refused there (and
 * Storage reports that refusal as success). The server queued every detached photo's object; this asks it to remove
 * the caller's own queued ones now (the 15-minute cron is the backstop). Best effort: the change already happened.
 */
export async function purgeQueuedPhotos(): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("declutter-photo-purge", { body: {} });
    if (error) console.warn("[declutter] queued photo objects not removed yet", await functionErrorMessage(error, "no reason given"));
  } catch (e) {
    // Logged, never thrown: the seller's change went through and the cron removes the objects within 15 minutes.
    console.warn("[declutter] queued photo objects not removed yet", e instanceof Error ? e.message : String(e));
  }
}

export async function removePhoto(photoId: string): Promise<void> {
  const path = rpcData(await supabase.rpc("declutter_remove_item_photo", { p_photo_id: photoId }), (e) => rpcErrorMessage("declutter_remove_item_photo", e));
  await removeObjects(path ? [path as string] : []);
}

/** A2-8: take a line out of the cart (the buyer's own, still in the cart). The item goes back on sale; no strike. */
export async function removeCartItem(lineId: string): Promise<"removed" | "already"> {
  return rpcData(await supabase.rpc("declutter_remove_cart_item", { p_line_id: lineId }),
    (e) => rpcErrorMessage("declutter_remove_cart_item", e)) as "removed" | "already";
}

export async function withdrawItem(itemId: string): Promise<void> {
  const paths = rpcData(await supabase.rpc("declutter_withdraw_item", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_withdraw_item", e));
  await removeObjects((paths ?? []) as string[]);
}

/** The seller says their free listing is still there; the next ask is 14 days away (20261030232231). */
export async function markStillAvailable(itemId: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_free_still_available", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_free_still_available", e)) as string;
}

/** "Mark sold elsewhere" (A2-5): off sale like a withdraw, but the listing is kept as 'sold_elsewhere'. Its photos go the same way. */
export async function markSoldElsewhere(itemId: string): Promise<void> {
  const paths = rpcData(await supabase.rpc("declutter_mark_sold_elsewhere", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_mark_sold_elsewhere", e));
  await removeObjects((paths ?? []) as string[]);
}

/**
 * Board 158: what the Manage sheet shows (the seller's floor; whether THEY
 * stopped the drops). "not_deployed" while migration 20261020064354 has not
 * reached prod: the sheet then offers only what already works (take it down).
 */
export async function fetchManageState(
  itemId: string,
): Promise<{ floor_price_cents: number; drops_stopped: boolean } | null | "not_deployed"> {
  const res = await supabase.rpc("declutter_listing_manage_state", { p_item_id: itemId });
  if (res.error && isMissingRpcNamed(res.error, "declutter_listing_manage_state")) return "not_deployed";
  const rows = rpcData(res, (e) => rpcErrorMessage("declutter_listing_manage_state", e));
  return (rows ?? [])[0] ?? null;
}

/** Board 158: a live or paused listing's price and lowest price. Returns the new price. */
export async function setListingPrice(itemId: string, priceCents: number, floorCents: number): Promise<number> {
  return rpcData(
    await supabase.rpc("declutter_set_listing_price", { p_item_id: itemId, p_price_cents: priceCents, p_floor_price_cents: floorCents }),
    (e) => rpcErrorMessage("declutter_set_listing_price", e),
  ) as number;
}

/** Board 158: stop (false) or restart (true) the nightly price drops. */
export async function setListingDrops(itemId: string, on: boolean): Promise<boolean> {
  return rpcData(await supabase.rpc("declutter_set_listing_drops", { p_item_id: itemId, p_on: on }), (e) => rpcErrorMessage("declutter_set_listing_drops", e)) as boolean;
}

/**
 * "If it doesn't sell, make it free after __ days" (Q2430, made a day count by OWN-FREE): the seller's own
 * listing; null = Never (the default). The evening sweep does it; these read and set the choice
 * (migration 20261030030408). "not_deployed" before that migration reaches prod (PGRST202).
 */
export async function fetchAutoFreeDays(itemId: string): Promise<number | null | "not_deployed"> {
  const r = await supabase.rpc("declutter_auto_free_days_state", { p_item_id: itemId });
  if (isMissingRpcNamed(r.error, "declutter_auto_free_days_state")) return "not_deployed";
  return rpcData(r, (e) => rpcErrorMessage("declutter_auto_free_days_state", e)) as number | null;
}

export async function setAutoFreeDays(itemId: string, days: number | null): Promise<number | null> {
  // The generated Args type has no null (Postgres arguments are all nullable); null is Never.
  const r = await supabase.rpc("declutter_set_auto_free_days", { p_item_id: itemId, p_days: days as number });
  return rpcData(r, (e) => rpcErrorMessage("declutter_set_auto_free_days", e)) as number | null;
}

/**
 * "Keep it up until it sells" (owner 2026-10-29): the seller's own listing renews every 30 days with no cap and no
 * notices (migration 20261029154323). "not_deployed" before that migration reaches prod (PGRST202).
 */
export async function fetchKeepUp(itemId: string): Promise<boolean | "not_deployed"> {
  const r = await supabase.rpc("declutter_keep_up_state", { p_item_id: itemId });
  if (isMissingRpcNamed(r.error, "declutter_keep_up_state")) return "not_deployed";
  return rpcData(r, (e) => rpcErrorMessage("declutter_keep_up_state", e)) as boolean;
}

export async function setKeepUp(itemId: string, on: boolean): Promise<boolean> {
  return rpcData(await supabase.rpc("declutter_set_keep_up", { p_item_id: itemId, p_on: on }), (e) => rpcErrorMessage("declutter_set_keep_up", e)) as boolean;
}

/** Board 158: hide a live listing from buyers (photos and saves kept; open offers close). */
export async function pauseListing(itemId: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_pause_listing", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_pause_listing", e)) as string;
}

/** Board 158: put a paused listing back on sale. */
export async function relistListing(itemId: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_relist_listing", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_relist_listing", e)) as string;
}

export interface ListingEdit {
  title: string;
  description: string;
  category: string;
  conditionStars: number;
  deliverySize: DeliverySize;
  handovers: SellerHandover[];
}

/**
 * Audit 1028 D1-1: edit a live listing (20261029205908). The server decides from what changed: a new title,
 * description or category returns "pending_review" (hidden until approved, open offers closed); anything else
 * "live". The four tax confirmations go with every edit (the one checkbox the screen asks for).
 */
export async function editListing(itemId: string, f: ListingEdit): Promise<"live" | "pending_review"> {
  return rpcData(
    await supabase.rpc("declutter_edit_listing", {
      p_item_id: itemId,
      p_title: f.title,
      p_description: f.description,
      p_category: f.category,
      p_condition_stars: f.conditionStars,
      p_delivery_size: f.deliverySize,
      p_handovers: f.handovers,
      p_bought_for_personal_use: true,
      p_not_in_the_business: true,
      p_not_a_frequent_seller: true,
      p_keeps_item_until_handover: true,
    }), (e) => rpcErrorMessage("declutter_edit_listing", e)) as "live" | "pending_review";
}

/** A taken-down listing back to a draft (20261028180400): its words and price are kept, its photos were deleted at take-down. */
export async function reopenListing(itemId: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_reopen_listing", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_reopen_listing", e)) as string;
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
  const status = rpcData(await supabase.rpc("declutter_publish_item", { p_item_id: itemId }), (e) => rpcErrorMessage("declutter_publish_item", e)) as "pending_review" | "live";
  // PUSH-REACH: a listing that went up is when a seller wants to hear from buyers; the website's push ask.
  offerPushAfterAction();
  return status;
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
  /**
   * Owner 2026-10-29: Claude's suggested starting price in whole dollars, clamped to our own sold
   * prices when the fair-price hint has a range; null (or absent, from an older function) = none.
   */
  priceDollars?: number | null;
  /** One plain line on why that price (never a retail claim: the server drops one). */
  priceReason?: string | null;
  /** Photo coach (owner 2026-10-29): which photo sent (0-based) makes the best cover, or null. */
  coverPhoto?: number | null;
  /** At most one "one more photo would help" tip, or null. */
  photoTip?: string | null;
}

/** Where the fair-price hint looks, sent so the server can ground Claude's price in our sold prices. */
export type AiHintPoint = { lat: number; lng: number } | null;

/**
 * How long the app waits for the photo tool (draft or banned-item check)
 * before it gives up and says so. The edge function's model calls alone can
 * take ~51.5 s (a 25 s call, a short pause, one 25 s retry on a busy answer),
 * plus its reads, photo downloads and a cold start, so this is a minute: a
 * bound on a hung connection, not a race with a slow answer. A check that
 * times out is handled like any failed check (the listing goes to review).
 */
export const AI_TIMEOUT_MS = 60_000;

async function invokeAi(itemId: string, mode: "draft" | "check", at: AiHintPoint = null): Promise<unknown> {
  return invokeAiBody(at ? { itemId, mode, at } : { itemId, mode });
}

/** One call to the photo tool; `timeoutMs` is longer for Sell a bunch's grouping (lib/declutter/bunch.ts). */
export async function invokeAiBody(body: Record<string, unknown>, timeoutMs = AI_TIMEOUT_MS): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("declutter-ai-draft", { body, timeout: timeoutMs });
  if (error) {
    // The client timeout aborted the request: before the answer's headers
    // (FunctionsFetchError around an AbortError) or while its body was read
    // (the AbortError itself).
    const aborted = (error as { name?: unknown }).name === "AbortError" || (error as { context?: { name?: unknown } }).context?.name === "AbortError";
    if (aborted) throw new Error("ai_timed_out");
    // FunctionsHttpError keeps the JSON body on its context.
    const ctx = (error as { context?: Response }).context;
    // Our limit answers 429 in words and the model's limit as ai_unavailable: either way, say to wait.
    if (ctx?.status === 429) throw new Error("ai_rate_limited");
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
export async function requestAiDraft(itemId: string, at: AiHintPoint = null): Promise<AiDraft> {
  return (await invokeAi(itemId, "draft", at)) as AiDraft;
}

/** How many of a new listing's photos Claude looks at (the edge function's draft mode reads 4 too). */
export { AI_DRAFT_PHOTOS };

/**
 * Owner 2026-10-28: Claude writes a NEW listing from the photos still on the
 * device (no draft exists before step 4). Each photo is cleaned (no location
 * data) and sent once, smaller, in the request; it is never uploaded or kept.
 * Saves nothing.
 */
export async function requestAiDraftFromPhotos(files: File[], at: AiHintPoint = null): Promise<AiDraft> {
  const list = files.slice(0, AI_DRAFT_PHOTOS);
  if (list.length === 0) throw new Error("ai_photos_required");
  const photos: string[] = [];
  for (const f of list) photos.push(await blobToBase64(await cleanListingPhoto(f, 1280, 0.75)));
  return (await invokeAiBody(at ? { mode: "draft", photos, at } : { mode: "draft", photos })) as AiDraft;
}

/**
 * The banned-item check of the SAVED listing (row 34), recorded server-side.
 * Run right before publishing; if it fails the listing still publishes, to
 * an admin's review (the server's fail-safe), so the caller may ignore it.
 */
export async function requestAiCheck(itemId: string): Promise<{ checked: boolean; flagged: boolean }> {
  return (await invokeAi(itemId, "check")) as { checked: boolean; flagged: boolean };
}

/**
 * How a posted listing's check is retried (owner 10-31, 9:15 PM: 27 of a Sell a bunch post were held by the 15-minute
 * fail-safe with no check recorded). The edge logs showed the checks answered 429 (busy) and the old helper asked again
 * AT ONCE, twice, so every try landed in the same full minute. Now: up to 4 tries, waiting 5 s, 20 s, then 60 s
 * between them, so a busy minute has passed before the next try. The edge function also gives checks their own limit
 * (supabase/functions/declutter-ai-draft/checkLimits.ts). Guard: src/test/declutterCheckHasItsOwnLimit.test.ts.
 */
export const CHECK_RETRY_WAITS_MS: readonly number[] = [5_000, 20_000, 60_000];

/**
 * The check, retried before giving up (lead 2026-10-30, item B): a listing whose check never comes back is held for an
 * admin (the server's fail-safe), so retries keep a passing blip or a busy minute from holding it. Resolves null when
 * every try failed; the caller then publishes or saves as usual and the server holds it. `tries` lets a screen the
 * seller is waiting on (Edit) ask twice only.
 */
export async function requestAiCheckWithRetry(
  itemId: string,
  { tries = CHECK_RETRY_WAITS_MS.length + 1, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }: { tries?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<{ checked: boolean; flagged: boolean } | null> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await requestAiCheck(itemId);
    } catch (err) {
      // Not silent: said in the console, and the server holds the listing for an admin (the screen says so).
      console.warn(`[declutter] photo check try ${attempt} of ${tries} failed`, err);
      if (attempt < tries) await wait(CHECK_RETRY_WAITS_MS[Math.min(attempt - 1, CHECK_RETRY_WAITS_MS.length - 1)]);
    }
  }
  return null;
}

/**
 * Admin queue (row 33, B8). Test accounts' listings are left out (20261028022715)
 * unless `includeTest`: the card's "Show test listings" switch, so an admin can
 * approve a test listing in the UI. `p_include_test` is the server half
 * (builder 1, 20261028 admin pending test); the switch is off by default, and
 * off (false) is the server's default.
 */
// Admin-only copy is fetched only on a refusal (lifecycleErrors.ts, loadAdminRpcErrorCopy).
export async function fetchPendingForAdmin(includeTest = false) {
  const res = await supabase.rpc("declutter_admin_pending_items", { p_include_test: includeTest });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_pending_items", e) ?? null) ?? [];
}

export async function reviewListing(itemId: string, approve: boolean, note: string | null): Promise<string> {
  const res = await supabase.rpc("declutter_admin_review_item", { p_item_id: itemId, p_approve: approve, p_note: note ?? "" });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_review_item", e) ?? null) as string;
}

/**
 * Item B (owner 2026-10-29, 20261030071816): an admin takes a reported listing down. The server closes its open
 * offers (buyers told), tells the seller the reason, resolves the report and logs the report id.
 */
export async function takeDownListing(itemId: string, note: string, reportId: string | null): Promise<string> {
  const res = await supabase.rpc("declutter_admin_take_down_item", { p_item_id: itemId, p_note: note, p_report_id: reportId ?? undefined });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_take_down_item", e) ?? null) as string;
}

/** Audit 10-30 #8: the same for a Wanted post (20261030225143). The poster reads the reason. */
export async function takeDownWanted(wantedId: string, note: string, reportId: string): Promise<string> {
  const res = await supabase.rpc("declutter_admin_take_down_wanted", { p_wanted_id: wantedId, p_note: note, p_report_id: reportId });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_take_down_wanted", e) ?? null) as string;
}

export type ReportedQuestion = {
  question_id: string; item_id: string; item_title: string; asker_id: string; seller_id: string;
  question: string; answer: string | null; removed: boolean; is_seed: boolean;
};

/** B48 (owner decision 10-31): the questions behind question and answer reports, read as admin. */
export async function fetchReportedQuestions(questionIds: string[]): Promise<ReportedQuestion[]> {
  if (!questionIds.length) return [];
  const res = await supabase.rpc("declutter_admin_reported_questions", { p_question_ids: questionIds });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return (rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_reported_questions", e) ?? null) ?? []) as ReportedQuestion[];
}

/** B48 (owner decision 10-31, App Store 1.2): an admin removes a reported question, or only its answer; the report resolves. */
export async function removeReportedQuestion(questionId: string, part: "question" | "answer", reportId: string): Promise<string> {
  const res = await supabase.rpc("declutter_admin_remove_question", { p_question_id: questionId, p_part: part, p_note: "", p_report_id: reportId });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_remove_question", e) ?? null) as string;
}

/** Audit 10-30 #8: a held Wanted photo an admin looked at and found fine: members see it now. */
export async function releaseWantedPhotos(wantedId: string, reportId: string): Promise<string> {
  const res = await supabase.rpc("declutter_admin_release_wanted_photos", { p_wanted_id: wantedId, p_report_id: reportId });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_release_wanted_photos", e) ?? null) as string;
}

export type ReportedWanted = { wanted_id: string; what: string; poster_id: string; status: string; removed: boolean; is_seed: boolean; photo_paths: string[]; photos_held: string[] };

/** The reports queue's read of reported Wanted posts, whatever their status (admin only, 20261030225143). */
export async function fetchReportedWanted(wantedIds: string[]): Promise<ReportedWanted[]> {
  if (!wantedIds.length) return [];
  const res = await supabase.rpc("declutter_admin_reported_wanted", { p_wanted_ids: wantedIds });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return (rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_reported_wanted", e) ?? null) ?? []) as ReportedWanted[];
}

export type ReportedListing = { item_id: string; title: string; seller_id: string; status: DeclutterStatus; is_seed: boolean };

/** The reports queue's names for reported listings, whatever their status (admin only, 20261030071816). */
export async function fetchReportedListings(itemIds: string[]): Promise<ReportedListing[]> {
  if (!itemIds.length) return [];
  const res = await supabase.rpc("declutter_admin_reported_items", { p_item_ids: itemIds });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return (rpcData(res, (e) => admin?.rpcErrorMessage("declutter_admin_reported_items", e) ?? null) ?? []) as ReportedListing[];
}

/* ------------------------------------------------------------------------ *
 * Slice 3: offers, Buy, cart, strikes (20261014210518; spec rows 13, 20-22,
 * 36, 38, 56-59, build decisions B25-B37). Nothing here charges a card.
 * ------------------------------------------------------------------------ */

type OfferAction = "accept" | "decline" | "counter" | "withdraw";

export interface MyOffer {
  offer_id: string;
  item_id: string;
  item_title: string;
  my_side: "buyer" | "seller";
  amount_cents: number;
  awaiting: "buyer" | "seller";
  status: "open" | "accepted" | "declined" | "expired" | "withdrawn" | "voided";
  respond_by: string;
  counter_count: number;
  current_price_cents: number;
  /** The seller's own hidden floor; always null on the buyer's rows (B26). */
  floor_price_cents: number | null;
  updated_at: string;
  /** Audit 1d D4-3 (20261030134231): a seller's answer to the buyer's Wanted post, not an offer the buyer made.
   *  Absent before that migration is on prod (read as false). */
  from_wanted?: boolean;
  /** BUY-29 (20261031095146): on the poster's own row only, the id of the still-open Wanted post this offer answers,
   *  so the card can ask to close it after an accept. Null otherwise; absent before that migration is on prod. */
  open_wanted_id?: string | null;
}

export interface CartLine {
  line_id: string;
  /** Null on a settled sale whose seller deleted their account (the listing went with them; Q2307). */
  item_id: string | null;
  item_title: string;
  my_side: "buyer" | "seller";
  /** Null on a settled sale whose seller deleted their account (read with the shared deleted-person label; Q2307). */
  seller_id: string | null;
  price_cents: number;
  status: "in_cart" | "paid" | "missed" | "cancelled_by_seller" | "removed"; // removed: A2-8, the buyer took it out (20261028221904)
  checkout_by: string;
  order_id: string | null;
  order_status: string | null;
  handover: string | null;
  premium_cents: number | null;
  total_cents: number | null;
  /** Row 101: the item allows porch pickup. */
  porch_ok: boolean;
  /** Owner 2026-10-28 (20261028235247): the ways the seller ticked; null = an older item (every way). Absent before deploy. */
  handovers?: Handover[] | null;
  /** Slice 5: the order's frozen Helpr delivery fee (0 for a pickup; kept after a no-Helpr fallback). */
  delivery_cents?: number | null;
  /** Slice 5: the order's Helpr task (read with helpr_task_view), null for a pickup. */
  delivery_task_id?: string | null;
  /**
   * DB-5 (20261030064929): how the line got here. "buy" = Buy now or a free claim (no strike when its 48 hours run
   * out), "offer" = an accepted offer (a strike). Absent before that deploy: read as "may carry a strike".
   */
  source?: "buy" | "offer" | null;
  /** DC-18 (20261030131715): when an ended line ended (null while in the cart). Absent before that deploy. */
  closed_at?: string | null;
}

export async function makeOffer(itemId: string, amountCents: number): Promise<string> {
  const offerId = rpcData(await supabase.rpc("declutter_make_offer", { p_item_id: itemId, p_amount_cents: amountCents }), (e) => rpcErrorMessage("declutter_make_offer", e)) as string;
  // PUSH-REACH: the seller's answer is what the buyer waits for; the website's push ask.
  offerPushAfterAction();
  return offerId;
}

/**
 * Smart offers (20261029162620, owner 2026-10-29): the seller's own live or paused item. Off = Buy only; auto
 * accepts offers at or above the item's lowest price (floor_price_cents, set with declutter_set_listing_price) and
 * counters lower ones at it. Auto is saved off whenever offers are off.
 */
export async function setOfferRules(itemId: string, acceptsOffers: boolean, autoOffers: boolean): Promise<void> {
  rpcData(
    await supabase.rpc("declutter_set_offer_rules", { p_item_id: itemId, p_accepts_offers: acceptsOffers, p_auto_offers: autoOffers }),
    (e) => rpcErrorMessage("declutter_set_offer_rules", e),
  );
}

export async function respondOffer(offerId: string, action: OfferAction, amountCents: number | null = null): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_respond_offer", { p_offer_id: offerId, p_action: action, p_amount_cents: amountCents }),
    (e) => rpcErrorMessage("declutter_respond_offer", e),
  ) as string;
}

/** Buy at the price the member SAW; the server refuses if it is higher now. */
/**
 * The Free change (Q2487, owner 2026-10-29): ASK for a free item. The item stays up; the giver picks who gets it,
 * and only that person then has 48 hours to choose a pickup. At most 3 at a time (asks + free items waiting).
 * Returns the ask's id. (declutter_claim_free, which installed app builds still call, now asks the same way.)
 */
export async function requestFree(itemId: string): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_request_free", { p_item_id: itemId }),
    // The pause refusal carries its end date in the hint ("You can ask for free items again on November 29.").
    (e) => {
      const r = e as { message?: unknown; hint?: unknown } | null;
      return r?.message === "free_paused" && typeof r.hint === "string" && r.hint ? r.hint : rpcErrorMessage("declutter_request_free", e);
    },
  ) as string;
}

/** Take back the member's own ask. */
export async function withdrawFreeRequest(requestId: string): Promise<void> {
  rpcData(
    await supabase.rpc("declutter_withdraw_free_request", { p_request_id: requestId }),
    (e) => rpcErrorMessage("declutter_withdraw_free_request", e),
  );
}

export type MyFreeRequest = { id: string; item_id: string; status: string; created_at: string; declutter_items?: { title: string } | null };

/** The member's own open asks, with each item's title (RLS: the asker or the giver reads a row). */
export async function fetchMyFreeRequests(userId: string): Promise<MyFreeRequest[]> {
  return (unwrap(
    await supabase.from("declutter_free_requests").select("id, item_id, status, created_at, declutter_items(title)")
      .eq("requester_id", userId).eq("status", "open").order("created_at", { ascending: true }),
  ) ?? []) as MyFreeRequest[];
}

/** The giver's open asks per free listing (RLS lets the giver read the rows), for the Selling list's "Requests (n)". */
export async function fetchOpenFreeRequestCounts(userId: string): Promise<Map<string, number>> {
  const rows = (unwrap(
    await supabase.from("declutter_free_requests").select("item_id").eq("seller_id", userId).eq("status", "open"),
  ) ?? []) as { item_id: string }[];
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.item_id, (out.get(r.item_id) ?? 0) + 1);
  return out;
}

export type FreeRequester = {
  request_id: string; requester_id: string; display_name: string; avg_rating: number | null; review_count: number | null; created_at: string;
};

/** The giver's list of who asked for one of their free items, oldest first. */
export async function fetchFreeRequestsForItem(itemId: string): Promise<FreeRequester[]> {
  return (rpcData(
    await supabase.rpc("declutter_free_requests_for_item", { p_item_id: itemId }),
    (e) => rpcErrorMessage("declutter_free_requests_for_item", e),
  ) ?? []) as FreeRequester[];
}

/** The giver picks one person; everyone else who asked is told. Returns the picked person's cart line id. */
export async function pickFreeRequest(requestId: string): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_pick_free_request", { p_request_id: requestId }),
    (e) => rpcErrorMessage("declutter_pick_free_request", e),
  ) as string;
}

/** The member's 30-day pause on free items after a missed free pickup: its end, or null. */
export async function fetchMyFreePause(): Promise<string | null> {
  return (rpcData(
    await supabase.rpc("declutter_my_free_pause"),
    // A plain SELECT of the member's own row: it raises nothing, so it has no RPC_ERROR_COPY entry (like declutter_has_agreed_sales).
    () => null,
  ) ?? null) as string | null;
}

/**
 * Finish a cart with one seller whose items are ALL free: no payment page, nothing charged; the order is
 * set at once and goes to the handover (pickup at the seller's home or from the porch). Returns the order id.
 */
export async function checkoutFree(sellerId: string, handover: "pickup_home" | "porch"): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_checkout_free", { p_seller_id: sellerId, p_handover: handover }),
    (e) => rpcErrorMessage("declutter_checkout_free", e),
  ) as string;
}

export async function buyNow(itemId: string, seenPriceCents: number): Promise<string> {
  const held = rpcData(
    await supabase.rpc("declutter_buy_now", { p_item_id: itemId, p_expected_price_cents: seenPriceCents }),
    (e) => rpcErrorMessage("declutter_buy_now", e),
  ) as string;
  // PUSH-REACH: pickup and the seller's messages follow a buy; the website's push ask.
  offerPushAfterAction();
  return held;
}

/**
 * A Declutter edge function's answer, or its refusal CODE as the error message
 * (declutterErrorMessage maps the code to plain words). The functions answer
 * `{ error: "<code>" }` on a refusal.
 */
export async function invokeDeclutter(fn: "declutter-card" | "declutter-checkout", body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke(fn, { body: { ...body, native: isNativePlatform } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const parsed: { error?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.clone().json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: fall through to the generic message.
          console.warn(`[declutter] ${fn} error body was not JSON`, parseErr);
          return null;
        })
      : null;
    const code = typeof parsed?.error === "string" && parsed.error ? parsed.error : "payment_unavailable";
    openIdentitySheetFor(code);
    throw new Error(code);
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** Stripe's card-saving page (row 36; nothing is charged). Returns its URL. */
export async function startCardSave(): Promise<string> {
  const data = await invokeDeclutter("declutter-card", {});
  if (typeof data.url !== "string") throw new Error("payment_unavailable");
  return data.url;
}

/** Check out one seller's cart lines (row 38): the Stripe page's URL, or paid=true when it already went through. */
export async function startCheckoutPayment(sellerId: string, handover: Handover, slotStart?: string | null, handoff?: "leave" | "hand" | null,
  expectedDeliveryCents?: number | null): Promise<{ url: string | null; paid: boolean }> {
  // A seller delivery carries the picked time (held while the payment page is open), the buyer's door choice
  // and the delivery price the screen showed ("Free" = 0): a different frozen price stops before Stripe.
  const data = await invokeDeclutter("declutter-checkout", {
    action: "pay", seller_id: sellerId, handover,
    ...(handover === "seller_delivery"
      ? { slot_start: slotStart ?? null, handoff: handoff ?? null,
          ...(typeof expectedDeliveryCents === "number" ? { expected_delivery_cents: expectedDeliveryCents } : {}) }
      : {}),
  });
  return { url: typeof data.url === "string" ? data.url : null, paid: data.paid === true };
}

/**
 * The seller backs out of an accepted, unpaid sale. Gives the seller a strike
 * (row 19). Through declutter-checkout, which also closes the buyer's open
 * payment page (B45) so the cancelled sale cannot be paid.
 */
export async function sellerCancelSale(itemId: string): Promise<number> {
  const data = await invokeDeclutter("declutter-checkout", { action: "cancel_sale", item_id: itemId });
  return typeof data.strikes === "number" ? data.strikes : 0;
}

/** Row 62: has the member a sale in flight (so the cart opens even with the switch off)? */
export async function fetchHasAgreedSales(): Promise<boolean> {
  // It raises nothing of its own (no switch gate, row 62): a failure is the generic message.
  return rpcData(await supabase.rpc("declutter_has_agreed_sales"), () => null) === true;
}

/** The signed-in member's id (the session supabase-js holds), for the boot hand-over's same-member check. */
const signedInUserId = async () => (await supabase.auth.getSession()).data.session?.user.id;

export async function fetchMyOffers(): Promise<MyOffer[]> {
  const prefetched = await takeMinePrefetch("offers", signedInUserId);
  if (prefetched) return prefetched as MyOffer[];
  return (rpcData(await supabase.rpc("declutter_my_offers"), (e) => rpcErrorMessage("declutter_my_offers", e)) ?? []) as MyOffer[];
}

export async function fetchMyCart(): Promise<CartLine[]> {
  const prefetched = await takeMinePrefetch("cart", signedInUserId);
  if (prefetched) return prefetched as CartLine[];
  return (rpcData(await supabase.rpc("declutter_my_cart"), (e) => rpcErrorMessage("declutter_my_cart", e)) ?? []) as CartLine[];
}

/** Brand + last 4 of the member's saved card (row 36), or null. Never the Stripe ids. */
export async function fetchMyCard(userId: string): Promise<{ brand: string | null; last4: string | null } | null> {
  const row = unwrap(await supabase.from("declutter_buyer_cards").select("brand, last4").eq("user_id", userId).maybeSingle());
  return (row ?? null) as { brand: string | null; last4: string | null } | null;
}

/** Active Declutter strikes (rows 7, 16, 17): not removed, not expired. */
export async function fetchMyActiveStrikes(userId: string): Promise<number> {
  const rows = unwrap(
    await supabase
      .from("declutter_strikes")
      .select("id")
      .eq("user_id", userId)
      .is("removed_at", null)
      .gt("expires_at", new Date().toISOString()),
  );
  return (rows ?? []).length;
}
