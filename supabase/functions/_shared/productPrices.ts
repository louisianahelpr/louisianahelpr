// Fixed one-time product prices charged via Stripe Checkout — flat fees that
// are NOT derived from a job budget or a subscription tier (those live in
// platform_settings / subscriptionTiers). This is the single source of truth
// on the edge side; the client mirror is src/lib/productPrices.ts and the two
// are kept in lock-step by src/lib/productPrices.parity.test.ts so a price
// shown in the UI can never silently diverge from what Stripe actually charges.
//
// Plain TS (no Deno imports at module scope) so vitest can import it directly.

export const BOOST_FEE_CENTS = 300; // $3.00 — 24h featured placement
export const BGC_FEE_CENTS = 3499; // $34.99 — one-time background screening

export const BOOST_DURATION_HOURS = 24;
