/**
 * The sales tax line of a PayPal job checkout: ONE function for the quote the
 * app shows and the amount the order charges (PayPal Plan A, phase 3).
 *
 * PayPal does not calculate tax: the order carries a tax_total we compute. The
 * Stripe-era source (Stripe Tax) is gone with the Stripe account, and the old
 * parish_tax_rates table was dropped on 2026-08-24
 * (20260824010000_drop_parish_tax_rates.sql; measured on prod 2026-10-23: the
 * relation does not exist). Which rates to charge is the owner's decision
 * (asked 2026-10-23). Until it is made (option A, lead 2026-10-23):
 *
 *   - a category whose labor is not taxable (most of them): tax is 0, exact;
 *   - a taxable category (salesTax.ts TAXABLE_CATEGORIES): NOT payable through
 *     PayPal yet. Refused, never charged an invented rate and never charged 0
 *     on labor the law taxes.
 *
 * The client imports this module directly (the same file), so the quote and
 * the charge cannot disagree. When a rate source is chosen, only this function
 * changes.
 */
import { isLaborTaxable } from "./salesTax.ts";

export type PayPalJobTax =
  | { ok: true; taxCents: number; taxableBaseCents: number }
  | { ok: false; reason: "tax_rate_unavailable" };

/** What the poster is told when the category is taxable and no rate source exists yet. */
export const PAYPAL_TAXABLE_CATEGORY_MESSAGE =
  "Paying for this kind of job isn't available yet while we set up sales tax for it. Choose a different category, or contact support.";

/** `laborCents` is the taxable base a rate will apply to once one is chosen. */
export function payPalJobSalesTax(category: string | null | undefined, _laborCents: number): PayPalJobTax {
  if (!isLaborTaxable(category)) return { ok: true, taxCents: 0, taxableBaseCents: 0 };
  return { ok: false, reason: "tax_rate_unavailable" };
}
