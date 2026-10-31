/**
 * A seller's moving sale as OTHER members see it (docs/specs/declutter-moving-out.md),
 * for the banner on /user/:id. Its own module so the profile page does not
 * pull moving-out mode's whole flow (moves.ts) into the signed-in shared chunk
 * every signed-in page loads (Q178 critical-path budget).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import type { MoveItem } from "@/lib/declutter/moves";
import { daysBetween, formatMoveDate } from "@/lib/declutter/moveDates";

export { louisianaToday } from "@/lib/declutter/moveDates";

const MOVE_ITEM_COLUMNS = "id, status, title, current_price_cents, area_label, category";

/**
 * The banner's line, plain words, with the exact move-out date (owner
 * 2026-10-17). declutter_seller_moving_sale returns nothing once the date has
 * passed, so there is never a "moved out" line.
 */
export function movingSaleLine(moveOutOn: string, count: number, today: string, more = false): string {
  const items = more ? `${count}+ items for sale` : `${count} ${count === 1 ? "item" : "items"} for sale`;
  const left = daysBetween(today, moveOutOn);
  if (left <= 0) return `Moving out today. ${items}.`;
  if (left === 1) return `Moving out tomorrow. ${items}.`;
  return `Moving out ${formatMoveDate(moveOutOn)}. ${items}.`;
}

/** "Oct 30 – Nov 1 · 2 items for sale" once the seller set a start date (Q2269); else movingSaleLine. */
export function movingSaleWhen(startsOn: string | null, moveOutOn: string, count: number, today: string, more = false): string {
  if (!startsOn) return movingSaleLine(moveOutOn, count, today, more);
  const short = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day)));
  };
  const items = more ? `${count}+ items for sale` : `${count} ${count === 1 ? "item" : "items"} for sale`;
  return `${short(startsOn)} – ${short(moveOutOn)} · ${items}`;
}

/** Is this item in a moving sale? Signed-in members only: guests have no grant on the column (measured on prod 10-30). */
export async function fetchItemInMovingSale(itemId: string): Promise<boolean> {
  const row = unwrap(await supabase.from("declutter_items").select("in_moving_sale").eq("id", itemId).maybeSingle()) as { in_moving_sale: boolean } | null;
  return row?.in_moving_sale ?? false;
}

const MOVING_SALE_READ_LIMIT = 100;

export interface SellerMovingSale {
  /** The move-out date, YYYY-MM-DD. */
  moveOutOn: string;
  /** Q2269: the seller's name for the sale and its start (YYYY-MM-DD); null when not set or not deployed. */
  saleName: string | null;
  startsOn: string | null;
  items: MoveItem[];
  more: boolean;
}

/** A seller's moving sale as other members see it, or null (none, ended, hidden, blocked). */
export async function fetchSellerMovingSale(sellerId: string): Promise<SellerMovingSale | null> {
  const { data, error } = await supabase.rpc("declutter_seller_moving_sale", { p_seller_id: sellerId });
  if (error) {
    const e = Object.assign(new Error(error.message), error) as Error & { userMessage?: string };
    const words = rpcErrorMessage("declutter_seller_moving_sale", error);
    if (words) e.userMessage = words;
    throw e;
  }
  const sale = ((data ?? []) as { move_out_on: string; sale_name?: string | null; sale_starts_on?: string | null }[])[0];
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
  return { moveOutOn: sale.move_out_on, saleName: sale.sale_name ?? null, startsOn: sale.sale_starts_on ?? null, items: rows.slice(0, MOVING_SALE_READ_LIMIT), more: rows.length > MOVING_SALE_READ_LIMIT };
}
