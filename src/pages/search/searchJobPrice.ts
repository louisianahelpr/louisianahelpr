import { computeNet } from "@/components/dashboard/JobPrice";
import { formatPrice, formatPriceFloor } from "@/lib/format";
import type { FlatFeeStamp } from "@/lib/helprFlatFee";

/** The columns a Search job hit needs to be priced like the Jobs browse card. */
export type PricedJobHit = FlatFeeStamp & {
  budget: number | null;
  pricing_mode: string | null;
  urgent_fee: number | null;
  is_group_job: boolean | null;
  helpers_needed: number | null;
  customer_id: string | null;
};

/**
 * Q2642 (account audit 1102d row 1): Search printed a job's raw budget ($120)
 * while the Jobs browse card a tap away printed the viewer's take-home ($113).
 * This is the browse card's own rule (JobCard + JobPrice "chip"): the poster's
 * own job shows the budget they set; anyone else sees the take-home from the
 * shared computeNet (per-Helpr share, the job's fee stamp or the viewer's tier
 * rate, the urgent bonus, less the one-time setup fee still owed), floored to
 * whole dollars. A quote job says "Quote"; no budget, no price.
 */
export function searchJobPrice(
  job: PricedJobHit,
  viewerId: string | null,
  effectiveFee: number,
  firstPayoutFeeDollars: number,
): string | null {
  if (job.pricing_mode === "quote") return "Quote";
  if (typeof job.budget !== "number" || job.budget <= 0) return null;
  if (viewerId && job.customer_id === viewerId) return `$${formatPrice(job.budget)}`;
  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const { netEarnings } = computeNet(job.budget, effectiveFee, job.urgent_fee ?? 0, helpers, firstPayoutFeeDollars, job);
  return `$${formatPriceFloor(netEarnings)}`;
}
