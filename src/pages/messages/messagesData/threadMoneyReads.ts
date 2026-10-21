import { supabase } from "@/integrations/supabase/client";

/**
 * Board 181: the money a job thread shows beside its messages. Kept out of
 * useMessagesData so that file reads MESSAGES only through threadRows
 * (teamThreadStaysOffJobPaths); a team thread has no job, so neither read runs.
 */
export function readJobTips(jobId: string) {
  // tips RLS: the tipper and the tipped Helpr. Paid only.
  return supabase.from("tips").select("id, amount, created_at, tipper_id, helper_id").eq("job_id", jobId).eq("payment_status", "paid");
}

/** A gift card on the job means the card charge is not the price: no receipt. */
export function readJobGiftCards(jobId: string) {
  return supabase.from("gift_cards").select("id").eq("job_id", jobId).limit(1);
}
