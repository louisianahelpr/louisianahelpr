/**
 * The member's own Shops strikes (Q2110, 20261111011855_shops_my_strikes): active ones only (not removed, not ended),
 * soonest to end first. The table itself stays closed; shops_my_strikes() is the only read.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

export interface MyShopStrike {
  id: string;
  offender_side: "buyer" | "shop";
  reason: string;
  given_at: string;
  expires_at: string;
}

/** Shops pauses a member at this many active strikes (shop_active_strike_count(...) < 3 in every Shops gate). */
export const SHOP_STRIKE_LIMIT = 3;

export async function fetchMyShopStrikes(): Promise<MyShopStrike[]> {
  return (unwrap(await supabase.rpc("shops_my_strikes")) ?? []) as MyShopStrike[];
}

/** Plain words for each reason shop_give_strike / shops_admin_give_strike writes; anything new reads generically. */
const REASON_WORDS: Record<string, string> = {
  buyer_cancelled_late: "You cancelled an order too late",
  buyer_no_show: "You didn't pick up an order",
  shop_cancelled: "Your shop cancelled an accepted order",
  no_ready_photo: "Your shop didn't send the ready photo in time",
  problem_shop_fault: "A problem with an order was your shop's fault",
  admin_strike: "Given by Louisiana Helpr support",
};

export function shopStrikeReasonWords(reason: string): string {
  return REASON_WORDS[reason] ?? "A Shops order problem";
}
