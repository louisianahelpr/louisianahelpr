// The words the checkout-return screen (PaymentSuccess) is allowed to say for
// each confirmation state. Pure functions of the state, split out of the page
// so the page stays under its size baseline; the claim logic that decides the
// state stays in PaymentSuccess.tsx.

export type ConfirmState = "checking" | "held" | "not_held" | "unknown" | "not_yours";

/** Why we ended up in `unknown` — changes only the explanatory sentence. */
// ME-041 (lh-money-escrow, 2026-09-04): "moved" was declared here but nothing
// in the page ever assigned it — dead since whenever it was added.
export type UnknownReason = "no-reference" | "unreachable" | "not-found" | "pending";

/**
 * Board 56's "Your job is live" says two things: the payment is held AND
 * Helprs can find the job. `live` carries the second half: the job is still
 * open (Posted stage), not already paid out, and not a direct offer to one
 * Helpr (lh-money-escrow review 2026-10-21). A held payment on a job past
 * that point says only what is true about the money.
 */
export function paymentPageTitle(state: ConfirmState, live = true): string {
  return state === "held"
    ? live ? "Your job is live — Helpr" : "Payment confirmed — Helpr"
    : state === "not_held"
      ? "Payment Not Completed — Helpr"
      : state === "checking"
        ? "Confirming Payment — Helpr"
        : state === "not_yours"
          ? "Different Account — Helpr"
          : "Payment Status Unconfirmed — Helpr";
}

export function paymentHeading(state: ConfirmState, live = true): string {
  return state === "held"
    ? live ? "Your job is live" : "Payment confirmed."
    : state === "checking"
      ? "Confirming your payment…"
      : state === "not_held"
        ? "Your payment didn't go through."
        : state === "not_yours"
          ? "This payment belongs to a different account."
          : "We couldn't confirm your payment.";
}

export function unknownPaymentBody(reason: UnknownReason): string {
  return reason === "no-reference"
    ? "We don't have a reference for this payment, so we can't tell you whether it went through. Please don't pay again — open My Posts to check the job's payment status, or contact support and we'll look it up for you."
    : reason === "pending"
      ? "Your payment hasn't been confirmed on our side yet. It usually lands within a minute. Please don't pay again — open My Posts to see this job's payment status, and contact support if it still isn't confirmed in a few minutes."
      : "We couldn't reach our records to check this payment. That does not mean it failed — we simply can't tell you either way right now. Please don't pay again — open My Posts to see this job's payment status, and contact support if it still isn't clear.";
}
