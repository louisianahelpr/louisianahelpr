// helperEarnings — the ONE definition of "what did a helper actually take home
// from this job", so every surface that shows a helper their money agrees.
//
// The math mirrors the authoritative payout in the `release-payout` edge
// function: a helper nets `budget − platform fee + net urgent bonus`. Two
// details are load-bearing and were the source of real drift:
//
//  1. PER-JOB fee resolution, not "the helper's fee % today". A job's
//     commission is frozen at post/payout time (`jobs.platform_fee_amount`,
//     falling back to `jobs.helper_fee_percent`). Applying the helper's
//     CURRENT subscription tier to years of history restates what they were
//     actually paid — a helper who upgraded to Elite last week would see every
//     2025 job recomputed at 8%. The tier rate is the LAST resort, used only
//     for legacy/seed rows that predate both columns.
//  2. `??`, not `||`. A genuinely-stamped $0 fee (a comped / promo job) is
//     real and must be trusted verbatim, not mistaken for an unstamped row.
//
// The urgent bonus passes through to the helper net of its own bundled Stripe
// processing cost (`netUrgentFeeDollars`), so the figure shown equals the
// amount the edge transfers.
//
// Callers supply `feeFallbackPercent` themselves — it is the helper's
// tier-derived rate from `tierFeePercent(subscription_tier,
// subscription_expires_at)` (src/lib/subscriptionTiers.ts). It is passed in
// rather than looked up here so this module stays pure and synchronous.
//
// NOTE ON GROUP JOBS: this helper deliberately treats `budget` as the amount
// attributable to the caller's helper row, matching the /profile and /wrapped
// behaviour it was extracted from. Surfaces that split a group job's budget
// across `helpers_needed` (EarningsTab, ProfileStatsTrend, admin analytics)
// have their own per-helper division and are NOT wired to this module yet.

import { netUrgentFeeDollars } from "@/lib/stripeFees";

/**
 * The subset of a `jobs` row needed to compute helper take-home. Kept
 * structural (not the generated Row type) so callers can pass a narrow
 * `select(...)` result without casting.
 */
export interface HelperEarningsJob {
  budget: number | null;
  /** Exact fee stamped by the payout path. Wins over every derivation. */
  platform_fee_amount?: number | null;
  /** Commission % frozen on the job row when it was posted. */
  helper_fee_percent?: number | null;
  /** Poster-paid urgent bonus, gross (dollars). */
  urgent_fee?: number | null;
}

/**
 * The platform fee (dollars) charged against this job's budget, resolved in
 * order of authority: stamped amount → per-job frozen percent → the helper's
 * tier rate (legacy rows only).
 */
export function helperPlatformFeeDollars(
  job: HelperEarningsJob,
  feeFallbackPercent: number,
): number {
  const budget = job.budget ?? 0;
  return (
    job.platform_fee_amount ??
    (budget * (job.helper_fee_percent ?? feeFallbackPercent)) / 100
  );
}

/**
 * What the helper took home on one completed job, in dollars:
 * `budget − platform fee + net urgent bonus`.
 */
export function helperTakeHomeDollars(
  job: HelperEarningsJob,
  feeFallbackPercent: number,
): number {
  const budget = job.budget ?? 0;
  return (
    budget -
    helperPlatformFeeDollars(job, feeFallbackPercent) +
    netUrgentFeeDollars(job.urgent_fee)
  );
}

/** Sum of {@link helperTakeHomeDollars} across a list of completed jobs. */
export function sumHelperTakeHomeDollars(
  jobs: readonly HelperEarningsJob[],
  feeFallbackPercent: number,
): number {
  return jobs.reduce((sum, j) => sum + helperTakeHomeDollars(j, feeFallbackPercent), 0);
}
