// jobBudgetLimits — the ONE definition of how much a job may cost, shared by
// the client (src/lib/moneyLimits.ts re-exports it), the edge functions
// (create-payment refuses a checkout outside it) and the database (the
// jobs_budget_range / jobs_urgent_fee_ceiling CHECKs and validate_job_budget()
// carry the same literal; src/test/jobBudgetCapIsOneConstant.test.ts reads the
// newest migration defining each and fails when they disagree with this file).
//
// Plain TS, no Deno imports, so vitest and the Vite client import it directly.
//
// MAX LOWERED 5000 -> 1000 on 2026-09-23 (owner decision by pop-up, docs/OPEN.md
// Q202, card-dispute protection): a card dispute on a released job costs the
// platform the whole charge plus Stripe's fee, so the largest single charge is
// the largest single loss. Bigger projects are split into several jobs.

/** Minimum job budget a poster may set (whole dollars). */
export const MIN_JOB_BUDGET_DOLLARS = 10;

/** Maximum job budget a poster may set (whole dollars). */
export const MAX_JOB_BUDGET_DOLLARS = 1000;

/** Maximum urgent bonus (whole dollars). Capped at the budget ceiling: a rush
 *  premium larger than the largest job we allow is a typo or an attack. */
export const MAX_URGENT_FEE_DOLLARS = MAX_JOB_BUDGET_DOLLARS;

/** True when a stored or submitted budget is outside the allowed range. */
export function jobBudgetOutOfRange(budget: unknown): boolean {
  const n = typeof budget === "number" ? budget : Number(budget);
  return !Number.isFinite(n) || n < MIN_JOB_BUDGET_DOLLARS || n > MAX_JOB_BUDGET_DOLLARS;
}
