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

/**
 * Stripe's PERCENTAGE-only cost (2.9%, no flat), in CENTS, for a line item that
 * rides BUNDLED inside a larger charge rather than as its own standalone charge.
 * Stripe's $0.30 flat is levied ONCE per transaction and is already borne by the
 * primary legs (job budget + service fee), so a bundled add-on like the urgent
 * fee only carries the marginal percentage — charging the flat again would
 * double-count a cost Stripe never levied. (A standalone charge such as a tip
 * uses `stripeProcessingCostCents`, which DOES include the flat.) Returns 0 for
 * a non-positive amount.
 */
export function stripePercentCostCents(amountCents: number): number {
  if (!(amountCents > 0)) return 0;
  return Math.round(amountCents * STRIPE_PCT);
}

/**
 * The urgent fee a helper actually nets after the urgent fee covers its OWN
 * marginal Stripe processing cost. The urgent fee is charged to the poster
 * bundled into the escrow checkout and passes through to the helper; this nets
 * out only the bundled marginal cost (2.9%, NOT the once-per-transaction flat)
 * so the platform never subsidizes card processing on the urgent fee while the
 * helper still keeps the fair remainder. Input/output in DOLLARS so it slots
 * directly into the `budget − commission + urgentFee` take-home formula used
 * across payout and every earnings display. Returns 0 for a non-positive/absent
 * fee. This is the ONE definition every payout path and earnings surface must
 * call, so the amount a helper is SHOWN always equals the amount transferred.
 */
export function netUrgentFeeDollars(urgentFeeDollars: number | null | undefined): number {
  const cents = Math.round((urgentFeeDollars ?? 0) * 100);
  if (!(cents > 0)) return 0;
  return (cents - stripePercentCostCents(cents)) / 100;
}
