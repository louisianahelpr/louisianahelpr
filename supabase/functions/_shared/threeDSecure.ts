// threeDSecure — when a card charge asks the card issuer to authenticate the
// cardholder (3D Secure), stated once for every Checkout Session that takes a
// card payment for a job, a tip or a gift.
//
// WHY (owner decision 2026-09-23, docs/OPEN.md Q202): an authenticated charge
// moves liability for a "fraudulent / not authorized" card dispute from the
// platform to the card issuer, and those are the disputes that end with the
// platform paying the whole charge plus Stripe's fee. Small charges stay
// frictionless; from THREE_D_SECURE_MIN_CENTS up, 3DS is requested.
//
// 'any' asks Stripe to attempt 3DS whenever the card supports it (a card that
// does not support it still goes through). Stripe's HOSTED Checkout page runs
// the challenge itself: on the web, and inside the in-app browser sheet
// (src/lib/openExternalUrl.ts) on iOS/Android, so no client code has to handle
// `requires_action`. src/test/threeDSecureOnLargeCharges.test.ts holds that:
// every job-money Checkout Session passes through this helper, and no client
// code confirms a PaymentIntent itself.
//
// Plain TS, no Deno imports, so vitest imports it directly.

/** Charges at or above this many cents request 3D Secure ($300). */
export const THREE_D_SECURE_MIN_CENTS = 30000;

/** Stripe Checkout `payment_method_options` for a charge of `amountCents`:
 *  `{ card: { request_three_d_secure: "any" } }` from $300 up, else undefined
 *  (an undefined key is dropped from the request). */
export function threeDSecureOptions(
  amountCents: number,
): { card: { request_three_d_secure: "any" } } | undefined {
  if (!Number.isFinite(amountCents) || amountCents < THREE_D_SECURE_MIN_CENTS) return undefined;
  return { card: { request_three_d_secure: "any" } };
}
