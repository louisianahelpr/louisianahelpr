/**
 * moneyLimits.ts — single source of truth for job-money limits and fees
 * displayed to users. Every screen that names one of these numbers
 * (Legal, post-a-job wizard, budget picker, cancellation policy, new-helper
 * restrictions) MUST import from here rather than restating the value —
 * that's how the "$5 min" vs "$10 min" drift between the enforced code and
 * the binding Legal doc happened.
 *
 * THAT RECURRENCE IS NOT GUARDED. This block used to claim
 * `moneyFigures.parity.test.ts` fails "if a hardcoded literal reappears in
 * one of the covered files". It does not cover these constants: it imports
 * only the urgent-fee and 1099-K figures, and its one file scan is a single
 * regex over EarningsTab.tsx for the 1099-K prose. No test anywhere imports
 * MIN_JOB_BUDGET_DOLLARS or LATE_CANCEL_PERCENT. The import rule above is a
 * convention held by review, not by CI — treat it that way until someone
 * extends the parity test to these figures.
 */

/** Job budget limits (whole dollars): MIN_JOB_BUDGET_DOLLARS,
 *  MAX_JOB_BUDGET_DOLLARS ($1,000 since 2026-09-23, Q202) and
 *  MAX_URGENT_FEE_DOLLARS ($250 since 2026-09-23, Q210(c)). They live in
 *  supabase/functions/_shared/jobBudgetLimits.ts so the client, create-payment
 *  and the DB CHECKs (jobs_budget_range, jobs_urgent_fee_ceiling,
 *  validate_job_budget) share ONE number; jobBudgetCapIsOneConstant.test.ts
 *  and urgentBonusCap.test.ts fail when any of them disagrees. The form is not the enforcement point:
 *  the jobs INSERT goes through PostgREST with the poster's own token. */
export {
  MIN_JOB_BUDGET_DOLLARS,
  MAX_JOB_BUDGET_DOLLARS,
  MAX_URGENT_FEE_DOLLARS,
} from "../../supabase/functions/_shared/jobBudgetLimits";

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
 * `formatDollarsWhole(1000)` → `"$1,000"`. Kept here so every user-facing
 * money limit renders identically wherever it's stated.
 */
export function formatDollarsWhole(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

/**
 * Federal Form 1099-K reporting thresholds — BOTH must be met in a calendar
 * year (gross payments AND transaction count) before Stripe issues one.
 *
 * These are the 2025-and-later numbers restored by the One Big Beautiful Bill,
 * which repealed the planned $2,500 and $600 step-downs. Louisiana follows
 * federal. They live here because the app used to state two different answers
 * on ONE screen: the Earnings tab's banner fired at "$600" while the tax note
 * at the bottom of the same tab — and both Legal pages — said $20,000 / 200.
 * A helpr reading down that page was told they had crossed a line that no
 * longer exists.
 */
export const FORM_1099K_GROSS_THRESHOLD_DOLLARS = 20000;

/** Transactions needed alongside the gross threshold. */
export const FORM_1099K_TRANSACTION_THRESHOLD = 200;

/** Display string for the gross threshold, e.g. "$20,000". */
export const form1099kGrossLabel = () =>
  formatDollarsWhole(FORM_1099K_GROSS_THRESHOLD_DOLLARS);
