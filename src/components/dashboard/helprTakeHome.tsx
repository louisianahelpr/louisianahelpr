import { computeNet } from "@/components/dashboard/JobPrice";
import { helperShareCount, type HelperEarningsJob } from "@/lib/helperEarnings";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatPrice, formatPriceFloor } from "@/lib/format";
import type { FlatFeeStamp } from "@/lib/helprFlatFee";

type TakeHomeJob = HelperEarningsJob & FlatFeeStamp & {
  budget: number;
  urgent_fee?: number | null;
  status?: string | null;
};

/**
 * What the viewer would take home from this job — the SAME computation the job
 * page's "You take home" box runs (HelprMoney, src/pages/jobs/jobPage/JobPageParts.tsx):
 * computeNet over the job's fee stamp (5% + 70c on a flat-model job), the
 * viewer's tier rate for an older unstamped job, the group split
 * (helperShareCount), and the one-time setup fee from a first payout (never on
 * a disputed job, which settles by the split). Audit #62 (2026-10-21): the quick
 * view and the "Application sent" sheet showed "$103" beside "posted at $120"
 * from a different path; they now read this one.
 */
function useHelprTakeHome(job: TakeHomeJob): { net: number; helpers: number } {
  const firstPayoutFee = useFirstPayoutFeeDollars();
  const { profile } = useCurrentUser();
  const helpers = helperShareCount(job);
  const tierPct = tierFeePercent(profile?.subscription_tier, profile?.subscription_expires_at);
  const net = computeNet(job.budget, tierPct, job.urgent_fee ?? 0, helpers, job.status === "disputed" ? 0 : firstPayoutFee, job).netEarnings;
  return { net, helpers };
}

/** "Job price $120 · You take home $103" — both amounts rust (spec v2 §1.1). */
export function JobPriceTakeHome({ job, className = "" }: { job: TakeHomeJob; className?: string }) {
  const { net, helpers } = useHelprTakeHome(job);
  const money = "font-semibold tabular-nums text-[hsl(var(--accent-ink))]";
  return (
    <span data-job-price-take-home="" className={className}>
      Job price <span className={money}>${formatPrice(job.budget)}</span>
      {helpers > 1 ? ` for ${helpers} Helprs` : ""}
      {net > 0 && (
        <>
          {" · "}You take home <span className={money}>${formatPriceFloor(net)}</span>
        </>
      )}
    </span>
  );
}
