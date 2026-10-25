import type { EnrichedJob } from "@/components/dashboard/types";
import { netUrgentFeeDollars } from "@/lib/stripeFees";
import { useFirstPayoutFeeCents } from "@/hooks/useFirstPayoutFee";
import { floorPayoutDollars } from "@/lib/helperEarnings";
import { netAfterFirstPayoutFee } from "@/lib/firstPayoutFee";
import { helprFlatFeeCents, helprPaysNoFee, isFlatFeeJob } from "@/lib/helprFlatFee";

/**
 * The Helpr's take-home on a job they apply to: the ONE copy of the maths, read by the apply
 * sheet's receipt (ApplyEarningsBreakdown) and the "What next" sheet after applying (board 77).
 * Moved here unchanged from ApplyEarningsBreakdown.
 */
export function useApplyTakeHome(confirmApplyJob: EnrichedJob, platformFee: number) {
  const helpers = confirmApplyJob.is_group_job && confirmApplyJob.helpers_needed ? confirmApplyJob.helpers_needed : 1;
  const perHelper = confirmApplyJob.budget / helpers;
  // Urgent bonus nets its own bundled Stripe processing cost, then splits across
  // the roster like the budget (#114), so the "+ urgent bonus" line and the
  // Take-home total both equal what the edge transfers to each helper.
  const netUrgent = netUrgentFeeDollars(confirmApplyJob.urgent_fee) / helpers;
  // Q1839: a flat-model job (jobs.helper_fee_flat_cents stamped, roadmap F3)
  // charges 5% + 70c on the Helpr's share of budget + urgent bonus, as every
  // payout path does (helprFlatFeeCents); the viewer's tier never applies.
  const flat = isFlatFeeJob(confirmApplyJob);
  const commission = flat
    ? helprFlatFeeCents(Math.round(perHelper * 100) + Math.round(netUrgent * 100), confirmApplyJob) / 100
    : perHelper * platformFee / 100;
  // Poster-fee model (owner 2026-10-18): the Helpr pays no fee, so no fee
  // line and no "0% + $0.00" label (lh-money-escrow review #4).
  const noFee = helprPaysNoFee(confirmApplyJob);
  const beforeFirstPayoutFee = perHelper - commission + netUrgent;
  // ME-008: an account whose `onboarding_fee_paid` is not true loses the
  // one-time setup fee from its FIRST payout (release-payout /
  // process-scheduled-payouts). The take-home shown here must not read higher
  // than what lands, so it comes off the total and gets its own line.
  const firstPayoutFee = useFirstPayoutFeeCents() / 100;
  const payout = netAfterFirstPayoutFee(beforeFirstPayoutFee, firstPayoutFee);
  // Q236: the transfer pays WHOLE dollars, rounded DOWN (the platform keeps
  // the cents). The receipt shows the dropped cents as their own line so the
  // exact-cent rows above still add up to the take-home below.
  const takeHome = floorPayoutDollars(payout);
  const droppedCents = payout > 0 ? Math.round((payout - takeHome) * 100) / 100 : 0;
  const hasUrgent = (confirmApplyJob.urgent_fee ?? 0) > 0;
  return { helpers, perHelper, netUrgent, flat, commission, noFee, firstPayoutFee, payout, takeHome, droppedCents, hasUrgent };
}
