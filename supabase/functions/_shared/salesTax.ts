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
// LA R.S. 47:301.3 (Act 11, 2024 3rd Extraordinary Session, effective
// 2025-01-01) makes Louisiana an ENUMERATED-SERVICES state: exactly ten
// services are taxable, and a service not on the list is not taxed at all.
// The list is sleeping rooms · admissions · parking · printing and copying ·
// laundry/cleaning/pressing/alteration/repair/dyeing · cold storage ·
// REPAIRS AND MAINTENANCE OF TANGIBLE PERSONAL PROPERTY AND DIGITAL PRODUCTS ·
// telecommunications · prewritten software access · information services.
//
// Item 7 is the one this app lives under, and it turns on MOVABLE vs
// IMMOVABLE. LDR states the rule directly: "Labor to fabricate, repair, or
// maintain tangible personal property is generally subject to sales tax,"
// while "labor to construct, install, remodel, or repair immovable (real)
// property is generally not."
//
//   assembly   furniture and equipment — movable. Taxable.
//   handyman   BOTH. Repairing a lamp is movable and taxable; replacing a
//              kitchen faucet is real property and is not. A category cannot
//              tell the two apart, and neither can we at checkout.
//   pet_care   NOT on the enumerated list. Grooming and boarding are exempt —
//              confirmed 2026-08-23, previously carried as "ambiguous".
//   cleaning, yard_work, moving, painting, errands, delivery, storm_prep,
//              events — none are enumerated. Exempt.
//
// HANDYMAN IS INCLUDED BY OWNER DECISION (2026-08-23): "just add the tax for
// handyman so we are covered either way." That deliberately errs toward
// COLLECTING on jobs that may be exempt real-property work, rather than
// missing tax on the movable-property repairs item 7 does cover. The trade is
// real and worth stating plainly: tax collected must be remitted, so
// over-collecting is not free — it is a different exposure, not the absence of
// one. The durable fix is a per-job movable/immovable answer at post time
// rather than a per-category guess; until then this is the safer side of a
// call the category cannot make.
export const TAXABLE_CATEGORIES: ReadonlySet<string> = new Set(["assembly", "handyman"]);

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
