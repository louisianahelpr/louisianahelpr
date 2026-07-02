// Client mirror of the fixed one-time Stripe product prices defined on the edge
// in supabase/functions/_shared/productPrices.ts. Kept in sync by
// productPrices.parity.test.ts so a UI price can never silently diverge from the
// amount the edge function charges through Stripe Checkout.

export const BOOST_FEE_CENTS = 300; // $3.00 — 24h featured placement
export const BGC_FEE_CENTS = 3499; // $34.99 — one-time background screening

export const BOOST_DURATION_HOURS = 24;

// Format a whole-cent amount as a display price: "$3" when it's a round dollar,
// "$34.99" otherwise. Matches how these flat fees have always been shown.
export const formatFeeUsd = (cents: number): string => {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
};
