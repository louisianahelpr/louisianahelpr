// Single source of truth for the fee-percent fallback used when a job row
// pre-dates the `helper_fee_percent` / `customer_fee_percent` columns (a
// column-null read on old rows).
//
// Historically ~16 files had a raw `?? 10` or `|| 10` sprinkled at the read
// site. Cowork audit 2026-07-08 called this out as exactly the class of
// pattern that let the WorkRecord / fetchAnalytics "assume Pro tier"
// bug slip in — a single constant is DRY and greppable, so a future
// value change (or a "legacy rows are gone, drop the fallback" decision)
// happens in one place instead of 16.
//
// Value chosen deliberately as 10 to preserve pre-consolidation behavior —
// this is NOT the current Free-tier ladder (12%); it's the historical
// fallback for jobs that were posted before the fee column existed on
// the row. Do not "correct" to 12 without a migration that back-fills
// the column on the affected historical rows.

/**
 * Fallback helper-side platform fee % when `jobs.helper_fee_percent`
 * is null (legacy row pre-dating the column). Every read of that column
 * that needs a numeric fallback should use this constant, not a raw 10.
 */
export const HELPER_FEE_LEGACY_FALLBACK_PERCENT = 10;

/**
 * Fallback poster-side service fee % when `jobs.customer_fee_percent`
 * is null (legacy row pre-dating the column). Same rationale as
 * `HELPER_FEE_LEGACY_FALLBACK_PERCENT`, mirrored for the poster leg.
 */
export const CUSTOMER_FEE_LEGACY_FALLBACK_PERCENT = 10;

/**
 * Resolve a job row's `helper_fee_percent` to a number, falling back ONLY when
 * the column is genuinely absent.
 *
 * Written because two admin surfaces read it as
 * NOTE ON WHAT THIS COLUMN ACTUALLY MEANS. `jobs.helper_fee_percent` is NOT
 * "the helper's commission rate for this job". `create-payment` stamps it from
 * the GLOBAL `platform_settings.helper_fee_percent` at ESCROW time — before any
 * helper is assigned — so on an unpaid job it is a record of the platform's
 * posted rate, nothing about the helper. Only when the job reaches
 * `payment_status = 'released'` do the payout paths (`release-payout`,
 * `process-scheduled-payouts`, the dispute split) re-stamp it with the helper's
 * live tier, at which point it IS the record of what was deducted.
 *
 * This function is therefore for AUDIT surfaces — admin analytics, the admin
 * user/job tabs — which legitimately want the value as recorded. Anything that
 * shows a HELPER their take-home must use `helperDisplayFeePercent` /
 * `helperTakeHomeDollars` (src/lib/helperEarnings.ts) instead.
 *
 * `Number(j.helper_fee_percent) || HELPER_FEE_LEGACY_FALLBACK_PERCENT`. `||`
 * treats 0 as missing, so a legitimately COMPED job — commission deliberately
 * set to 0% — was silently restated at 10%, and admin saw a helper paid less
 * than they were. `??` is the correct operator, with a NaN guard for the
 * string/garbage case that `??` alone does not cover.
 */
export function helperFeePercentOrLegacy(
  raw: number | string | null | undefined,
): number {
  if (raw === null || raw === undefined || raw === "") {
    return HELPER_FEE_LEGACY_FALLBACK_PERCENT;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : HELPER_FEE_LEGACY_FALLBACK_PERCENT;
}

