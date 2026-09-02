// Helper take-home math — the EDGE copy of src/lib/helperEarnings.ts.
//
// Duplicated for the usual reason (the client cannot import Deno modules and
// the edge bundle cannot reach into src/), and guarded like every other
// duplicated money module: src/lib/r18Guards.parity.test.ts asserts the two
// sides agree on the cases that distinguish them, so a change to one that is
// not mirrored fails the build rather than paying someone the wrong amount.
//
// Why this exists at all: weekly-helper-report summed the FULL budget and the
// FULL urgent fee with no roster split, so a helper on a 3-person group job
// was emailed 3× what they were actually transferred.
import { netUrgentFeeDollars } from "./stripeFees.ts";

export interface HelperEarningsJob {
  budget?: number | null;
  platform_fee_amount?: number | null;
  helper_fee_percent?: number | null;
  urgent_fee?: number | null;
  is_group_job?: boolean | null;
  helpers_needed?: number | null;
  /**
   * `jobs.payment_status`. Supply it on any surface that can show a job which
   * has NOT been paid out yet — see {@link isSettledForDisplay}. Omitting it
   * asserts "every row I pass has already been paid out", which is true for
   * the completed-jobs history surfaces and false for anything live.
   */
  payment_status?: string | null;
}

/**
 * Is this row's stamped fee a RECORD OF WHAT WAS PAID, or just escrow-time
 * bookkeeping? Ported verbatim from the client twin (src/lib/helperEarnings.ts)
 * — two modules that disagree about when a figure is trustworthy is exactly how
 * the drift this guards against started.
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
 * Before that it is the global rate applied to a helper who may owe 12 or 8.
 * On the edge side that mattered for `weekly-helper-report`, which filters on
 * `status = 'completed'` but NOT `payment_status = 'released'`: a job sitting
 * in the 24-hour payout window was emailed to the helper at the escrow-time
 * global stamp, so an Elite helper (8%) got an email understating their pay and
 * a free-tier helper (12%) got one overstating it. No money moved — but it is
 * an email telling someone the wrong number about their own pay.
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
 * degrade to "pay one helper", never to a divide-by-zero or a sign flip.
 */
export function helperShareCount(job: HelperEarningsJob): number {
  if (!job.is_group_job) return 1;
  const needed = job.helpers_needed ?? 0;
  return needed > 1 ? needed : 1;
}

/**
 * The platform fee (dollars) charged against ONE helper's share, resolved in
 * order of authority: stamped amount → per-job frozen percent → tier rate.
 *
 * On a group row the stamped amount is deliberately skipped — its scope varies
 * by which payout path wrote it — and the frozen percent is applied to the
 * per-helper budget instead.
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
 * What the helper took home on one completed job:
 * `budget/N − platform fee + net urgent bonus/N`, N = roster size.
 */
export function helperTakeHomeDollars(
  job: HelperEarningsJob,
  feeFallbackPercent: number,
): number {
  const shares = helperShareCount(job);
  const budget = job.budget ?? 0;
  return (
    budget / shares -
    helperPlatformFeeDollars(job, feeFallbackPercent) +
    netUrgentFeeDollars(job.urgent_fee) / shares
  );
}

/** Sum of {@link helperTakeHomeDollars} across a list of completed jobs. */
export function sumHelperTakeHomeDollars(
  jobs: readonly HelperEarningsJob[],
  feeFallbackPercent: number,
): number {
  return jobs.reduce((sum, j) => sum + helperTakeHomeDollars(j, feeFallbackPercent), 0);
}
