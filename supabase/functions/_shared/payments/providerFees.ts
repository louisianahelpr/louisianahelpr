/**
 * providerFees — the ONE place PayPal's processing rates live (lead 2026-10-23:
 * "read the rates from one place"; phases 3 and 5 read this too).
 *
 * Published US rates, https://www.paypal.com/us/business/paypal-business-fees
 * (read for the design doc on 2026-10-23, ~/.lh-wt/paypal-design.md §2). The
 * SANDBOX charges a different rate (MEASURED 2026-10-23: 2.59% + $0.49 on cards,
 * e.g. a $3.62 sandbox capture cost $0.58), so these are the live figures we
 * plan on, not what a sandbox capture reports. PayPal keeps its fee when a
 * payment is refunded.
 *
 * Pure numbers: no provider SDK, no network. Safe to import from the client
 * (the tip dialogs quote with the same numbers the server charges).
 */

export interface ProcessingRate {
  /** Percentage of the whole charge, e.g. 0.0349 for 3.49%. */
  readonly pct: number;
  /** Fixed part per charge, in cents. */
  readonly flatCents: number;
}

/** How the payer pays inside a PayPal order. */
export type PayPalMethod = "paypal_checkout" | "venmo" | "pay_later" | "card_standard" | "card_advanced";

export const PAYPAL_RATES: Readonly<Record<PayPalMethod, ProcessingRate>> = {
  /** PayPal Checkout (the PayPal button / wallet): 3.49% + $0.49. */
  paypal_checkout: { pct: 0.0349, flatCents: 49 },
  /** Venmo: 3.49% + $0.49. */
  venmo: { pct: 0.0349, flatCents: 49 },
  /** Pay Later (Pay in 4 / Pay Monthly): 4.99% + $0.49. */
  pay_later: { pct: 0.0499, flatCents: 49 },
  /** Standard card processing: 2.99% + $0.49. */
  card_standard: { pct: 0.0299, flatCents: 49 },
  /** Advanced card processing (needs PayPal's ACDC approval for live): 2.89% + $0.29. */
  card_advanced: { pct: 0.0289, flatCents: 29 },
};

/**
 * The method a tip order is priced at. paypal-tip creates the order with
 * `payment_source.paypal` (PayPal Checkout), so the poster pays on PayPal's
 * page, which is billed at the PayPal Checkout rate.
 */
export const TIP_PAYPAL_METHOD: PayPalMethod = "paypal_checkout";

/**
 * What PayPal keeps on a charge of `amountCents` at `rate`, in cents, rounded to
 * the nearest cent (the rounding the sandbox showed: $105.70 at 2.59% + $0.49 =
 * $3.2276 -> $3.23). 0 for a non-positive amount.
 */
export function paypalProcessingCostCents(amountCents: number, rate: ProcessingRate): number {
  if (!(amountCents > 0)) return 0;
  return Math.round(amountCents * rate.pct) + rate.flatCents;
}
