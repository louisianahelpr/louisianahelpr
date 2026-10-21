import type { User as SupaUser } from "@supabase/supabase-js";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useProfileEarnings } from "@/hooks/useProfileTabData";
import { useFirstPayoutFeeDollars, useFirstPayoutFeeKnown } from "@/hooks/useFirstPayoutFee";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { comingToYou } from "@/components/profile/earningsTab/earningsTabHelpers";
import { usePosterSpendData } from "@/components/profile/earningsTab/usePosterSpendData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatName } from "@/lib/utils";
import { heldForYou, heldRows, spentRows } from "@/lib/posterSpend";

export interface HomeMoney {
  /**
   * Approved Helpr take-home not sent yet (comingToYou: the soonest wallet date still AHEAD, whether a
   * row is past its date, whether they arrive on several days), and whether the member has a payout
   * account to receive it; null = no tile.
   */
  coming: { cents: number; at: string | null; overdue: boolean; severalDates: boolean; hasPayoutAccount: boolean } | null;
  /**
   * What the member's card paid for hired jobs that wait on THEIR confirm; null = no tile. It is the
   * poster's OWN payment held for the Helpr, never money held for the poster (owner, 2026-10-21), so with
   * one such job the tile names it and who it is paid to ("First L.", null until the name is read).
   */
  held: { cents: number; jobs: number; only: { title: string; helper: string | null } | null } | null;
}

/**
 * HOME'S MONEY STRIP (spec v2 §5.3, boards 7 and 11), from the SAME reads and
 * the SAME rules as the Money tab, never a second copy:
 *  - Coming to you = earningsTabHelpers.comingToYou over useProfileEarnings
 *    (the Money tab's own read and cache key), with the viewer's fee fallback
 *    and one-time setup fee exactly as EarningsTab passes them.
 *  - Held = posterSpend.heldForYou over spentRows() of
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
  let onlyJob: { title: string | null; helper_id?: string | null } | null = null;
  if (spend.data && !spend.isError) {
    const rows = spentRows(spend.data.jobs, spend.data.refunds, spend.data.gifts, spend.data.tips, spend.data.blockFees);
    const h = heldForYou(rows);
    const list = heldRows(rows);
    onlyJob = list.length === 1 ? list[0].job : null;
    if (h.cents > 0) held = { ...h, only: null };
  }
  const helperId = onlyJob?.helper_id ?? null;
  const helperName = useQuery({
    queryKey: ["home-money", "held-helper", helperId],
    enabled: !!helperId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc("get_safe_profiles", { user_ids: [helperId!] })) as { user_id: string; full_name: string | null }[] | null;
      const r = rows?.find((p) => p.user_id === helperId);
      return r?.full_name ? formatName(r.full_name) : null;
    },
  });
  if (held && onlyJob?.title) held = { ...held, only: { title: onlyJob.title, helper: helperName.data ?? null } };
  return { coming, held };
}
