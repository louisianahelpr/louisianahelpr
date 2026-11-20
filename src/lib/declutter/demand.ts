/**
 * Declutter top 5 #3 (owner 11-19): "In demand" on listings, from real counts only (declutter_item_demand,
 * 20261120012729): saves, different buyers' offers in the last 7 days, different people's views since midnight
 * Louisiana time. Each line shows only past its threshold, so a 1 or a 2 never reads as "demand".
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";

export const DEMAND_MIN = { saves: 3, offersWeek: 2, viewsToday: 5 } as const;

export interface ItemDemand {
  saves: number;
  offers_week: number;
  views_today: number;
}

/** Browse's "In demand" card tag: at least DEMAND_MIN.offersWeek different buyers made offers this week. */
export function isInDemand(d: Pick<ItemDemand, "offers_week">): boolean {
  return d.offers_week >= DEMAND_MIN.offersWeek;
}

/** The item page's lines, strongest first, each only past its threshold. */
export function demandLines(d: ItemDemand | null): { key: "offers" | "saves" | "views"; n: number }[] {
  if (!d) return [];
  const out: { key: "offers" | "saves" | "views"; n: number }[] = [];
  if (d.offers_week >= DEMAND_MIN.offersWeek) out.push({ key: "offers", n: d.offers_week });
  if (d.saves >= DEMAND_MIN.saves) out.push({ key: "saves", n: d.saves });
  if (d.views_today >= DEMAND_MIN.viewsToday) out.push({ key: "views", n: d.views_today });
  return out;
}

/** One item's numbers for its page; null when it has none, or before the read is deployed (PGRST202). */
export async function fetchItemDemand(itemId: string): Promise<ItemDemand | null> {
  const res = await supabase.rpc("declutter_item_demand", { p_item_ids: [itemId] });
  if (res.error && isMissingRpcNamed(res.error, "declutter_item_demand")) return null;
  const row = (unwrap(res) ?? [])[0];
  return row ? { saves: row.saves, offers_week: row.offers_week, views_today: row.views_today } : null;
}
