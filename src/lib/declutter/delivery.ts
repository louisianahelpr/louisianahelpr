/**
 * Declutter slice 5, Helpr delivery (docs/specs/declutter-auctions.md rows 29,
 * 30, 38, 40-43): the price shown before checkout and the buyer's quote call.
 *
 * The SERVER prices every delivery (declutter_delivery_price_cents and
 * declutter_road_miles in 20261017055505): the drop-off address is geocoded
 * by the declutter-checkout edge function and the fee is frozen on the order
 * at checkout. This file only mirrors the formula to explain it, and must
 * agree with the SQL (src/lib/helprTasks/api.test.ts, src/test/pglite/declutterDelivery.pglite.mjs).
 */
import { supabase } from "@/integrations/supabase/client";
import type { DeliverySize } from "@/lib/declutter/api";

/** Row 29: $10 base per checkout. */
export const DELIVERY_BASE_CENTS = 1000;
/** Row 29: $2 per road mile (no limit, row 30). */
export const DELIVERY_PER_MILE_CENTS = 200;
/** Row 29: the size add-on per item: small $0, large $20, extra large (two people) $40. */
export const DELIVERY_SIZE_CENTS: Record<DeliverySize, number> = { small: 0, large: 2000, xl: 4000 };

/** The delivery fee for one checkout (row 38: one base + miles, size add-ons per item). */
export function deliveryPriceCents(roadMiles: number, sizes: readonly DeliverySize[]): number {
  const miles = Math.max(1, Math.ceil(Number.isFinite(roadMiles) ? roadMiles : 1));
  return DELIVERY_BASE_CENTS + DELIVERY_PER_MILE_CENTS * miles + sizes.reduce((sum, s) => sum + (DELIVERY_SIZE_CENTS[s] ?? 0), 0);
}

/** What the Helpr takes home from a delivery fee: jobs' flat fee 5% + 70c comes out of it (row 42). */
export function helprTakeHomeCents(payCents: number): number {
  const pay = Math.max(0, Math.round(payCents));
  if (pay === 0) return 0;
  return pay - Math.min(pay, Math.round((pay * 5) / 100) + 70);
}

export interface DeliveryQuote {
  road_miles: number;
  size: DeliverySize;
  delivery_cents: number;
  base_cents: number;
  per_mile_cents: number;
  size_cents: number;
  dropoff_area: string;
}

function isQuote(q: unknown): q is DeliveryQuote {
  const x = q as Partial<DeliveryQuote> | null;
  return !!x && Number.isInteger(x.delivery_cents) && Number.isInteger(x.road_miles) && typeof x.size === "string";
}

/**
 * Ask the server to price delivery to `address` for the buyer's cart with one
 * seller. The address is geocoded on the server; nothing is charged. Throws an
 * Error whose message is the server's code (declutterErrorMessage words it).
 */
export async function fetchDeliveryQuote(sellerId: string, address: string): Promise<DeliveryQuote> {
  const { data, error } = await supabase.functions.invoke("declutter-checkout", {
    body: { action: "delivery_quote", seller_id: sellerId, address },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const parsed: { error?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.clone().json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: the generic message is shown.
          console.warn("[declutter] delivery quote error body was not JSON", parseErr);
          return null;
        })
      : null;
    throw new Error(typeof parsed?.error === "string" && parsed.error ? parsed.error : "payment_unavailable");
  }
  const quote = (data as { quote?: unknown } | null)?.quote;
  if (!isQuote(quote)) throw new Error("payment_unavailable");
  return quote;
}
