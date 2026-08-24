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
  const derived = (perHelperBudget * (job.helper_fee_percent ?? feeFallbackPercent)) / 100;
  if (shares !== 1) return derived;
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
