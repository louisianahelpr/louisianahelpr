import { computeNet } from "@/components/dashboard/JobPrice";
import { helperShareCount, type HelperEarningsJob } from "@/lib/helperEarnings";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatPriceFloor } from "@/lib/format";
import { type FlatFeeStamp, isGiveawayFixedPayJob } from "@/lib/helprFlatFee";

export type TakeHomeJob = HelperEarningsJob & FlatFeeStamp & {
  budget: number;
  urgent_fee?: number | null;
  status?: string | null;
};

/**
 * What the viewer would take home from this job — the SAME computation the job
 * page's "You take home" box runs (useHelprMoney, src/pages/jobs/jobPage/JobPageParts.tsx):
 * computeNet over the job's fee stamp (5% + 70c on a flat-model job), the
 * viewer's tier rate for an older unstamped job, the group split
 * (helperShareCount), and the one-time setup fee from a first payout (never on
 * a disputed job, which settles by the split). Audit #62 (2026-10-21): the quick
 * view and the "Application sent" sheet showed "$103" beside "posted at $120"
 * from a different path; they now read this one. The chat's pinned job card
 * (DealCard) reads it too (audit 2026-10-28 F2: it showed the Helpr "$40 held
 * safely" while every other Helpr screen showed $33).
 */
export function useHelprTakeHome(job: TakeHomeJob): { net: number; helpers: number } {
  const firstPayoutFee = useFirstPayoutFeeDollars();
  const { profile } = useCurrentUser();
  const helpers = helperShareCount(job);
  const tierPct = tierFeePercent(profile?.subscription_tier, profile?.subscription_expires_at);
  const net = computeNet(job.budget, tierPct, job.urgent_fee ?? 0, helpers, job.status === "disputed" ? 0 : firstPayoutFee, job).netEarnings;
  return { net, helpers };
}

/**
 * "You take home $103" (rust). Never the job price beside it (owner 2026-10-25,
 * job sheet screenshot: "this should never show job price. only what they take
 * home"): a Helpr sees one figure, theirs. Guard: src/test/takeHomeOnlyNoJobPrice.test.ts.
 */
export function JobPriceTakeHome({ job, className = "", after = "", fallback = null, bare = false }: {
  job: TakeHomeJob;
  /**
   * The figure alone, large (owner 2026-10-28, job sheet: "remove you take home. it should also be more
   * prominent so they can see it"). The words stay for a screen reader.
   */
  bare?: boolean;
  className?: string;
  /** Words after the figure ("…, paid once it's confirmed done"). */
  after?: string;
  /** What shows when there is no figure to give. */
  fallback?: string | null;
}) {
  const { net } = useHelprTakeHome(job);
  if (!(net > 0)) return fallback ? <>{fallback}</> : null;
  // Owner 2026-10-30: the giveaway shows its $50 with no words.
  const fixedPay = isGiveawayFixedPayJob(job);
  if (bare) {
    return (
      <span data-job-price-take-home="" className={`font-display text-ds-28 font-bold leading-none tabular-nums text-[hsl(var(--accent-ink))] ${className}`}>
        {!fixedPay && <span className="sr-only">You take home </span>}${formatPriceFloor(net)}
      </span>
    );
  }
  return (
    <span data-job-price-take-home="" className={className}>
      {!fixedPay && "You take home "}<span className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">${formatPriceFloor(net)}</span>
      {after}
    </span>
  );
}
