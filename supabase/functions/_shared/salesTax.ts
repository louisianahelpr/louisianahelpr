// salesTax — the AUTHORITY on which job lines Louisiana sales tax applies to.
//
// This lives in `_shared` so the checkout screen can show the same number the
// poster is actually charged. It previously existed only as an inline
// `TAXABLE_CATEGORIES` Set inside create-payment, and the Post-a-Task screen
// guessed a flat "about 9-11% of everything" range instead — which overstated
// the total by roughly a tenth on every job in every exempt category (i.e.
// nearly all of them). The screen said "estimated total $118.16-$120.32" and
// Stripe charged $108.40.
//
// LA R.S. 47:301(14) defines a narrow list of taxable services. Most labor
// services (cleaning, yard work, moving, painting houses, errands, pet care,
// delivery) are NOT subject to LA state sales tax. The clearest taxable case in
// this app is *assembly* — installation/assembly of tangible personal property
// (e.g. IKEA furniture). Handyman work is ambiguous (taxable if repairing a TV,
// exempt if repairing a doorframe); it defaults to exempt and relies on
// operator judgment per job. If LDR clarifies otherwise, add categories here
// and BOTH the charge and the quoted estimate move together.
export const TAXABLE_CATEGORIES: ReadonlySet<string> = new Set(["assembly"]);

/** Whether the job's LABOR line is subject to LA sales tax. */
export function isLaborTaxable(category: string | null | undefined): boolean {
  return TAXABLE_CATEGORIES.has(category ?? "");
}

/**
 * Whether ANY line on the checkout is taxable.
 *
 * Kept as its own function because the answer is deliberately narrower than it
 * looks: the service fee, the urgent tip and the one-time setup fee all ship
 * with `tax_code: txcd_00000000` (non-taxable) in create-payment, so the labor
 * line is the only line tax can ever land on. If a fee's tax code changes, this
 * is the one place that has to change with it.
 */
export function hasTaxableLine(category: string | null | undefined): boolean {
  return isLaborTaxable(category);
}

/**
 * The taxable base in cents for a job — the labor line only, never the fees.
 *
 * @param budgetCents the job budget (the labor line's unit_amount)
 * @param category    the job category
 */
export function taxableBaseCents(budgetCents: number, category: string | null | undefined): number {
  return isLaborTaxable(category) ? budgetCents : 0;
}

/**
 * Sales tax in cents at a given combined (state + local) percentage rate.
 * Rounds half-up to the cent, matching Stripe's own rounding on a single
 * taxable line.
 */
export function salesTaxCents(
  budgetCents: number,
  category: string | null | undefined,
  totalRatePercent: number,
): number {
  const base = taxableBaseCents(budgetCents, category);
  if (base <= 0 || !(totalRatePercent > 0)) return 0;
  return Math.round((base * totalRatePercent) / 100);
}
