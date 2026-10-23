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
//
// THE TWELVE TRADES ARE TAXED LIKE HANDYMAN (owner decision 2026-10-17, Q1831):
// electrical, plumbing, hvac, roofing, welding, carpentry, auto_repair,
// appliance_repair, flooring, concrete_masonry, fencing, pressure_washing.
// Auto & small engine and appliance repair are movable property (item 7);
// the rest are mostly real-property work, collected on anyway for the same
// "covered either way" reason as handyman. The same list is in
// enforce_funded_category_tax_class and is_category_taxable (migration
// 20261017055441); src/lib/salesTax.parity.test.ts holds all of them equal.

export const TAXABLE_CATEGORIES: ReadonlySet<string> = new Set([
  "assembly",
  "handyman",
  "electrical",
  "plumbing",
  "hvac",
  "roofing",
  "welding",
  "carpentry",
  "auto_repair",
  "appliance_repair",
  "flooring",
  "concrete_masonry",
  "fencing",
  "pressure_washing",
]);

/**
 * The per-job answer that ALSO taxes the labor (owner 2026-10-23, #3555,
 * "BOTH": keep the 14 categories above AND tax what the tax memo says is
 * taxable). Asked at posting, stored in jobs.tax_kind (migration
 * 20261023192154):
 *   item_repair      the job fixes an item (appliance, furniture, bike,
 *                    electronics, small engine, vehicle): R.S. 47:301.3 item 7;
 *   fabric_cleaning  it cleans carpet, rugs, upholstery, furniture or clothes
 *                    (laundry, pressing, alterations): item 5.
 * null = neither. The SQL rule is_job_labor_taxable holds the same list.
 */
export const TAXED_KINDS: ReadonlySet<string> = new Set(["item_repair", "fabric_cleaning"]);

/** Whether the job's LABOR line is subject to LA sales tax: a taxed category, or a taxed kind. */
export function isLaborTaxable(category: string | null | undefined, taxKind?: string | null): boolean {
  return TAXABLE_CATEGORIES.has(category ?? "") || TAXED_KINDS.has(taxKind ?? "");
}

// ─── Stripe tax codes: the ONE place each is written (ME-043) ───
//
// Every Stripe line item and tax calculation in supabase/functions takes its
// `tax_code` from here; src/test/stripeTaxCodes.test.ts fails the build on a
// line that carries none or writes a `txcd_` literal anywhere else. Before
// this, the taxable-labor code was typed out in create-payment,
// calculate-tax and charge-recurring-visits separately, so the CPA answer on
// docs/OPEN.md Q374 would have had to be found and changed in three places.

/** Stripe "Nontaxable": fees, tips, boosts, gift cards, exempt labor. */
export const NONTAXABLE_TAX_CODE = "txcd_00000000";

/**
 * Stripe "General - Tangible Goods", confirmed in the Tax Codes API list
 * (GET /v1/tax_codes, 2026-10-17): Shops "made" items
 * (_shared/shopTaxCodes.ts maps kinds to codes; tax memo Q2, docs/OPEN.md Q2101).
 */
export const GENERAL_TANGIBLE_GOODS_TAX_CODE = "txcd_99999999";

/**
 * Stripe "Food for Non-Immediate Consumption", confirmed in the Tax Codes API
 * list (GET /v1/tax_codes/txcd_40040000, 2026-10-18): Shops home_food and farm
 * items. Louisiana exempts it from the 5% state tax and taxes it at the local
 * rate (measured in Stripe TEST mode, 2026-10-18: $100 -> $2.00 in Lafayette
 * 70506). Candy stays on this code (owner pop-up 2026-10-18 ~17:00Z).
 */
export const FOOD_FOR_HOME_TAX_CODE = "txcd_40040000";

/**
 * The code on a TAXABLE labor line: Stripe's "Repair of Tangible Personal
 * Property", the LA R.S. 47:301.3 item-7 service the Q374 decision taxes
 * (assembly, handyman and the trades: labor to fabricate, repair or maintain movable
 * property).
 *
 * It was "General - Services" (txcd_20030000) until 2026-10-12, and that code
 * is EXEMPT in Louisiana, an enumerated-services state: the first live taxable
 * checkout (assembly, Delcambre LA, 2026-10-08, cs_live_b164CN…) came back
 * taxability_reason "product_exempt" with the live LA registration active, and
 * the webhook's taxable-zero-tax alert fired (docs/OPEN.md Q1578). Measured on
 * live Stripe Tax (calculation taxcalc_1UPcYUKp2H4b7tECOt3PgfHe, $100 lines at
 * that address): General - Services $0 product_exempt, Installation of TPP $0,
 * Repairs to Real Property $0, Fabrication $11.25 and Repair of TPP $11.25
 * standard_rated. src/test/stripeTaxCodes.test.ts pins this to the codes that
 * measurement showed taxed.
 */
export const TAXABLE_LABOR_TAX_CODE = "txcd_20080005";

/**
 * Stripe "Cleaning of Tangible Personal Property" (tax memo Q4: carpet, rug,
 * upholstery cleaning; laundry, pressing, alterations), the code on a
 * fabric_cleaning job's labor line. NOT yet measured on live Stripe Tax (the
 * account cannot calculate today); TAXABLE_LABOR_TAX_CODE was measured taxed,
 * this one is the memo's code and must be measured before it is relied on
 * (docs/OPEN.md, the #3555 item).
 */
export const CLEANING_TPP_TAX_CODE = "txcd_20010003";

/**
 * The Stripe tax code for a job's labor line: a taxed category keeps the
 * measured repair code; otherwise a taxed kind picks its own; else nontaxable.
 */
export function laborTaxCode(category: string | null | undefined, taxKind?: string | null): string {
  if (TAXABLE_CATEGORIES.has(category ?? "")) return TAXABLE_LABOR_TAX_CODE;
  if (taxKind === "fabric_cleaning") return CLEANING_TPP_TAX_CODE;
  if (taxKind === "item_repair") return TAXABLE_LABOR_TAX_CODE;
  return NONTAXABLE_TAX_CODE;
}

/**
 * A CEILING on a labor line's Louisiana sales tax, for decisions made before
 * Checkout knows the address (Q1658: the $300 3D Secure line). 15% sits above
 * every combined rate measured so far (11.25% in Delcambre, 2026-10-12); a
 * ceiling only errs toward asking for 3D Secure, never away from it. Not a
 * price: never show or charge this number.
 */
const LA_SALES_TAX_CEILING_RATE = 0.15;

export function salesTaxCeilingCents(budgetCents: number, category: string | null | undefined, taxKind?: string | null): number {
  const base = taxableBaseCents(budgetCents, category, taxKind);
  return base > 0 ? Math.ceil(base * LA_SALES_TAX_CEILING_RATE) : 0;
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
export function hasTaxableLine(category: string | null | undefined, taxKind?: string | null): boolean {
  return isLaborTaxable(category, taxKind);
}

/**
 * The taxable base in cents for a job — the labor line only, never the fees.
 *
 * @param budgetCents the job budget (the labor line's unit_amount)
 * @param category    the job category
 */
function taxableBaseCents(budgetCents: number, category: string | null | undefined, taxKind?: string | null): number {
  return isLaborTaxable(category, taxKind) ? budgetCents : 0;
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
  taxKind?: string | null,
): number {
  const base = taxableBaseCents(budgetCents, category, taxKind);
  if (base <= 0 || !(totalRatePercent > 0)) return 0;
  return Math.round((base * totalRatePercent) / 100);
}

/**
 * The base Stripe taxed on a job's escrow checkout, in cents: the labor line
 * (the budget). The urgent bonus and the setup fee ship as NONTAXABLE_TAX_CODE,
 * so they are not in it. (The poster-fee model's taxed "Service fee" line was
 * removed with that model, owner 2026-10-23, #3556; no job was funded on it.)
 */
export function jobEscrowTaxableBaseCents(job: {
  budget?: number | string | null;
  category?: string | null;
} | null | undefined): number {
  const budgetCents = Math.round(Number(job?.budget ?? 0) * 100);
  return Number.isFinite(budgetCents) && budgetCents > 0 ? budgetCents : 0;
}

/**
 * The effective sales-tax rate to store in jobs.sales_tax_rate, as a FRACTION
 * (0.1045 = 10.45%), which is what CHECK ck_jobs_sales_tax_rate_range
 * (sales_tax_rate between 0 and 1, migration 20260902053840) admits. Both
 * writers (stripe-webhook checkoutSessionCompleted, charge-recurring-visits)
 * stored a PERCENT (10.45), so the first taxed job's escrow update, and a taxed
 * recurring visit's insert, would have failed on the CHECK (found 2026-10-07 by
 * the lh-money-escrow review; prod had no taxed job yet). `taxableBaseCents` is
 * every taxed line (today the labor). Rounded to 6 places; 0 when there is no
 * tax or no base.
 */
export function effectiveSalesTaxRate(taxCents: number, taxableBaseCents: number): number {
  if (!(taxCents > 0) || !(taxableBaseCents > 0)) return 0;
  // Clamped to the CHECK's ceiling: tax above its base is impossible at
  // Louisiana's rates, but a rate over 1 would fail the escrow update AFTER
  // the money was captured (lh-money-escrow review); the amount column keeps
  // the real tax either way.
  return Math.min(1, Math.round((taxCents / taxableBaseCents) * 1_000_000) / 1_000_000);
}

/**
 * True when Stripe charged $0 tax on a labor line our own rule says is taxable,
 * billed to a Louisiana address: the one $0 that is NOT the normal exempt
 * outcome (ME-043). A non-LA address can legitimately be $0 (no registration
 * there), and an exempt category is always $0, so neither counts.
 */
export function taxedZeroOnTaxableLouisianaLabor(
  taxCents: number,
  budgetCents: number,
  category: string | null | undefined,
  billingState: string | null | undefined,
  taxKind?: string | null,
): boolean {
  return taxCents === 0
    && budgetCents > 0
    && isLaborTaxable(category, taxKind)
    && (billingState ?? "").trim().toUpperCase() === "LA";
}
