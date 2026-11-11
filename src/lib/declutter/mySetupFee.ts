/**
 * Owner 11-11 ~3:25 PM: the seller's one-time setup fee and the one sale it comes out of, from the server
 * (declutter_my_setup_fee, 20261111212343). Its own module, so a test that mocks the Declutter api keeps working.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";

/** The one-time setup fee the server will take, and the ONE sale it comes out of (declutter_my_setup_fee). */
export interface MySetupFee {
  feeCents: number;
  /** The sale whose payout loses it (its unsent payout row, or the sale still to hand over that was paid first); null: none. */
  orderId: string | null;
}

/**
 * Owner 11-11 ~3:25 PM: the setup fee comes out of the FIRST payout actually sent, and every seller card shows it on
 * that sale only. declutter_my_setup_fee (20261111212343) answers from the send's own rules (fee, exemption, switch,
 * which row the payout run reaches first). Null before the function is deployed: the caller then falls back to the
 * client's own reading.
 */
export async function fetchMySetupFee(): Promise<MySetupFee | null> {
  const res = await supabase.rpc("declutter_my_setup_fee");
  if (res.error && isMissingRpcNamed(res.error, "declutter_my_setup_fee")) return null;
  const raw = (unwrap(res) ?? {}) as { fee_cents?: number | string | null; order_id?: string | null };
  const fee = Number(raw.fee_cents ?? 0);
  // A figure the client cannot read is not "no fee": thrown, so the card shows no figure (the query errors).
  if (!Number.isFinite(fee) || fee < 0) throw new Error("setup fee answer unreadable");
  return { feeCents: Math.round(fee), orderId: fee > 0 && typeof raw.order_id === "string" ? raw.order_id : null };
}
