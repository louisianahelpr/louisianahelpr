// salesTax — client mirror of which checkout lines Louisiana sales tax applies
// to, so the Post-a-Task screen quotes the tax the poster is actually charged.
//
// The authority is the Deno edge module `supabase/functions/_shared/salesTax.ts`
// (imported by create-payment, which sets the per-line Stripe `tax_code`). This
// is a deliberate duplicate rather than an import, for the same reason
// posterFees/helperFees/stripeFees are: the edge module is Deno source with
// `.ts` import specifiers and Deno-only globals, so pulling it into the Vite
// bundle is not a matter of a tsconfig path. `salesTax.parity.test.ts` imports
// BOTH and fails the build if they ever diverge.
//
// WHAT WAS WRONG BEFORE: the checkout screen showed a flat "State & parish
// sales tax — about 9-11%" applied to the WHOLE charge, and an "Estimated
// total" range built from it. But create-payment marks the service fee, the
// urgent tip and the one-time setup fee `txcd_00000000` (non-taxable), and
// marks the labor line taxable only for the categories in TAXABLE_CATEGORIES
// below — `assembly` AND `handyman` (this said "only `assembly`" until
// 2026-09-10), and since 2026-10-17 the twelve trades. So on a typical job Stripe
// charges exactly ZERO sales tax — the screen quoted $118.16-$120.32 for a
// charge of $108.40. The two totals the owner saw side by side were the
// invented estimate and the real one.

/** Mirror of `TAXABLE_CATEGORIES` in `_shared/salesTax.ts` — see the full
 *  statutory reasoning there. */
export const TAXABLE_CATEGORIES: ReadonlySet<string> = new Set([
  "assembly",
  "handyman",
  // The twelve trades, taxed like handyman (owner 2026-10-17, Q1831).
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

/** Mirror of `TAXED_KINDS` in `_shared/salesTax.ts` (owner 2026-10-23, #3555): the
 *  poster's answer at posting that also taxes the labor. */
export const TAXED_KINDS: ReadonlySet<string> = new Set(["item_repair", "fabric_cleaning"]);

/** Whether the job's LABOR line is subject to LA sales tax: a taxed category, or a taxed kind. */
export function isLaborTaxable(category: string | null | undefined, taxKind?: string | null): boolean {
  return TAXABLE_CATEGORIES.has(category ?? "") || TAXED_KINDS.has(taxKind ?? "");
}

/**
 * Whether ANY line on the checkout is taxable. Deliberately narrower than it
 * looks: the service fee, urgent tip and one-time setup fee are all
 * `txcd_00000000`, so the labor line is the only line tax can land on.
 */
export function hasTaxableLine(category: string | null | undefined, taxKind?: string | null): boolean {
  return isLaborTaxable(category, taxKind);
}

/** The taxable base in cents — the labor line only, never the fees. */
function taxableBaseCents(budgetCents: number, category: string | null | undefined, taxKind?: string | null): number {
  return isLaborTaxable(category, taxKind) ? budgetCents : 0;
}

/** Sales tax in cents at a combined (state + local) percentage rate. */
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
  taxKind?: string | null,
): number | null {
  if (!hasTaxableLine(category, taxKind)) return 0;
  if (totalRatePercent === null) return null;
  return salesTaxCents(Math.round(budget * 100), category, totalRatePercent, taxKind) / 100;
}
