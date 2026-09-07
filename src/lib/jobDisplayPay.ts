// jobDisplayPay — the ONE number a browse/feed card shows a helper, exposed as
// a plain function so SORTING can order by the same figure the card RENDERS.
//
// Why this exists: "Highest pay" used to sort on `jobs.budget` while every card
// displayed `computeNet(...)` — the helper's take-home. On a solo job the net is
// a fixed percentage of the budget, so the two orders coincide and the bug is
// invisible. On a GROUP job they diverge outright: a $200 job with
// `helpers_needed = 3` pays $58 each, but sorted as $200 it ranked above a $79
// solo job. External QA, 2026-09-06: "Highest pay" returned
// $352, $58, $79, $74, $57, $35.
//
// The fee percent also varies by the VIEWER's membership tier, so "the pay" is
// not a property of the job alone — it is a property of (job, viewer). That is
// why `effectiveFee` is a required argument rather than a lookup: the caller
// already holds the viewer's rate (`platformFee` on the authed dashboard,
// `TIER_PERKS.free.platformFeePercent` on every guest surface) and passing it in
// keeps this pure and keeps the sorted order identical to the rendered order.
//
// This deliberately delegates to `computeNet` — the same function JobPrice,
// JobCard and CompactJobCard call — rather than reimplementing the arithmetic.
// A second copy of the formula is exactly how the two drifted apart.

import { computeNet } from "@/components/dashboard/JobPrice";

/**
 * The subset of a job row needed to reproduce the displayed take-home. Kept
 * structural so both the authed `EnrichedJob` and the guest `PublicJob` satisfy
 * it without casting.
 */
export interface DisplayPayJob {
  budget: number;
  urgent_fee?: number | null;
  is_group_job?: boolean | null;
  helpers_needed?: number | null;
}

/**
 * Roster size used for the per-helper split, matching `JobCard`'s rule exactly:
 * only a job flagged `is_group_job` WITH a truthy `helpers_needed` divides.
 * Anything else pays one helper.
 */
export function displayHelpersCount(job: DisplayPayJob): number {
  return job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
}

/**
 * The take-home figure the feed card shows this viewer for this job, in
 * dollars (unrounded — the card floors it for display, but sorting on the
 * unrounded value avoids ties that the eye can't explain).
 */
export function displayedPayDollars(job: DisplayPayJob, effectiveFee: number): number {
  return computeNet(
    job.budget,
    effectiveFee,
    job.urgent_fee ?? 0,
    displayHelpersCount(job),
  ).netEarnings;
}
