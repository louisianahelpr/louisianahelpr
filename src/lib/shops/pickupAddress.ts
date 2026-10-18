/**
 * The shop's private pickup address (Shops M1b part 2, migration
 * 20261018033224_shops_pickup_address; lead decision 2026-10-18; tax memo Q3:
 * a pickup sale is taxed where the buyer takes it).
 *
 * Never public: the shop's owner reads their own, and an order's buyer reads it
 * only once the maker accepted the order (the RPC returns no row before that).
 * A refused save throws the RPC's error with its words as userMessage.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "./rpcErrorCopy";

export interface PickupAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
}

/** Louisiana ZIP codes run 70001-71497; the server checks the same pattern. */
export const LOUISIANA_ZIP = /^7[01][0-9]{3}$/;

/** The owner's own shop's pickup address, or null when none is saved yet. */
export async function fetchMyPickupAddress(): Promise<PickupAddress | null> {
  const rows = unwrap(await supabase.rpc("shops_my_pickup_address"));
  const r = rows?.[0];
  return r ? { line1: r.line1, line2: r.line2, city: r.city, state: r.state, postal_code: r.postal_code } : null;
}

/** Where to pick up an order: null until the maker accepted it (or for anyone but its buyer and seller). */
export async function fetchOrderPickupAddress(orderId: string): Promise<PickupAddress | null> {
  const rows = unwrap(await supabase.rpc("shops_order_pickup_address", { p_order_id: orderId }));
  const r = rows?.[0];
  return r ? { line1: r.line1, line2: r.line2, city: r.city, state: r.state, postal_code: r.postal_code } : null;
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
