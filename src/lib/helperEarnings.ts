// helperEarnings — the ONE definition of "what did a helper actually take home
// from this job", so every surface that shows a helper their money agrees.
//
// The math mirrors the authoritative payout in the `release-payout` edge
// function: a helper nets `budget − platform fee + net urgent bonus`, divided
// across the roster on a group job. Three details are load-bearing and were each
// the source of real drift:
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
//  3. GROUP JOBS PAY PER HELPER. The poster is charged the budget ONCE and the
//     roster is `helpers_needed` strong, so each member is transferred
//     `budget / N` (plus their 1/N slice of the urgent bonus) — see
//     `release-payout/index.ts` (`perHelperBudget = budget / helpersCount`).
//     A surface that shows the FULL budget on a group job overstates what the
//     helper is actually paid by N×, which is why the split is unconditional
//     here rather than an opt-in.
//
// The urgent bonus passes through to the helper WHOLE (`netUrgentFeeDollars`;
// Q362: the poster pays its card fee on top), so the figure shown equals the
// amount the edge transfers.
//
// Callers supply `feeFallbackPercent` themselves — it is the helper's
// tier-derived rate from `tierFeePercent(subscription_tier,
// subscription_expires_at)` (src/lib/subscriptionTiers.ts). It is passed in
// rather than looked up here so this module stays pure and synchronous.
//
// ONE SUBTLETY THE GROUP SPLIT HAS TO WORK AROUND: `jobs.platform_fee_amount`
// has AMBIGUOUS SCOPE on a group row. `release-payout` and
// `process-scheduled-payouts` stamp the PER-HELPER fee (`perHelperBudget × pct`),
// while `create-payment` stamps the WHOLE-JOB fee at escrow time and again on
// the dispute-resolution path (`budget × pct`, divided by the roster only when
// computing the transfer). Reading the column verbatim would therefore under- or
// over-deduct by N× depending on which path last wrote it. All of those paths do
// agree on the effective per-helper deduction — `perHelperBudget ×
// helper_fee_percent` — and all of them stamp `helper_fee_percent` alongside the
// amount, so on a genuine group row (N > 1) the frozen PERCENT is the authority
// and the stamped amount is consulted only when the job resolves to a single
// helper (which is every non-group job).

import { netUrgentFeeDollars } from "@/lib/stripeFees";
import { netAfterFirstPayoutFee, sumAfterFirstPayoutFee } from "@/lib/firstPayoutFee";

/**
 * The subset of a `jobs` row needed to compute helper take-home. Kept
 * structural (not the generated Row type) so callers can pass a narrow
 * `select(...)` result without casting.
 *
 * `is_group_job` / `helpers_needed` are optional only so a caller may omit them
 * for a query that cannot return a group job at all. Any query that CAN return
 * one must select them, or the roster split silently won't apply.
 */
export interface HelperEarningsJob {
  budget: number | null;
  /** Exact fee stamped by the payout path. Wins on a single-helper job. */
  platform_fee_amount?: number | null;
  /** Commission % frozen on the job row when it was posted. */
  helper_fee_percent?: number | null;
  /** Poster-paid urgent bonus, gross (dollars). */
  urgent_fee?: number | null;
  /** Whether the budget is shared by a roster rather than paid to one helper. */
  is_group_job?: boolean | null;
  /** Roster size on a group job. Null/0/absent all resolve to a single helper. */
  helpers_needed?: number | null;
  /**
   * `jobs.payment_status`. Supply it on any surface that can show a job which
   * has NOT been paid out yet — see {@link isSettledForDisplay}. Omitting it
   * asserts "every row I pass has already been paid out", which is true for
   * the completed-jobs history surfaces and false for anything live.
   */
  payment_status?: string | null;
  /**
   * `jobs.status`. Q1272 (3): a DISPUTED job is settled by the dispute split
   * or Quick Release, which never take the one-time setup fee, so its preview
   * does not take it either.
   */
  status?: string | null;
}

/**
 * Is this row's stamped fee a RECORD OF WHAT WAS PAID, or just escrow-time
 * bookkeeping?
 *
 * `create-payment` stamps `helper_fee_percent` / `platform_fee_amount` from
 * the GLOBAL `platform_settings.helper_fee_percent` at ESCROW time — before
 * any helper is assigned, so it cannot encode a specific helper's tier. Every
 * path that actually moves money (`release-payout`,
 * `process-scheduled-payouts`, the dispute split in `create-payment`) then
 * re-resolves the helper's LIVE tier via `getHelperFeePercent` and RE-STAMPS
 * both columns on the way out — but only on release.
 *
 * So the stamp is authoritative exactly once `payment_status === "released"`.
 * Before that it is the global rate (10 in prod) applied to a helper who may
 * owe 12 or 8 — which is how an Elite helper's $120 job showed "$108" on their
 * own card while Stripe transferred $110.40, and how a FREE helper is shown
 * $108 against a real $105.60: a displayed take-home HIGHER than the payout,
 * the one thing `JobPrice.tsx` says must never happen.
 *
 * A caller that does not supply `payment_status` opts out (undefined ⇒ treated
 * as settled), preserving the historical earnings surfaces that only ever
 * query completed/released rows.
 */
export function isSettledForDisplay(job: HelperEarningsJob): boolean {
  if (job.payment_status === undefined) return true;
  return job.payment_status === "released";
}

/**
 * The commission percent to SHOW for this job: the stamped per-job rate once
 * the job is settled, otherwise the helper's live tier rate — the same rate
 * `getHelperFeePercent` will resolve when the payout actually runs.
 */
export function helperDisplayFeePercent(
  job: HelperEarningsJob,
  feeFallbackPercent: number,
): number {
  if (!isSettledForDisplay(job)) return feeFallbackPercent;
  return job.helper_fee_percent ?? feeFallbackPercent;
}

/**
 * How many helpers this job's money is divided across: `helpers_needed` on a
 * group job, otherwise 1. Guards null/0/negative — a bad roster value must
 * degrade to "pay one helper", never to a divide-by-zero (`Infinity`) or a
 * sign-flipped payout.
 */
export function helperShareCount(job: HelperEarningsJob): number {
  if (!job.is_group_job) return 1;
  const needed = job.helpers_needed ?? 0;
  return needed > 1 ? needed : 1;
}

/**
 * The platform fee (dollars) charged against ONE helper's share of this job,
 * resolved in order of authority: stamped amount → per-job frozen percent → the
 * helper's tier rate (legacy rows only).
 *
 * On a group row (roster > 1) the stamped amount is deliberately skipped — its
 * scope varies by which payout path wrote it — and the frozen percent is applied
 * to the per-helper budget instead. See the note at the top of this file.
 */
export function helperPlatformFeeDollars(
  job: HelperEarningsJob,
  feeFallbackPercent: number,
): number {
  const shares = helperShareCount(job);
  const perHelperBudget = (job.budget ?? 0) / shares;
  const derived =
    (perHelperBudget * helperDisplayFeePercent(job, feeFallbackPercent)) / 100;
  if (shares !== 1) return derived;
  // An UNSETTLED row's stamped amount is escrow-time bookkeeping off the global
  // rate, not this helper's fee — see isSettledForDisplay. Only a released row's
  // stamp is the record of what the payout actually deducted.
  if (!isSettledForDisplay(job)) return derived;
  return job.platform_fee_amount ?? derived;
}

/**
 * What the helper took home on one completed job, in WHOLE dollars:
 * `budget/N − platform fee + net urgent bonus/N`, where N is the roster size
 * (1 for every non-group job), floored to the dollar the transfer actually
 * pays (see {@link floorPayoutDollars}).
 *
 * `firstPayoutFeeDollars` (Q753) is the one-time setup fee still to come out of
 * this viewer's first payout; pass it ONLY for a payout that has not happened
 * yet. It comes off before the floor, as the edge does.
 */
export function helperTakeHomeDollars(
  job: HelperEarningsJob,
  feeFallbackPercent: number,
  firstPayoutFeeDollars = 0,
): number {
  const shares = helperShareCount(job);
  const budget = job.budget ?? 0;
  // Q1272 (3): the dispute split and Quick Release never take the setup fee.
  const feeHere = job.status === "disputed" ? 0 : firstPayoutFeeDollars;
  return floorPayoutDollars(
    netAfterFirstPayoutFee(
      budget / shares -
        helperPlatformFeeDollars(job, feeFallbackPercent) +
        netUrgentFeeDollars(job.urgent_fee) / shares,
      feeHere,
    ),
  );
}

/**
 * Q236 (owner, 2026-09-27): a Helpr payout is REALLY a whole dollar, rounded
 * DOWN — every payout transfer goes through `roundPayoutDownCents`
 * (supabase/functions/_shared/money.ts) and the platform keeps the cents. So
 * the take-home shown is the floored figure too, or a $41.87 job would read
 * $41.87 against a $41 transfer. Same arithmetic as the edge rule: round to a
 * whole cent first (float noise must not cost a dollar), then floor; zero and
 * negative pass through unchanged. Guarded by
 * src/test/helprPayoutRoundedDown.test.ts.
 */
export function floorPayoutDollars(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  const cents = Math.round(dollars * 100);
  if (cents <= 0) return cents / 100;
  return Math.floor(cents / 100);
}

/**
 * Sum of {@link helperTakeHomeDollars} across a list of completed jobs. The
 * one-time fee (Q753) comes off the list ONCE, not per job.
 */
export function sumHelperTakeHomeDollars(
  jobs: readonly HelperEarningsJob[],
  feeFallbackPercent: number,
  firstPayoutFeeDollars = 0,
): number {
  return sumAfterFirstPayoutFee(
    jobs.map((j) => helperTakeHomeDollars(j, feeFallbackPercent)),
    firstPayoutFeeDollars,
  );
}

/**
 * What a Helpr received from a set of tips, in dollars: the tip amounts
 * themselves. ME-006 (owner, 2026-09-25): the poster pays the card-processing
 * fee ON TOP of a tip (`tipChargeBreakdown`, supabase/functions/_shared/tipFees.ts),
 * so the Helpr's transfer is exactly `tips.amount`. Subtracting a card fee here
 * would tell the Helpr they got less than the Terms promise and less than landed.
 */
export function sumHelperTipDollars(rows: readonly { amount: number }[]): number {
  return rows.reduce((sum, t) => sum + (Number.isFinite(t.amount) ? t.amount : 0), 0);
}
