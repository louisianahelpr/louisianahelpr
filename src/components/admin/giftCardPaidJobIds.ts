import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";

/**
 * Q443: the jobs a redeemed, paid gift card paid — the one captured payment
 * with no job PaymentIntent (see src/lib/capturedPayment.ts). Admins cannot read
 * gift_cards, so admin_gift_card_paid_job_ids() answers (SECURITY DEFINER,
 * admin-only, 20261003050100).
 *
 * Returns the read's error beside the ids instead of throwing, like the
 * `{ data, error }` results the admin money loaders already collect: a failed
 * read must surface as a load error, never as "no gift-card payments".
 * "Not deployed yet" (PGRST202 naming no admin_gift_card_paid_job_ids with other
 * arguments, Q2190: the web deploy can land before db-deploy) is not an error: payments then count by job PI only, as before
 * Q443, instead of every money tile failing.
 */
export async function loadGiftCardPaidJobIds(): Promise<{ ids: Set<string>; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc("admin_gift_card_paid_job_ids");
  if (error) return { ids: new Set(), error: isMissingRpcNamed(error, "admin_gift_card_paid_job_ids") ? null : error };
  return { ids: new Set((data ?? []).map((row) => row.job_id)), error: null };
}
