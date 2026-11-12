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

/** S045 (20261112091830): "lapsed" = the shop never answered (wanted date passed or 7 days). */
type CustomRequestStatus = "requested" | "quoted" | "declined" | "withdrawn" | "expired" | "accepted" | "lapsed";
/** One row of shops_my_custom_requests (the caller's asks as a buyer and as a shop owner). */
export interface CustomRequest {
  id: string;
  shop_id: string;
  shop_name: string | null;
  role: "buyer" | "shop";
  description: string;
  wanted_date: string | null;
  payment_plan: "full_hold" | "deposit_50";
  status: CustomRequestStatus;
  quote_cents: number | null;
  quote_note: string | null;
  quoted_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export async function fetchMyCustomRequests(): Promise<CustomRequest[]> {
  const { data, error } = await supabase.rpc("shops_my_custom_requests");
  if (error) {
    const words = rpcErrorMessage("shops_my_custom_requests", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
  return Array.isArray(data) ? (data as unknown as CustomRequest[]) : [];
}

/**
 * The shop's price (shops_quote_custom_request, 20261106205852): what is being made (a kind's type, never a rental)
 * and the same seller statements as listing that kind (lead 11-06, requiredStatements); the server refuses a price
 * without every one (attestation_incomplete). cents is $1 to $5,000; the note is optional (under 500 characters).
 */
export async function quoteCustomRequest(args: {
  requestId: string; cents: number; note: string; subtype: string; statements: string[];
}): Promise<void> {
  const { error } = await supabase.rpc("shops_quote_custom_request", {
    p_request_id: args.requestId, p_quote_cents: args.cents, p_note: args.note.trim() || null,
    p_subtype: args.subtype, p_statements: args.statements,
  });
  if (error) {
    const words = rpcErrorMessage("shops_quote_custom_request", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
}
