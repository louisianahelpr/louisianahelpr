/**
 * moneyLimits.ts — single source of truth for job-money limits and fees
 * displayed to users. Every screen that names one of these numbers
 * (Legal, post-a-job wizard, budget picker, cancellation policy, new-helper
 * restrictions) MUST import from here rather than restating the value —
 * that's how the "$5 min" vs "$10 min" drift between the enforced code and
 * the binding Legal doc happened. `moneyFigures.parity.test.ts` guards
 * this: if a hardcoded literal reappears in one of the covered files,
 * that test fails.
 */

/** Minimum job budget a poster may set (whole dollars).
 *  Mirrored server-side by the `jobs_budget_range` CHECK constraint
 *  (migration 20260819235000) — the form is not the enforcement point, since
 *  the jobs INSERT goes through PostgREST with the poster's own token. Change
 *  both together. */
export const MIN_JOB_BUDGET_DOLLARS = 10;

/** Maximum job budget a poster may set (whole dollars).
 *  Also mirrored by `jobs_budget_range` — see above. */
export const MAX_JOB_BUDGET_DOLLARS = 5000;

/** Minimum urgent bonus a poster may add on an urgent job (whole dollars). */
export const URGENT_FEE_FLOOR_DOLLARS = 5;

/** Default urgent-bonus value pre-filled in the post-job wizard. */
export const DEFAULT_URGENT_FEE_DOLLARS = 5;

/** Preset chips shown in the urgent-fee picker; first entry MUST equal the floor. */
export const URGENT_FEE_PRESETS = [5, 10, 15, 20] as const;

/** One-time platform onboarding fee charged on a poster's first job. */
export const ONBOARDING_FEE_CENTS = 200;

/** Cancellation fee applied when a poster cancels < 24h before start. */
export const LATE_CANCEL_PERCENT = 25;

/** Cancellation fee applied when a poster cancels < 2h before start. */
export const VERY_LATE_CANCEL_PERCENT = 50;

/**
 * Format a whole-dollar amount for display without decimals, e.g.
 * `formatDollarsWhole(5000)` → `"$5,000"`. Kept here so every user-facing
 * money limit renders identically wherever it's stated.
 */
export function formatDollarsWhole(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}
