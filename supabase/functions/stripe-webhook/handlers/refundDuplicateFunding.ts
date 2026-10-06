// Q1419: the refund of a checkout payment that would have funded a job already
// funded another way (or closed). Its own module so the refund-path inventories
// can see it never touches a tip (tipsAreFinal) or a job's escrow
// (decidedDisputeEscrowOnlyMovedBySplit): the payment it refunds funded nothing.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

/**
 * Q1419: a full refund of a payment that would have funded an already-funded
 * job. Keyed on the PaymentIntent, so a redelivery refunds nothing twice;
 * "already refunded" (a retry after the key's 24 h) counts as done only when a
 * live refund really exists.
 */
export async function refundDuplicateFunding(stripe: WebhookContext["stripe"], pi: string): Promise<void> {
  try {
    await stripe.refunds.create({ payment_intent: pi }, { idempotencyKey: `duplicate-funding-refund:${pi}` });
  } catch (e) {
    const err = e as { type?: string; code?: string } | null;
    const maybeDone = err?.code === "charge_already_refunded" ||
      err?.type === "StripeIdempotencyError" || err?.type === "idempotency_error";
    if (!maybeDone) throw e;
    const prior = await stripe.refunds.list({ payment_intent: pi, limit: 100 });
    if (!prior.data.some((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled")) throw e;
  }
}
