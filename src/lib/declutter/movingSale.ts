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

const MOVE_ITEM_COLUMNS = "id, status, title, current_price_cents, area_label";

/**
 * The banner's line, plain words. Other members never get the exact date
 * (declutter_seller_moving_sale returns the month only): a date and an
 * address together say when a home will be empty.
 */
export function movingSaleLine(moveMonth: string, count: number, more = false): string {
  const items = more ? `${count}+ items for sale` : `${count} ${count === 1 ? "item" : "items"} for sale`;
  const [y, m] = moveMonth.split("-").map(Number);
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `Moving out in ${month}. ${items}.`;
}

const MOVING_SALE_READ_LIMIT = 100;

export interface SellerMovingSale {
  /** First of the move-out month, YYYY-MM-DD. Never the date itself. */
  moveMonth: string;
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
  const sale = ((data ?? []) as { move_month: string }[])[0];
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
  return { moveMonth: sale.move_month, items: rows.slice(0, MOVING_SALE_READ_LIMIT), more: rows.length > MOVING_SALE_READ_LIMIT };
}
