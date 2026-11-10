/**
 * The shop's private pickup address (Shops M1b part 2, migration
 * 20261018210400_shops_pickup_address; lead decision 2026-10-18; tax memo Q3:
 * a pickup sale is taxed where the buyer takes it).
 *
 * Never public: the shop's owner reads their own, and an order's buyer reads it
 * only once the maker accepted the order (the RPC returns no row before that).
 * A refused save throws the RPC's error with its words as userMessage.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { isLouisianaZip } from "@/lib/shipping/policy";
import { rpcErrorMessage } from "./rpcErrorCopy";

export interface PickupAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
}

/**
 * A 5-digit Louisiana ZIP: the shared rule (src/lib/shipping/policy.ts isLouisianaZip,
 * USPS areas 700-701, 703-708, 710-714; 702/709 are unassigned and 715-719 are
 * Arkansas). The server's CHECK and shops_save_my_pickup_address use the same rule
 * (20261106180540); the column holds 5 digits, so a ZIP+4 is refused here too.
 */
export function isLouisianaZip5(zip: string): boolean {
  return /^[0-9]{5}$/.test(zip) && isLouisianaZip(zip);
}

/** The owner's own shop's pickup address, or null when none is saved yet. */
export async function fetchMyPickupAddress(): Promise<PickupAddress | null> {
  const rows = unwrap(await supabase.rpc("shops_my_pickup_address"));
  const r = rows?.[0];
  return r ? { line1: r.line1, line2: r.line2, city: r.city, state: r.state, postal_code: r.postal_code } : null;
}

/**
 * Q2146 (20261110205854): when Stripe last refused the owner's pickup address for sales tax, or null when it has not
 * since the address last changed. Buyers cannot order while it stands. A server without the function yet (PGRST202,
 * the migration not deployed) reads as null; any other error throws.
 */
export async function fetchMyPickupAddressProblem(): Promise<string | null> {
  const { data, error } = await supabase.rpc("shops_my_pickup_address_problem");
  if (error) {
    if (isMissingRpcNamed(error, "shops_my_pickup_address_problem")) return null;
    const words = rpcErrorMessage("shops_my_pickup_address_problem", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
  return typeof data === "string" ? data : null;
}

/** Where to pick up an order: null until the maker accepted it (or for anyone but its buyer and seller). */
export async function fetchOrderPickupAddress(orderId: string): Promise<PickupAddress | null> {
  const rows = unwrap(await supabase.rpc("shops_order_pickup_address", { p_order_id: orderId }));
  const r = rows?.[0];
  return r ? { line1: r.line1, line2: r.line2, city: r.city, state: r.state, postal_code: r.postal_code } : null;
}

/** H8 (b): where an at-home cleaning is done. The buyer reads their own; the shop only once it accepted (else null). */
export async function fetchOrderServiceAddress(orderId: string): Promise<{ line1: string; city: string; state: string; postal_code: string } | null> {
  const r = unwrap(await supabase.rpc("shops_order_service_address", { p_order_id: orderId })) as
    { line1?: string; city?: string; state?: string; postal_code?: string } | null;
  return r && typeof r.line1 === "string"
    ? { line1: r.line1, city: r.city ?? "", state: r.state ?? "LA", postal_code: r.postal_code ?? "" }
    : null;
}

/** Save (or change) the owner's pickup address. */
export async function saveMyPickupAddress(a: { line1: string; line2?: string | null; city: string; postal_code: string }): Promise<void> {
  const { error } = await supabase.rpc("shops_save_my_pickup_address", {
    p_line1: a.line1, p_line2: a.line2 ?? "", p_city: a.city, p_postal_code: a.postal_code,
  });
  // The RPC's own error, with its plain words (read here, at the call site) as
  // userMessage, which shopsErrorMessage shows.
  if (error) {
    const words = rpcErrorMessage("shops_save_my_pickup_address", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
}
