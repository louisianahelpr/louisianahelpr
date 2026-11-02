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
//   auto_repair       vehicles: named in item 7(a) ("the repair and servicing
//                     of automobiles, vehicles, ..."). Taxable.
//   appliance_repair  appliances: named in item 7(b) ("tangible personal
//                     property includes machinery, appliances, and
//                     equipment"). Taxable.
//   pet_care   NOT on the enumerated list. Grooming and boarding are exempt —
//              confirmed 2026-08-23, previously carried as "ambiguous".
//   cleaning, yard_work, moving, painting, errands, delivery, storm_prep,
//              events — none are enumerated. Exempt.
//
// HOUSE WORK AND THE TRADES ARE NO LONGER TAXED (owner Option 1, 2026-10-25,
// docs/OPEN.md Q2083; this reverses the "covered either way" decisions of
// 2026-08-23 for handyman and 2026-10-17, Q1831, for the trades). Q2083
// carries the tax memo's Q4 table, which the owner adopted in place of a CPA:
// only repairs and maintenance of MOVABLE property (R.S. 47:301.3(7)) and
// laundry / cleaning / pressing / alterations (47:301.3(5)) are taxable.
// R.S. 47:301.3(7)(b) (read on legis.la.gov 2026-11-01, Law.aspx?d=1392324)
// keeps work on buildings and their component parts (Civil Code art. 466)
// outside item 7, except things separated from them. So, by category:
//   handyman (on a house), electrical, plumbing, hvac, roofing, carpentry,
//   flooring, concrete_masonry, fencing, pressure_washing   real property:
//                                                           NOT taxed;
//   assembly   the memo: probably not taxable (MEDIUM): NOT taxed;
//   welding    movable or not depends on the job: NOT taxed by category.
// A category cannot tell a lamp repair (movable, taxable) from a faucet swap
// (real property, exempt). The per-job "repair of an item / cleaning of
// carpet, furniture or clothes" answer at posting (the rest of Q2083) is what
// will tax the movable jobs inside handyman, welding and assembly; until it
// lands those are untaxed, the side the memo puts them on. The same list is in
// enforce_funded_category_tax_class and is_category_taxable (migration
// 20261102033237_q2083_tax_movable_repairs_only);
// src/lib/salesTax.parity.test.ts holds all of them equal to the memo's set.
import { isPosterFeeJob } from "./posterJobFee.ts";
import { MAX_URGENT_FEE_DOLLARS } from "./jobBudgetLimits.ts";

export const TAXABLE_CATEGORIES: ReadonlySet<string> = new Set([
  "auto_repair",
  "appliance_repair",
]);

/**
 * The poster's answer at posting that taxes the labor (Q2083, owner Option 1,
 * 2026-10-25: "at posting ask whether the job is repair of a movable item, or
 * cleaning of carpet / furniture / clothes (plus alterations); tax only those").
 * Stored in jobs.tax_kind (migration 20261102152453):
 *   item_repair           fixes or services a movable item (appliance,
 *                         furniture, bike, electronics, small engine, vehicle):
 *                         La. R.S. 47:301.3 item (7);
 *   fabric_cleaning       cleans carpet, rugs, upholstery or furniture: item (5);
 *   clothes_cleaning      washes, dry-cleans or presses clothes or linens:
 *                         item (5) "Laundry, cleaning, pressing, alterations,
 *                         repair, and dyeing services, including but not limited
 *                         to the cleaning and renovation of clothing, furs,
 *                         linens, furniture, carpets, and rugs";
 *   clothing_alterations  alters clothes: item (5).
 * null = none of these. The SQL rule is_job_labor_taxable holds the same list.
 */
export const TAXED_KINDS: ReadonlySet<string> = new Set([
  "item_repair",
  "fabric_cleaning",
  "clothes_cleaning",
  "clothing_alterations",
]);

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
 * (labor to repair or maintain movable property: auto and appliance repair,
 * Q2083).
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
 * The code on a fabric_cleaning job's labor line (carpet, rugs, upholstery,
 * furniture). Stripe's public tax-code list (docs.stripe.com/tax/tax-codes,
 * read 2026-10-23, re-read 2026-11-02), verbatim: txcd_20010003 "Cleaning of Tangible Personal
 * Property": "A charge for the cleaning of tangible personal property, other
 * than motor vehicles or clothing." Live calculation on our account not measured
 * (docs/OPEN.md Q2083).
 */
export const CLEANING_TPP_TAX_CODE = "txcd_20010003";

/**
 * The code on a clothing_alterations job's labor line. Stripe's public
 * tax-code list (docs.stripe.com/tax/tax-codes, read 2026-10-23, re-read 2026-11-02), verbatim:
 * txcd_20090002 "Garment Alterations - separate from purchase of garment": "A
 * charge to perform an alteration on a item of clothing by a service provider
 * other than vendor of the article. The alteration is not linked to the
 * clothing purchase. Alterations could include hemming of a dress, shortening
 * of pants, adjusting the waistline of a garment, and so on." Live calculation
 * on our account not measured (docs/OPEN.md Q2083).
 */
export const GARMENT_ALTERATIONS_TAX_CODE = "txcd_20090002";

/**
 * The code on a clothes_cleaning job's labor line. Stripe's public tax-code
 * list (docs.stripe.com/tax/tax-codes, read in full 2026-11-02) has exactly two
 * laundry codes and both are business-customer only: txcd_20090012 "Linen
 * Services - Laundry only" ("...The business customer is the owner of the items
 * being cleaned.") and txcd_20090026 (the same, other than clothing). The one
 * code for cleaning a CONSUMER's clothes is txcd_20090004 "Dry Cleaning": "A
 * charge to a non-commercial customer for the cleaning or renovating clothing
 * by immersion and agitation, spraying, vaporization, or immersion only, in a
 * volatile, commercially moisture-free solvent or by the use of a volatile or
 * inflammable product. This does not include the use of a self-service coin (or
 * credit card) operated cleaning machine." Louisiana taxes laundry, cleaning
 * and pressing of clothing alike (R.S. 47:301.3 item 5), so the non-commercial
 * clothing-cleaning code is the closest published one. Live calculation on our
 * account not measured (docs/OPEN.md Q2083).
 */
export const CLOTHES_CLEANING_TAX_CODE = "txcd_20090004";

/**
 * The Stripe tax code for a job's labor line: a taxed category keeps the
 * measured repair code; otherwise a taxed kind picks its own; else nontaxable.
 */
export function laborTaxCode(category: string | null | undefined, taxKind?: string | null): string {
  if (TAXABLE_CATEGORIES.has(category ?? "")) return TAXABLE_LABOR_TAX_CODE;
  if (taxKind === "fabric_cleaning") return CLEANING_TPP_TAX_CODE;
  if (taxKind === "clothing_alterations") return GARMENT_ALTERATIONS_TAX_CODE;
  if (taxKind === "clothes_cleaning") return CLOTHES_CLEANING_TAX_CODE;
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
 * Tax lands only where the labor is taxable: the labor line, the urgent bonus
 * (taxed like labor, owner 2026-10-21, Q1843) and a poster-fee job's service
 * fee all carry laborTaxCode(category); the one-time setup fee ships as
 * `txcd_00000000`. So a checkout has a taxable line exactly when the category's
 * labor is taxable. If a line's tax code changes, this has to change with it.
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

/** The urgent bonus floor create-payment charges ($5, URGENT_FEE_FLOOR_CENTS there). */
const URGENT_BONUS_FLOOR_CENTS = 500;

/**
 * The urgent bonus a job's checkout charges, in cents: create-payment's
 * server-authoritative rule (never the stored column alone). An urgent job pays
 * the stored bonus clamped to $5..MAX_URGENT_FEE_DOLLARS; a job that is not
 * urgent pays none, whatever urgent_fee holds.
 */
export function urgentBonusChargedCents(job: {
  is_urgent?: boolean | null;
  urgent_fee?: number | string | null;
} | null | undefined): number {
  if (job?.is_urgent !== true) return 0;
  const stored = Math.round(Number(job?.urgent_fee ?? 0) * 100);
  const safe = Number.isFinite(stored) ? stored : 0;
  return Math.min(Math.max(safe, URGENT_BONUS_FLOOR_CENTS), MAX_URGENT_FEE_DOLLARS * 100);
}

/**
 * The base Stripe taxed on a job's escrow checkout, in cents: the labor line
 * (the budget); in a taxable category, the urgent bonus line (taxed like
 * labor, owner 2026-10-21, Q1843); and, on a poster-fee job in a taxable
 * category, the "Service fee" line, which carries the labor's tax code
 * (create-payment escrow, the owner-adopted tax memo 2026-10-17). The setup
 * fee and an exempt category's lines ship as NONTAXABLE_TAX_CODE, so they are
 * not in it. Dividing the tax by the budget alone overstated the rate on a
 * taxed poster-fee job (lh-money-escrow review of Q1996 slice 3a, #5).
 */
export function jobEscrowTaxableBaseCents(job: {
  budget?: number | string | null;
  category?: string | null;
  /** The poster's taxed-kind answer (Q2083): taxes the job like a taxed category. */
  tax_kind?: string | null;
  customer_fee_amount?: number | string | null;
  poster_fee_flat_cents?: number | string | null;
  is_urgent?: boolean | null;
  urgent_fee?: number | string | null;
} | null | undefined): number {
  const budgetCents = Math.round(Number(job?.budget ?? 0) * 100);
  const laborCents = Number.isFinite(budgetCents) && budgetCents > 0 ? budgetCents : 0;
  // Q2083: a job taxed by the poster's answer prices its bonus and fee lines
  // with the labor's code too (create-payment), so they are in the base.
  if (!isLaborTaxable(job?.category, job?.tax_kind)) return laborCents;
  const taxedLaborCents = laborCents + urgentBonusChargedCents(job);
  if (!isPosterFeeJob(job)) return taxedLaborCents;
  const feeCents = Math.round(Number(job?.customer_fee_amount ?? 0) * 100);
  return taxedLaborCents + (Number.isFinite(feeCents) && feeCents > 0 ? feeCents : 0);
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
