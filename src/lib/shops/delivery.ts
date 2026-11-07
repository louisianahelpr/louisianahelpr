/**
 * Shops delivery, slice 1: "Shop delivers" (owner 11-05 answer 3; migration 20261106180902_shops_delivery).
 *
 * The shop offers its own delivery: free or a whole-dollar fee from $5 to $150, within 1 to 50 miles of its pin.
 * A buyer who picks it types the drop-off address; shop-checkout geocodes it on the server and the SQL measures the
 * miles, refuses one past the radius and freezes the fee into the order. The shop reads the address only once it
 * has accepted the order. Every rule is in SQL; nothing here is the protection.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "./rpcErrorCopy";
import { invokeShopCheckoutAction } from "./orders";

export interface DeliveryOffer {
  delivers: boolean;
  fee_cents: number;
  radius_miles: number;
  /** Helpr delivery (20261106194913): a Helpr delivers at Declutter's price for the road miles. Read-only here. */
  helpr_delivery?: boolean;
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
    .select("delivers, delivery_fee_cents, delivery_radius_miles, helpr_delivery").eq("id", shopId).maybeSingle()) as
    { delivers?: boolean; delivery_fee_cents?: number; delivery_radius_miles?: number; helpr_delivery?: boolean } | null;
  return {
    delivers: row?.delivers === true, fee_cents: row?.delivery_fee_cents ?? 0, radius_miles: row?.delivery_radius_miles ?? 10,
    helpr_delivery: row?.helpr_delivery === true,
  };
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

/**
 * Helpr delivery (slice 2, shop-checkout 'helpr_quote'; 20261106223244): the price a Helpr delivers this drop-off for,
 * BEFORE the order. The server geocodes the address and measures the road miles from the shop's private pickup point;
 * the order then freezes the same figure (a different one is refused as delivery_rate_changed, nothing charged).
 */
export interface HelprQuote { delivery_cents: number; delivery_miles: number }

export async function fetchHelprDeliveryQuote(shopId: string, address: DeliveryAddress): Promise<HelprQuote> {
  const data = await invokeShopCheckoutAction({ action: "helpr_quote", shop_id: shopId, delivery: address });
  const cents = Number(data.delivery_cents);
  const miles = Number(data.delivery_miles);
  if (!Number.isInteger(cents) || cents <= 0 || !Number.isInteger(miles) || miles < 1) throw new Error("geocode_unavailable");
  return { delivery_cents: cents, delivery_miles: miles };
}

/**
 * After the shop saves its pickup address: the server looks the address up and keeps the point a Helpr goes to
 * (shop-checkout 'pickup_point' -> shop_set_pickup_point). Private: the answer never carries the point.
 */
export async function savePickupPoint(): Promise<void> {
  const data = await invokeShopCheckoutAction({ action: "pickup_point" });
  if (data.saved !== true) throw new Error("geocode_unavailable");
}

/**
 * The shop says the booked Helpr didn't come (shop_report_helpr_no_show, 20261106211136): the Helpr has 24 hours to
 * answer and the money waits. The server checks the timing (15 minutes after the pickup time) and the booking.
 */
export async function reportHelprNoShow(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("shop_report_helpr_no_show", { p_order_id: orderId });
  if (error) rpcFail(error, rpcErrorMessage("shop_report_helpr_no_show", error));
}

/**
 * The order's Helpr task (shops_order_helpr_task, 20261107164311), for the shop owner or the buyer: NULL while there is
 * none, and NULL before that migration is live (the card then shows no pickup time and no "didn't come" button). The
 * card reads the booked slot through helpr_task_view, which answers the shop as the task's pickup contact.
 */
export async function fetchOrderHelprTask(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("shops_order_helpr_task", { p_order_id: orderId });
  if (error) {
    if (isMissingRpcNamed(error, "shops_order_helpr_task")) return null;
    rpcFail(error, rpcErrorMessage("shops_order_helpr_task", error));
  }
  return typeof data === "string" ? data : null;
}

/** The shop turns Helpr delivery on or off (needs a looked-up pickup point; the server checks). */
export async function setHelprDelivery(on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("shops_set_helpr_delivery", { p_on: on });
  if (error) rpcFail(error, rpcErrorMessage("shops_set_helpr_delivery", error));
  return (data as { helpr_delivery?: boolean } | null)?.helpr_delivery === true;
}
