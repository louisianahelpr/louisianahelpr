/**
 * The Declutter fair-price hint, client side (docs/specs/declutter-wanted-price-hint.md,
 * W9-W12). Its own module, imported only by DeclutterPriceHint.tsx, so it is
 * never pulled into a chunk shared by other signed-in routes (Q178 budget).
 * The RPC refuses server-side without its hidden switch.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { formatPrice } from "@/lib/declutter/distance";
import { rpcData } from "@/lib/declutter/api";

export interface PriceHint {
  low_cents: number;
  high_cents: number;
  sales: number;
}

/** Where the hint's sales were counted from: the member (sell flow) or the listing's area (item page). */
export type HintPlace = "near_you" | "this_area";

/**
 * The hint's words, or null when there is nothing true to say (W10, W11).
 * The server answers only with at least 11 real sales and gives the count in
 * tens; anything else here is treated as no answer, so a bad row can never
 * put a number on screen. "Items like this" = same category and condition,
 * which the basis line says in full.
 */
export function priceHintWords(h: PriceHint | null | undefined, place: HintPlace): { headline: string; basis: string } | null {
  if (!h || !Number.isInteger(h.sales) || h.sales < 10 || h.sales % 10 !== 0) return null;
  if (!Number.isFinite(h.low_cents) || !Number.isFinite(h.high_cents) || h.low_cents < 100 || h.high_cents < h.low_cents) return null;
  const where = place === "near_you" ? "near you" : "in this area";
  const range = h.low_cents === h.high_cents ? formatPrice(h.low_cents) : `${formatPrice(h.low_cents)}–${formatPrice(h.high_cents)}`;
  return {
    headline: `Most items like this sold for ${range} ${where}`,
    basis: `Based on ${h.sales}+ Declutter sales of items in the same category and condition, within about 25 miles, in the last year.`,
  };
}

/** The hint for one category + condition near a point, or null (no row = show nothing). */
export async function fetchPriceHint(category: string, conditionStars: number, at: { lat: number; lng: number }): Promise<PriceHint | null> {
  const rows = rpcData(
    await supabase.rpc("declutter_price_hint", {
      p_category: category,
      p_condition_stars: conditionStars,
      p_lat: at.lat,
      p_lng: at.lng,
    }),
    (e) => rpcErrorMessage("declutter_price_hint", e),
  );
  const row = ((rows ?? []) as PriceHint[])[0];
  return row ?? null;
}
