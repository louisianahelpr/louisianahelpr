/**
 * Declutter moving-out mode (docs/specs/declutter-moving-out.md): list a
 * whole home from room photos, then list the drafts together.
 *
 * Nothing here is the protection. Every write is a declutter_* RPC behind the
 * 'declutter' AND 'declutter_moving_out' switches; drafts are made through
 * declutter_create_item on the server (every listing rule), and listing them
 * is one declutter_publish_item call per item, the same as listing one item.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { cleanListingPhoto } from "@/lib/declutter/photos";
import { attestItem, publishItem, requestAiCheck, type DeclutterStatus, type DeliverySize } from "@/lib/declutter/api";

/** One item the photo tool found in a room (nothing is saved yet). */
export interface RoomItem {
  title: string;
  description: string;
  category: string;
  deliverySize: DeliverySize;
  conditionStars: number;
  flagged: boolean;
}

/** A found item as the seller edits it before saving. */
export interface MoveRow extends RoomItem {
  key: string;
  keep: boolean;
  price: string;
  floor: string;
}

/** The server's limits (declutter_create_move_drafts, declutter-ai-draft room mode). */
export const MOVE_ROOM_PHOTOS_MAX = 4;
export const MOVE_SAVE_BATCH = 15;
const MOVE_DATE_MAX_DAYS = 180;
/** declutter-ai-draft allows 6 calls a minute per member: one photo check every 10.5 s stays under it. */
export const AI_CHECK_GAP_MS = 10_500;

/** Today's date in Louisiana as YYYY-MM-DD (the server's day). */
export function louisianaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** What is wrong with a move-out date, in plain words, or null. Mirrors declutter_move_out_date_problem. */
export function moveDateProblem(date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Pick your move-out date.";
  const d = daysBetween(today, date);
  if (Number.isNaN(d)) return "Pick your move-out date.";
  if (d < 0) return "Your move-out date can't be in the past.";
  if (d > MOVE_DATE_MAX_DAYS) return "Pick a move-out date within the next 6 months.";
  return null;
}

/** "Saturday, Nov 14" for a YYYY-MM-DD date (read as a calendar day, no time zone shift). */
export function formatMoveDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * The banner's line, plain words. Other members never get the exact date
 * (declutter_seller_moving_sale returns "soon" or the month only): a date and
 * an address together say when a home will be empty.
 */
export function movingSaleLine(soon: boolean, moveMonth: string, count: number, more = false): string {
  const items = more ? `${count}+ items for sale` : `${count} ${count === 1 ? "item" : "items"} for sale`;
  if (soon) return `Moving out soon. ${items}.`;
  const [y, m] = moveMonth.split("-").map(Number);
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `Moving out in ${month}. ${items}.`;
}

/** Dollars as typed -> whole cents, or null. */
export function moveDollarsToCents(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!v.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** What is wrong with one kept row, in plain words, or null. Mirrors declutter_create_item. */
export function moveRowProblem(row: Pick<MoveRow, "title" | "price" | "floor">): string | null {
  if (row.title.trim().length < 3) return "Give each item a name of at least 3 characters.";
  const price = moveDollarsToCents(row.price);
  if (price === null || price < 100 || price > 100_000) return "Give each item a price between $1 and $1,000.";
  const floor = row.floor.trim() ? moveDollarsToCents(row.floor) : price;
  if (floor === null || floor < 100 || floor > price) return "Each lowest price must be at least $1 and no more than its price.";
  return null;
}

/** A found item ready for the seller's edits. No price is guessed (row 80 comes later). */
export function toMoveRows(items: RoomItem[], keyPrefix: string): MoveRow[] {
  return items.map((it, i) => ({ ...it, key: `${keyPrefix}-${i}`, keep: true, price: "", floor: "" }));
}

/** The server's item shape. A blank lowest price is the price (no evening drops). */
export function toMovePayload(rows: MoveRow[]) {
  return rows.filter((r) => r.keep).map((r) => {
    const price = moveDollarsToCents(r.price)!;
    return {
      title: r.title.trim(),
      description: r.description.trim(),
      category: r.category,
      condition_stars: r.conditionStars,
      delivery_size: r.deliverySize,
      price_cents: price,
      floor_price_cents: r.floor.trim() ? moveDollarsToCents(r.floor)! : price,
    };
  });
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------------ */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Ask the photo tool what is in a room. The photos are cleaned (no location
 * data) and sent once; they are never uploaded or kept. Saves nothing.
 */
export async function scanRoom(files: File[]): Promise<RoomItem[]> {
  if (files.length < 1 || files.length > MOVE_ROOM_PHOTOS_MAX) throw new Error("room_photos_invalid");
  const photos: string[] = [];
  for (const f of files) photos.push(await blobToBase64(await cleanListingPhoto(f, 1280, 0.75)));
  const { data, error } = await supabase.functions.invoke("declutter-ai-draft", { body: { mode: "room", photos } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
    const body: { error?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: fall through to ai_unavailable.
          console.warn("[declutter] room scan error body was not JSON", parseErr);
          return null;
        })
      : null;
    if (status === 429) throw new Error("ai_rate_limited");
    const code = typeof body?.error === "string" && /^[a-z_0-9]+$/.test(body.error) ? body.error : "";
    throw new Error(code || "ai_unavailable");
  }
  const items = (data as { items?: unknown } | null)?.items;
  // An answer without a list is a fault, never "nothing in this room".
  if (!Array.isArray(items)) throw new Error("ai_unavailable");
  return items as RoomItem[];
}

export interface PickupPlace {
  areaLabel: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
}

function rpcFail(fn: "declutter_create_move_drafts" | "declutter_set_move_out_date" | "declutter_my_move_out_date" | "declutter_seller_moving_sale", error: { message: string }): never {
  const e = Object.assign(new Error(error.message), error) as Error & { userMessage?: string };
  const words = rpcErrorMessage(fn, error);
  if (words) e.userMessage = words;
  throw e;
}

/** Save up to 15 drafts in one all-or-nothing call; the ids come back. */
export async function createMoveDrafts(moveOutOn: string, place: PickupPlace, rows: MoveRow[]): Promise<string[]> {
  const { data, error } = await supabase.rpc("declutter_create_move_drafts", {
    p_move_out_on: moveOutOn,
    p_area_label: place.areaLabel,
    p_pickup_address: place.pickupAddress,
    p_pickup_lat: place.pickupLat,
    p_pickup_lng: place.pickupLng,
    p_items: toMovePayload(rows),
  });
  if (error) rpcFail("declutter_create_move_drafts", error);
  return (data ?? []) as string[];
}

/** Move the date, or (null) end the moving sale. How many listings changed. */
export async function setMoveOutDate(moveOutOn: string | null): Promise<number> {
  const { data, error } = await supabase.rpc("declutter_set_move_out_date", { p_move_out_on: moveOutOn });
  if (error) rpcFail("declutter_set_move_out_date", error);
  // Zero is legitimate: nothing of the seller's is still in the moving sale.
  return typeof data === "number" ? data : 0;
}

export interface MoveItem {
  id: string;
  status: DeclutterStatus;
  title: string;
  current_price_cents: number;
  area_label: string;
}

const MOVE_ITEM_COLUMNS = "id, status, title, current_price_cents, area_label";

/** The seller's own moving-sale listings, every status still worth showing. */
export async function fetchMyMoveItems(userId: string): Promise<MoveItem[]> {
  const rows = unwrap(
    await supabase
      .from("declutter_items")
      .select(MOVE_ITEM_COLUMNS)
      .eq("seller_id", userId)
      .eq("in_moving_sale", true)
      .in("status", ["draft", "pending_review", "live", "reserved", "sold", "completed", "ended", "rejected"])
      .order("created_at", { ascending: true }),
  );
  return (rows ?? []) as MoveItem[];
}

/** The seller's own move-out date (YYYY-MM-DD), or null when no moving sale is running. */
export async function fetchMyMoveOutDate(): Promise<string | null> {
  const { data, error } = await supabase.rpc("declutter_my_move_out_date");
  if (error) rpcFail("declutter_my_move_out_date", error);
  return typeof data === "string" ? data : null;
}

const MOVING_SALE_READ_LIMIT = 100;

export interface SellerMovingSale {
  soon: boolean;
  /** First of the move-out month, YYYY-MM-DD. Never the date itself. */
  moveMonth: string;
  items: MoveItem[];
  more: boolean;
}

/** A seller's moving sale as other members see it, or null (none, ended, hidden, blocked). */
export async function fetchSellerMovingSale(sellerId: string): Promise<SellerMovingSale | null> {
  const { data, error } = await supabase.rpc("declutter_seller_moving_sale", { p_seller_id: sellerId });
  if (error) rpcFail("declutter_seller_moving_sale", error);
  const sale = ((data ?? []) as { moving_soon: boolean; move_month: string }[])[0];
  if (!sale) return null;
  const rows = (unwrap(
    await supabase
      .from("declutter_items")
      .select(MOVE_ITEM_COLUMNS)
      .eq("seller_id", sellerId)
      .eq("in_moving_sale", true)
      .in("status", ["live", "reserved"])
      .order("live_at", { ascending: false })
      .limit(MOVING_SALE_READ_LIMIT + 1),
  ) ?? []) as MoveItem[];
  if (rows.length === 0) return null;
  return { soon: sale.moving_soon, moveMonth: sale.move_month, items: rows.slice(0, MOVING_SALE_READ_LIMIT), more: rows.length > MOVING_SALE_READ_LIMIT };
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
      try {
        await requestAiCheck(id);
      } catch (err) {
        // Fail-safe: an unchecked listing publishes to an admin's review.
        console.warn("[declutter] photo check unavailable; the listing goes to review", err);
      }
      out.push({ id, status: await publishItem(id) });
    } catch (error) {
      // Not swallowed: the refusal is returned for this item, and the screen
      // tells the seller how many were not listed and why.
      out.push({ id, error });
    }
    onProgress(i + 1, itemIds.length);
  }
  return out;
}
