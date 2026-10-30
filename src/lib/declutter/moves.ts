/**
 * Declutter moving sale (docs/specs/declutter-moving-out.md). The flow is Sell a bunch with an optional move-out date
 * (lead 2026-10-30, owner's one flow): this module holds the sale's own calls and the many-drafts publish both use.
 *
 * Nothing here is the protection. Every write is a declutter_* RPC behind the
 * 'declutter' AND 'declutter_moving_out' switches; drafts are made through
 * declutter_create_item on the server (every listing rule), and listing them
 * is one declutter_publish_item call per item, the same as listing one item.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { daysBetween, formatMoveDate, louisianaToday } from "@/lib/declutter/moveDates";
import { attestItem, publishItem, requestAiCheckWithRetry, type DeclutterStatus, type DeliverySize } from "@/lib/declutter/api";
import { setupFeeRefusal } from "@/lib/declutter/setupFee";

// The calendar helpers live in moveDates.ts (shared with the banner).
export { daysBetween, formatMoveDate, louisianaToday };

const MOVE_DATE_MAX_DAYS = 180;
/** declutter-ai-draft allows 6 calls a minute per member: one photo check every 10.5 s stays under it. */
export const AI_CHECK_GAP_MS = 10_500;

/** What is wrong with a move-out date, in plain words, or null. Mirrors declutter_move_out_date_problem. */
export function moveDateProblem(date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Pick your move-out date.";
  const d = daysBetween(today, date);
  if (Number.isNaN(d)) return "Pick your move-out date.";
  if (d < 0) return "Your move-out date can't be in the past.";
  if (d > MOVE_DATE_MAX_DAYS) return "Pick a move-out date within the next 6 months.";
  return null;
}

/** Dollars as typed -> whole cents, or null. */
export function moveDollarsToCents(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!v.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** What is wrong with one kept row, in plain words, or null. Mirrors declutter_create_item. */
export function moveRowProblem(row: { title: string; price: string; floor: string }): string | null {
  if (row.title.trim().length < 3) return "Give each item a name of at least 3 characters.";
  const price = moveDollarsToCents(row.price);
  if (price === null || price < 100 || price > 100_000) return "Give each item a price between $1 and $1,000.";
  const floor = row.floor.trim() ? moveDollarsToCents(row.floor) : price;
  if (floor === null || floor < 100 || floor > price) return "Each lowest price must be at least $1 and no more than its price.";
  return null;
}

export interface PickupPlace {
  areaLabel: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
}

/** Throw the refusal with its plain words (read at each call site, the rpcErrorCopyCoverage rule). */
function rpcFail(error: { message: string }, words: string | null): never {
  const e = Object.assign(new Error(error.message), error) as Error & { userMessage?: string };
  if (words) e.userMessage = words;
  throw e;
}

/** One draft's fields, in the shape the server's call takes. */
export interface MoveDraftFields {
  title: string;
  description: string;
  category: string;
  conditionStars: number;
  deliverySize: DeliverySize;
  priceCents: number;
  floorPriceCents: number;
}

/**
 * One item's draft, in the seller's moving sale: the server makes it through declutter_create_item (every listing rule)
 * and stamps the date. It takes 1 to 15 items and caps open moving-sale drafts at 60; a bunch lists one item at a time.
 */
export async function createMoveDraft(moveOutOn: string, place: PickupPlace, f: MoveDraftFields): Promise<string> {
  const { data, error } = await supabase.rpc("declutter_create_move_drafts", {
    p_move_out_on: moveOutOn,
    p_area_label: place.areaLabel,
    p_pickup_address: place.pickupAddress,
    p_pickup_lat: place.pickupLat,
    p_pickup_lng: place.pickupLng,
    p_items: [{
      title: f.title,
      description: f.description,
      category: f.category,
      condition_stars: f.conditionStars,
      delivery_size: f.deliverySize,
      price_cents: f.priceCents,
      floor_price_cents: f.floorPriceCents,
    }],
  });
  if (error) rpcFail(error, rpcErrorMessage("declutter_create_move_drafts", error));
  const id = ((data ?? []) as string[])[0];
  if (!id) throw new Error("invalid_items");
  return id;
}

/** Move the date, or (null) end the moving sale. How many listings changed. */
export async function setMoveOutDate(moveOutOn: string | null): Promise<number> {
  const { data, error } = await supabase.rpc("declutter_set_move_out_date", { p_move_out_on: moveOutOn });
  if (error) rpcFail(error, rpcErrorMessage("declutter_set_move_out_date", error));
  // Zero is legitimate: nothing of the seller's is still in the moving sale.
  return typeof data === "number" ? data : 0;
}

/**
 * Q2269: name the moving sale and say when it starts (both optional; blank clears). How many listings it was set on,
 * or "not_deployed" while migration 20261021030654 has not reached prod.
 */
export async function setMovingSale(name: string, startsOn: string | null): Promise<number | "not_deployed"> {
  const { data, error } = await supabase.rpc("declutter_set_moving_sale", { p_name: name, p_starts_on: startsOn as string });
  if (error && isMissingRpcNamed(error, "declutter_set_moving_sale")) return "not_deployed";
  if (error) rpcFail(error, rpcErrorMessage("declutter_set_moving_sale", error));
  return typeof data === "number" ? data : 0;
}

/** Q2269: the seller's own saved sale name and start (drafts too), or null; null before the migration is live. */
export async function fetchMyMovingSale(): Promise<{ saleName: string | null; startsOn: string | null } | null> {
  const { data, error } = await supabase.rpc("declutter_my_moving_sale");
  if (error && isMissingRpcNamed(error, "declutter_my_moving_sale")) return null;
  if (error) rpcFail(error, rpcErrorMessage("declutter_my_moving_sale", error));
  const row = ((data ?? []) as { sale_name: string | null; sale_starts_on: string | null }[])[0];
  return row ? { saleName: row.sale_name, startsOn: row.sale_starts_on } : null;
}

export interface MoveItem {
  id: string;
  status: DeclutterStatus;
  title: string;
  current_price_cents: number;
  area_label: string;
  /** For the photo-less card's icon (PhotoPlaceholder). */
  category?: string;
}

const MOVE_ITEM_COLUMNS = "id, status, title, current_price_cents, area_label, category";

/** The seller's own moving-sale listings, every status still worth showing. */
export async function fetchMyMoveItems(userId: string): Promise<MoveItem[]> {
  const rows = unwrap(
    await supabase
      .from("declutter_items")
      .select(MOVE_ITEM_COLUMNS)
      .eq("seller_id", userId)
      .eq("in_moving_sale", true)
      .in("status", ["draft", "pending_review", "live", "paused", "reserved", "sold", "completed", "ended", "rejected"])
      .order("created_at", { ascending: true }),
  );
  return (rows ?? []) as MoveItem[];
}

/** The seller's own move-out date (YYYY-MM-DD), or null when no moving sale is running. */
export async function fetchMyMoveOutDate(): Promise<string | null> {
  const { data, error } = await supabase.rpc("declutter_my_move_out_date");
  if (error) rpcFail(error, rpcErrorMessage("declutter_my_move_out_date", error));
  return typeof data === "string" ? data : null;
}

export type PublishOutcome = { id: string; status: "live" | "pending_review" } | { id: string; error: unknown };

/**
 * List several drafts, one at a time, each through the same three calls as
 * listing one item: the four confirmations, the photo check, publish. The
 * photo checks are spaced to stay under the photo tool's per-minute limit
 * (an unchecked item would only wait for a review, never skip one).
 */
export async function publishMany(
  itemIds: string[],
  onProgress: (done: number, total: number) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  clock: () => number = () => Date.now(),
): Promise<PublishOutcome[]> {
  const out: PublishOutcome[] = [];
  let lastCheck = -Infinity;
  for (const [i, id] of itemIds.entries()) {
    try {
      await attestItem(id);
      const gap = lastCheck + AI_CHECK_GAP_MS - clock();
      if (gap > 0) await wait(gap);
      lastCheck = clock();
      // Asked twice; if it never comes back the listing is held for an admin (the server's fail-safe).
      await requestAiCheckWithRetry(id);
      out.push({ id, status: await publishItem(id) });
    } catch (error) {
      // Not swallowed: the refusal is returned for this item, and the screen
      // tells the seller how many were not listed and why.
      out.push({ id, error });
      // lh-silent-failure review of the Q2352 rebase #3: the one-time setup fee is an ACCOUNT refusal, so every
      // later item would be refused the same way after spending its own photo check. Stop at the first.
      if (setupFeeRefusal(error)) {
        for (const rest of itemIds.slice(i + 1)) out.push({ id: rest, error });
        onProgress(itemIds.length, itemIds.length);
        break;
      }
    }
    onProgress(i + 1, itemIds.length);
  }
  return out;
}
