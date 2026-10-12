/**
 * Money formatting for notification copy, mirroring `src/lib/format.ts`.
 *
 * Edge functions run on Deno and cannot import from `src/`, but the rule they
 * have to obey is the same one the app obeys: a card/row shows WHOLE DOLLARS,
 * and a figure that is a PAYOUT to someone rounds DOWN so the notification
 * never promises more than the amount that actually lands ($83.60 must read
 * "$83", never "$84").
 *
 * Use `formatPayoutDollars` for take-home / net / payout copy shown to a user.
 * Leave `.toFixed(2)` in place for internal ops + Slack alerts and for
 * breakdown fragments that have to visibly add up (a fee-deduction note) —
 * the same split `formatPriceExact` covers on the client.
 */
export function formatPayoutDollars(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  // Through the transfer's own rule (whole cent first, then down to the
  // dollar), so float noise like 122.99999999999999 — a $410 job split three
  // ways at 10% — reads "$123", the dollar amount that actually lands.
  return Math.floor(roundPayoutDownCents(amount * 100) / 100).toLocaleString("en-US");
}

/**
 * EXACT-cents dollars for money that is NOT a Helpr payout: a refund to the
 * poster's card, a restored gift balance, a referral-credit cash-out (whose
 * transfer is exact). Mirrors `formatPriceExact` in `src/lib/format.ts`:
 * "$41.87", or "$41" when there are no cents. Flooring these would tell the
 * poster they got back less than Stripe refunded (Q236 review).
 */
export function formatExactDollars(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  const cents = Math.round(amount * 100);
  const hasFraction = cents % 100 !== 0;
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Cents-denominated sibling, for the handlers that carry Stripe cents. */
export function formatPayoutCents(cents: number): string {
  if (!Number.isFinite(cents)) return "0";
  return formatPayoutDollars(cents / 100);
}

/**
 * THE Helpr payout rounding rule (owner, 2026-09-27, Q236): every transfer to
 * a Helpr is a WHOLE dollar, rounded DOWN, and the platform keeps the cents.
 * $41.87 owed → 4100 cents transferred; the 87 cents stay in the platform
 * balance.
 *
 * This is the ONE place that rule lives. Every `stripe.transfers.create` that
 * pays a Helpr for a job (release-payout, process-scheduled-payouts, the
 * dispute split, the admin Quick Release, cancellation-fee payouts) sets its
 * `amount` through it — `src/test/helprPayoutRoundedDown.test.ts` fails CI on
 * one that does not.
 *
 * Integer cents in, integer cents out. The input is rounded to a whole cent
 * first so float noise (4186.9999…) cannot knock a dollar off. Zero and
 * negative inputs come back as-is (never raised), so a caller's existing
 * `<= 0` refusal still fires.
 */
export function roundPayoutDownCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  const whole = Math.round(cents);
  if (whole <= 0) return whole;
  return Math.floor(whole / 100) * 100;
}

/** One hour: the bucket a retried transfer's idempotency key is salted with. */
const RETRY_KEY_BUCKET_MS = 60 * 60 * 1000;

/**
 * The Stripe idempotency key for a fee transfer, salted on a RETRY (Q1381).
 *
 * Stripe keeps a request's result for about 24 h and replays it for the same
 * key, failures included. A transfer that failed once (no payout account yet,
 * a restricted account) and is retried under its fixed key gets the saved
 * failure back, so the member cannot be paid until the key expires.
 * process-scheduled-payouts salts its key with the failure count for this
 * reason. The fee ledgers have no attempt counter, so a retry (a row already
 * marked 'failed') is salted with the UTC hour instead: every hourly retry is
 * a real new attempt, while two RETRIES inside the same hour share one key
 * (Stripe dedupes them). A first attempt keeps the unsalted key.
 *
 * A row is marked 'failed' (and so salted next time) ONLY after a definite
 * refusal (isDefiniteStripeRefusal): Stripe answered and no transfer exists.
 * A timeout, a dropped connection or a 5xx may have created the transfer, so
 * such a row keeps its status and the next attempt, even later in the same
 * run, reuses the SAME key and Stripe dedupes it (lh-money-escrow review of
 * Q1381: a Part A first attempt that timed out was retried by Part F seconds
 * later under the salted key). Beyond that, double pay is stopped where it
 * always was: the row is skipped once 'paid', and the job's transfer group is
 * listed (fail closed) before paying.
 */
export function feeTransferIdempotencyKey(base: string, isRetry: boolean, nowMs: number = Date.now()): string {
  return isRetry ? `${base}-h${Math.floor(nowMs / RETRY_KEY_BUCKET_MS)}` : base;
}

/**
 * Did Stripe DEFINITELY refuse the request (it answered, and nothing was
 * created)? Same list as create-payment's transferToHelper. A timeout, a
 * dropped connection, a 5xx or an idempotency error may have created the
 * object, so they are not definite (Q1381 review).
 */
export function isDefiniteStripeRefusal(err: unknown): boolean {
  const type = String((err as { type?: unknown } | null)?.type ?? "");
  return [
    "StripeInvalidRequestError",
    "StripeCardError",
    "StripePermissionError",
    "StripeAuthenticationError",
  ].includes(type);
}

/**
 * What a payout WITHHELD and never sent, for the ledger row's metadata
 * (Q1520): the one-time onboarding fee taken from a first payout, and the
 * sub-dollar remainder of rounding the payout down to whole dollars. The
 * earnings export (get_helper_earnings_export) adds both to the row's fee,
 * so its gross is everything the Helpr earned, not only what was sent.
 */
export function payoutWithheldMetadata(
  unroundedPayoutCents: number,
  onboardingFeeCents: number,
  paidCents: number,
): { onboarding_fee_cents: number; rounding_remainder_cents: number } {
  const onboarding = Math.max(0, Math.round(onboardingFeeCents));
  return {
    onboarding_fee_cents: onboarding,
    rounding_remainder_cents: Math.max(0, Math.round(unroundedPayoutCents) - onboarding - Math.round(paidCents)),
  };
}
