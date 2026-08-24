// Fixed one-time product prices charged via Stripe Checkout — flat fees that
// are NOT derived from a job budget or a subscription tier (those live in
// platform_settings / subscriptionTiers). This is the single source of truth
// on the edge side; the client mirror is src/lib/productPrices.ts and the two
// are kept in lock-step by src/lib/productPrices.parity.test.ts so a price
// shown in the UI can never silently diverge from what Stripe actually charges.
//
// Plain TS (no Deno imports at module scope) so vitest can import it directly.

export const BOOST_FEE_CENTS = 300; // $3.00 — 24h featured placement

/**
 * Boost discount for an ACTIVE Basic / Pro subscriber (Elite boosts free).
 * Lived inline in create-boost-payment, which meant the client had to
 * transcribe the rule rather than import it — and it drifted: the dialog
 * quoted $3 to posters Stripe charged $2.40. Exported here so
 * src/lib/productPrices.ts can be import-parity-tested against it.
 */
export const BOOST_DISCOUNT_PCT = 20;

/**
 * Absolute floor covering Stripe's per-charge cost (~30¢ + 2.9%) plus a thin
 * margin, so a future BOOST_FEE_CENTS cut can't invert unit economics on
 * discounted subscribers. Only bites below a ~$1.25 base fee.
 */
export const BOOST_MIN_UNIT_AMOUNT_CENTS = 100;
export const BGC_FEE_CENTS = 3499; // $34.99 — one-time background screening

export const BOOST_DURATION_HOURS = 24;
