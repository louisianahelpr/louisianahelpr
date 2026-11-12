/**
 * Owner 11-12 1:00 AM: a Declutter seller's ID check is asked before their FIRST PAYOUT, not at listing. The server
 * holds the payout (declutter-money: checkIdentityHold asks payout_waits_on_identity before every transfer); this read only says how much
 * waits on it, for Home's to-do and the Selling prompt. Loaded lazily (Home asks it only for a member with a paid
 * sale). An unreadable answer is 0: no prompt, and the server still holds the money.
 */
import { supabase } from "@/integrations/supabase/client";
import { needsIdentityCheck } from "@/lib/identityCheck";
import { fetchMyPayouts, type MyPayout } from "@/lib/declutter/payoutReads";

/** The cents a seller's unsent payouts hold (pending or failed): what the ID check stands between them and. */
export function payoutCentsWaiting(payouts: readonly Pick<MyPayout, "status" | "amount_cents">[]): number {
  return payouts.reduce((sum, p) => sum + (p.status === "pending" || p.status === "failed" ? Math.max(0, p.amount_cents) : 0), 0);
}

/** How much of this seller's money waits on their ID check: 0 when verified, exempt, or nothing is owed. */
export async function fetchIdPayoutWaitCents(userId: string): Promise<number> {
  const { data, error } = await supabase.from("profiles").select("idv_status, is_seed").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!needsIdentityCheck(data)) return 0;
  return payoutCentsWaiting(await fetchMyPayouts(userId));
}
