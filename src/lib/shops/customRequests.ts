/**
 * Shops custom orders (20261106202917 + 20261106205852): a buyer asks a shop for something made to order; the shop
 * answers with a price; the buyer orders it like any other order (shop-checkout 'order' with custom_request_id).
 * Every rule is in SQL (src/test/pglite/shopsCustomRequests.pglite.mjs); this only calls it and words its refusals.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "./rpcErrorCopy";

/** The longest description the shop reads (shops_send_custom_request: 1 to 1,000 characters). */
export const CUSTOM_REQUEST_MAX = 1000;

/** The buyer asks. wantedDate is optional (tomorrow to 6 months out, Chicago days; the server checks). */
export async function sendCustomRequest(shopId: string, description: string, wantedDate: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("shops_send_custom_request", {
    p_shop_id: shopId, p_description: description.trim(), p_wanted_date: wantedDate || null,
  });
  if (error) {
    const words = rpcErrorMessage("shops_send_custom_request", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
  if (typeof data !== "string" || !data) throw new Error("request_not_sent");
  return data;
}
