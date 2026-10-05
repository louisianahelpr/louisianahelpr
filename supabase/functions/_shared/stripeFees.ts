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
 * The REAL, non-refundable fee Stripe kept on a specific charge, in CENTS —
 * read from the charge's own balance transaction rather than assumed.
 *
 * `stripeProcessingCostCents` above assumes every charge cost 2.9% + $0.30,
 * which is only true for a domestic card. This account also accepts Klarna/
 * Affirm/Afterpay (5.99% + $0.30) and ACH/US bank account (0.8%, capped $5) —
 * every one of those has a materially different real fee. A refund that
 * withholds the CARD estimate on a Klarna-paid job under-withholds by ~3% of
 * the charge, every time, silently: the platform pays that gap out of its own
 * pocket. Reading the actual fee closes that gap for every current and future
 * payment method, without hand-maintaining a rate table here.
 *
 * `pi` must be a PaymentIntent retrieved with
 * `{ expand: ["latest_charge.balance_transaction"] }` — anything less (a
 * string id, or a charge with an unexpanded balance_transaction) falls back
 * to the card-rate estimate via `fallbackAmountCents`, so every call site
 * still gets a safe floor even if the expand was missed or the transaction
 * genuinely isn't available yet (e.g. an async payment method still settling).
 */
export function actualOrEstimatedFeeCents(
  pi: { latest_charge?: unknown } | null | undefined,
  fallbackAmountCents: number,
): number {
  const charge = pi?.latest_charge as
    | { balance_transaction?: unknown }
    | null
    | undefined;
  const balanceTransaction = charge?.balance_transaction as
    | { fee?: unknown }
    | null
    | undefined;
  if (balanceTransaction && typeof balanceTransaction.fee === "number") {
    return balanceTransaction.fee;
  }
  return stripeProcessingCostCents(fallbackAmountCents);
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
 * What the Helpr receives of the urgent bonus: ALL of it (owner MQ11 / CC-003,
 * 2026-09-24, Q362: "the poster pays the card fee on top so the Helpr gets
 * 100%", the same rule as a tip). The bonus's own card-processing cost is
 * charged to the poster on top (`urgentBonusCardFeeCents`), so nothing is
 * netted here any more. The name is kept so every payout path and earnings
 * surface still calls this ONE definition, and the amount a Helpr is SHOWN
 * always equals the amount transferred. Input/output in DOLLARS (it slots into
 * `budget − commission + urgentFee`). Returns 0 for a non-positive/absent fee.
 */
export function netUrgentFeeDollars(urgentFeeDollars: number | null | undefined): number {
  const cents = Math.round((urgentFeeDollars ?? 0) * 100);
  if (!(cents > 0)) return 0;
  return cents / 100;
}

/**
 * The card fee the POSTER pays on top of an urgent bonus of `urgentCents`, in
 * cents (Q362 / CC-003). The bonus rides bundled inside the escrow charge, so
 * only Stripe's percentage applies (the $0.30 flat is borne once by the primary
 * legs), and the fee is itself part of the charge: the smallest whole-cent
 * `fee` with `fee >= stripePercentCostCents(urgent + fee)`. Returns 0 for a
 * non-positive bonus. create-payment charges it as its own line and stores it
 * inside `customer_fee_amount` (non-refundable like the service fee, since
 * Stripe keeps its cut on a refund); the Post-a-Task quote shows the same line.
 */
export function urgentBonusCardFeeCents(urgentCents: number): number {
  if (!(urgentCents > 0)) return 0;
  let fee = Math.ceil((urgentCents * STRIPE_PCT) / (1 - STRIPE_PCT));
  while (fee > 0 && fee - 1 >= stripePercentCostCents(urgentCents + fee - 1)) fee--;
  while (fee < stripePercentCostCents(urgentCents + fee)) fee++;
  return fee;
}
