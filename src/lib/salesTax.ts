// salesTax — client mirror of which checkout lines Louisiana sales tax applies
// to, so the Post-a-Task screen quotes the tax the poster is actually charged.
//
// The authority is the Deno edge module `supabase/functions/_shared/salesTax.ts`
// (imported by create-payment, which sets the per-line Stripe `tax_code`). This
// is a deliberate duplicate rather than an import: `tsconfig.app.json` doesn't
// include `supabase/`, so app source can't reach the edge tree — only the test
// can. `salesTax.parity.test.ts` imports BOTH and fails the build if they ever
// diverge, exactly as posterFees/helperFees/stripeFees already do.
//
// WHAT WAS WRONG BEFORE: the checkout screen showed a flat "State & parish
// sales tax — about 9-11%" applied to the WHOLE charge, and an "Estimated
// total" range built from it. But create-payment marks the service fee, the
// urgent tip and the one-time setup fee `txcd_00000000` (non-taxable), and
// marks the labor line taxable only for `assembly`. So on a typical job Stripe
// charges exactly ZERO sales tax — the screen quoted $118.16-$120.32 for a
// charge of $108.40. The two totals the owner saw side by side were the
// invented estimate and the real one.

/** Mirror of `TAXABLE_CATEGORIES` in `_shared/salesTax.ts`. */
export const TAXABLE_CATEGORIES: ReadonlySet<string> = new Set(["assembly"]);

/** Whether the job's LABOR line is subject to LA sales tax. */
export function isLaborTaxable(category: string | null | undefined): boolean {
  return TAXABLE_CATEGORIES.has(category ?? "");
}

/**
 * Whether ANY line on the checkout is taxable. Deliberately narrower than it
 * looks: the service fee, urgent tip and one-time setup fee are all
 * `txcd_00000000`, so the labor line is the only line tax can land on.
 */
export function hasTaxableLine(category: string | null | undefined): boolean {
  return isLaborTaxable(category);
}

/** The taxable base in cents — the labor line only, never the fees. */
export function taxableBaseCents(budgetCents: number, category: string | null | undefined): number {
  return isLaborTaxable(category) ? budgetCents : 0;
}

/** Sales tax in cents at a combined (state + local) percentage rate. */
export function salesTaxCents(
  budgetCents: number,
  category: string | null | undefined,
  totalRatePercent: number,
): number {
  const base = taxableBaseCents(budgetCents, category);
  if (base <= 0 || !(totalRatePercent > 0)) return 0;
  return Math.round((base * totalRatePercent) / 100);
}

/**
 * Estimated sales tax in DOLLARS for the Post-a-Task summary.
 *
 * @param budget           job budget in dollars
 * @param category         job category
 * @param totalRatePercent the parish's combined state+local rate, from
 *                         `parish_tax_rates.total_rate`. Pass `null` when the
 *                         parish isn't known yet — returns `null` so the UI can
 *                         say "set by your parish" instead of inventing a rate.
 */
export function estimatedSalesTax(
  budget: number,
  category: string | null | undefined,
  totalRatePercent: number | null,
): number | null {
  if (!hasTaxableLine(category)) return 0;
  if (totalRatePercent === null) return null;
  return salesTaxCents(Math.round(budget * 100), category, totalRatePercent) / 100;
}
