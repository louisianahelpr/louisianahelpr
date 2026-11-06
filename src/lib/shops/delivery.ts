/**
 * Shops delivery, slice 1: "Shop delivers" (owner 11-05 answer 3; migration 20261106180902_shops_delivery).
 *
 * The shop offers its own delivery: free or a whole-dollar fee from $5 to $150, within 1 to 50 miles of its pin.
 * A buyer who picks it types the drop-off address; shop-checkout geocodes it on the server and the SQL measures the
 * miles, refuses one past the radius and freezes the fee into the order. The shop reads the address only once it
 * has accepted the order. Every rule is in SQL; nothing here is the protection.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "./rpcErrorCopy";

export interface DeliveryOffer {
  delivers: boolean;
  fee_cents: number;
  radius_miles: number;
}

export interface DeliveryAddress {
  line1: string;
  line2?: string;
  city: string;
  postal_code: string;
}

/** The same rule as shops_delivery_offer / shops_set_delivery: free, or a whole-dollar $5 to $150. */
const DELIVERY_FEE_MIN_CENTS = 500;
const DELIVERY_FEE_MAX_CENTS = 15_000;
export const DELIVERY_RADIUS_MAX_MILES = 50;

export function deliveryFeeProblem(cents: number): string | null {
  if (!Number.isInteger(cents) || cents % 100 !== 0) return "Use whole dollars.";
  if (cents !== 0 && (cents < DELIVERY_FEE_MIN_CENTS || cents > DELIVERY_FEE_MAX_CENTS)) return "Make it free, or $5 to $150.";
  return null;
}

/** A plausible drop-off address before it is sent (the server geocodes and checks it again). */
export function deliveryAddressProblem(a: DeliveryAddress): string | null {
  if (a.line1.trim().length < 3) return "Enter the street address.";
  if (a.city.trim().length < 2) return "Enter the city.";
  if (!/^\d{5}$/.test(a.postal_code.trim())) return "Enter a 5-digit ZIP code.";
  return null;
}

/** The RPC's error with its plain-words copy (read at each call site) as userMessage, as orders.ts does. */
function rpcFail(error: { message: string }, words: string | null | undefined): never {
  throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
}

/** The shop's offer, from the column grant on shops. */
export async function fetchDeliveryOffer(shopId: string): Promise<DeliveryOffer> {
  const row = unwrap(await supabase.from("shops")
    .select("delivers, delivery_fee_cents, delivery_radius_miles").eq("id", shopId).maybeSingle()) as
    { delivers?: boolean; delivery_fee_cents?: number; delivery_radius_miles?: number } | null;
  return { delivers: row?.delivers === true, fee_cents: row?.delivery_fee_cents ?? 0, radius_miles: row?.delivery_radius_miles ?? 10 };
}

export async function setDeliveryOffer(offer: DeliveryOffer): Promise<DeliveryOffer> {
  const { data, error } = await supabase.rpc("shops_set_delivery", {
    p_delivers: offer.delivers, p_fee_cents: offer.fee_cents, p_radius_miles: offer.radius_miles,
  });
  if (error) rpcFail(error, rpcErrorMessage("shops_set_delivery", error));
  const d = (data ?? {}) as { delivers?: boolean; delivery_fee_cents?: number; delivery_radius_miles?: number };
  return { delivers: d.delivers === true, fee_cents: d.delivery_fee_cents ?? 0, radius_miles: d.delivery_radius_miles ?? offer.radius_miles };
}

/** ONE order's drop-off: the buyer's own, or the shop's while the order is accepted. null when not shown. */
export async function fetchOrderDeliveryAddress(orderId: string): Promise<DeliveryAddress | null> {
  const { data, error } = await supabase.rpc("shops_order_delivery_address", { p_order_id: orderId });
  if (error) rpcFail(error, rpcErrorMessage("shops_order_delivery_address", error));
  const row = (Array.isArray(data) ? data[0] : null) as { line1: string; line2: string | null; city: string; postal_code: string } | null;
  return row ? { line1: row.line1, ...(row.line2 ? { line2: row.line2 } : {}), city: row.city, postal_code: row.postal_code } : null;
}

/** "100 Main St, Apt 2, Lafayette, LA 70501". */
export function formatDeliveryAddress(a: DeliveryAddress): string {
  return [a.line1, a.line2, a.city].filter(Boolean).join(", ") + `, LA ${a.postal_code}`;
}
