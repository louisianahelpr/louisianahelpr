import type { User as SupaUser } from "@supabase/supabase-js";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useProfileEarnings } from "@/hooks/useProfileTabData";
import { useFirstPayoutFeeDollars, useFirstPayoutFeeKnown } from "@/hooks/useFirstPayoutFee";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { comingToYou } from "@/components/profile/earningsTab/earningsTabHelpers";
import { usePosterSpendData } from "@/components/profile/earningsTab/usePosterSpendData";
import { heldForYou, spentRows } from "@/lib/posterSpend";

export interface HomeMoney {
  /**
   * Approved Helpr take-home not sent yet (comingToYou: the soonest wallet date still AHEAD, whether a
   * row is past its date, whether they arrive on several days), and whether the member has a payout
   * account to receive it; null = no tile.
   */
  coming: { cents: number; at: string | null; overdue: boolean; severalDates: boolean; hasPayoutAccount: boolean } | null;
  /** What the member's card paid for hired jobs that wait on THEIR confirm; null = no tile. */
  held: { cents: number; jobs: number } | null;
}

/**
 * HOME'S MONEY STRIP (spec v2 §5.3, boards 7 and 11), from the SAME reads and
 * the SAME rules as the Money tab, never a second copy:
 *  - Coming to you = earningsTabHelpers.comingToYou over useProfileEarnings
 *    (the Money tab's own read and cache key), with the viewer's fee fallback
 *    and one-time setup fee exactly as EarningsTab passes them.
 *  - Held for you = posterSpend.heldForYou over spentRows() of
 *    usePosterSpendData (the Spent half's own read and key): the card charge
 *    less refunds and gift-card cover.
 * A tile is null (hidden) while its read is loading, when it failed (a failed
 * read is not $0) and at $0 (spec §5.3: "Hide either number when it is $0").
 */
export function useHomeMoney(user: SupaUser | null): HomeMoney {
  const uid = user?.id;
  const { profile } = useCurrentUser();
  const earnings = useProfileEarnings(uid, !!uid);
  const firstPayoutFee = useFirstPayoutFeeDollars();
  const feeKnown = useFirstPayoutFeeKnown();
  const spend = usePosterSpendData(uid);

  let coming: HomeMoney["coming"] = null;
  if (profile && feeKnown && earnings.data && !earnings.isError) {
    const pct = tierFeePercent(profile.subscription_tier ?? "free", profile.subscription_expires_at ?? null);
    const c = comingToYou(earnings.data.jobs, pct, firstPayoutFee);
    // No payout account: the cron leaves the money payout_pending and asks for one (process-scheduled-payouts).
    if (c.cents > 0) coming = { ...c, hasPayoutAccount: !!profile.stripe_account_id };
  }

  let held: HomeMoney["held"] = null;
  if (spend.data && !spend.isError) {
    const h = heldForYou(spentRows(spend.data.jobs, spend.data.refunds, spend.data.gifts, spend.data.tips, spend.data.blockFees));
    if (h.cents > 0) held = h;
  }
  return { coming, held };
}
