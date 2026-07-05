// stripeFees — single source of truth for what Stripe's card processing costs
// the PLATFORM, for the Deno edge runtime.
//
// Stripe charges 2.9% + $0.30 on every successful card charge, and it does NOT
// return that fee when the charge is later refunded. So any money path that
// takes a poster's card and later gives some of it back (cancellation refunds,
// dispute refunds) leaves the platform out-of-pocket by the processing cost of
// whatever was captured — unless we withhold at least that much. This helper
// computes that floor so every refund path can guarantee the platform never
// loses money to Stripe fees (the core money-safety rule for this app).
//
// This MUST stay in lock-step with the client mirror in `src/lib/stripeFees.ts`.
// The edge runtime is Deno and cannot import that React module, so the constants
// are duplicated there and a vitest parity test (`src/lib/stripeFees.parity.test.ts`)
// fails the build if the two drift.

/** Stripe's percentage cut of a successful card charge (2.9%). */
export const STRIPE_PCT = 0.029;

/** Stripe's fixed per-charge fee, in CENTS ($0.30). */
export const STRIPE_FLAT_CENTS = 30;

/**
 * What Stripe kept (and will NOT refund) on a successful card charge of
 * `amountCents`, in CENTS: 2.9% + $0.30, rounded to the nearest cent. This is
 * the minimum a refund path must withhold so the platform recovers the fee it
 * already paid Stripe. Returns 0 for a non-positive amount (nothing was charged).
 */
export function stripeProcessingCostCents(amountCents: number): number {
  if (!(amountCents > 0)) return 0;
  return Math.round(amountCents * STRIPE_PCT) + STRIPE_FLAT_CENTS;
}
