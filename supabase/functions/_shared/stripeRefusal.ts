/**
 * Did Stripe ANSWER a write with a definite "no"?
 *
 * A Stripe error with a 4xx status (other than 409 and 429) means Stripe read
 * the request and refused it: nothing was created, and the same request will
 * be refused again (with an idempotency key, Stripe replays that same answer
 * for 24 hours). A connection error, a timeout, a rate limit, a 5xx or an
 * idempotency conflict is NOT a definite answer: the write may have happened,
 * so a caller must not act as if no money moved.
 *
 * Example (job 2c8480ae, 2026-10-23): `refunds.create` answered 400 "This
 * account is not currently able to refund charges". cancel_escrow treated it
 * like any other error, left its 'cancelling' claim in place and answered a
 * 500, and the job stayed stuck mid-cancel with nothing refunded.
 *
 * Zero imports on purpose: the edge harness runs the real module.
 */
export function isDefinitiveStripeRefusal(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { type?: unknown; statusCode?: unknown; code?: unknown };
  if (e.type === "StripeConnectionError" || e.type === "StripeAPIError" || e.type === "StripeRateLimitError") return false;
  if (e.type === "StripeIdempotencyError" || e.code === "idempotency_key_in_use") return false;
  const status = e.statusCode;
  if (typeof status !== "number") return false;
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}
