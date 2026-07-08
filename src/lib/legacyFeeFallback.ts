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
