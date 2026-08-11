// Client mirror of the fixed one-time Stripe product prices defined on the edge
// in supabase/functions/_shared/productPrices.ts. Kept in sync by
// productPrices.parity.test.ts so a UI price can never silently diverge from the
// amount the edge function charges through Stripe Checkout.

import { formatPriceExact } from "@/lib/format";

export const BOOST_FEE_CENTS = 300; // $3.00 — 24h featured placement
export const BGC_FEE_CENTS = 3499; // $34.99 — one-time background screening

export const BOOST_DURATION_HOURS = 24;

// Format a whole-cent amount as a display price: "$3" when it's a round dollar,
// "$34.99" otherwise. Delegates to formatPriceExact for float-safe rounding.
export const formatFeeUsd = (cents: number): string => `$${formatPriceExact(cents / 100)}`;
