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
export async function refundDuplicateFunding(stripe: WebhookContext["stripe"], pi: string): Promise<Stripe.Refund | null> {
  try {
    return await stripe.refunds.create({ payment_intent: pi }, { idempotencyKey: `duplicate-funding-refund:${pi}` });
  } catch (e) {
    const err = e as { type?: string; code?: string } | null;
    const maybeDone = err?.code === "charge_already_refunded" ||
      err?.type === "StripeIdempotencyError" || err?.type === "idempotency_error";
    if (!maybeDone) throw e;
    const prior = await stripe.refunds.list({ payment_intent: pi, limit: 100 });
    const live = prior.data.find((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled");
    if (!live) throw e;
    return live;
  }
}

/**
 * Q1418 (d): the refund above is money that left Stripe, so it is ledgered
 * (payment_refunds, source 'duplicate_funding'; charge.refunded ledgers a full
 * refund only when a job holds that PaymentIntent, and this one funded
 * nothing) and the poster is told it came back. Never throws: the refund
 * already happened; a failed write is returned for the caller's page, starting
 * "recorded;" when the ledger row exists and only a later step failed.
 *
 * job_id is NULL on purpose (lh-money-escrow review): four readers
 * (create-payment's escrowAlreadyMovedTheOtherWay, execute-dispute-split,
 * auto-resolve-disputes, money-reconciliation) read ANY refund row on a job as
 * "this job's escrow was refunded", and this refund is of a different
 * PaymentIntent. The job it would have funded is kept in metadata.
 */
export async function recordDuplicateFundingRefund(
  supabase: WebhookContext["supabase"],
  refund: Stripe.Refund,
  args: {
    jobId: string;
    sessionId: string | null;
    customerId: string | null;
    paymentIntentId: string;
    jobTitle: string | null;
    /** The job was never funded but had closed (completed/cancelled) when this payment landed. */
    jobClosedUnfunded: boolean;
  },
): Promise<string | null> {
  const reason = args.jobClosedUnfunded
    ? "a payment for a job that had already closed"
    : "a second payment for a job already funded another way";
  const { data: inserted, error } = await supabase.from("payment_refunds").upsert({
    job_id: null,
    customer_id: args.customerId,
    stripe_refund_id: refund.id,
    stripe_payment_intent_id: args.paymentIntentId,
    amount_cents: Math.round(Number(refund.amount ?? 0)),
    currency: refund.currency ?? "usd",
    is_partial: false,
    reason,
    source: "duplicate_funding",
    initiated_by_user_id: null,
    metadata: { funded_job_id: args.jobId, session_id: args.sessionId },
  }, { onConflict: "stripe_refund_id", ignoreDuplicates: true }).select("id");
  if (error) return `payment_refunds: ${error.message}`;
  // charge.refunded may have written the row first as 'stripe_dashboard';
  // claim it (zero rows is legitimate: the upsert above wrote it).
  const { error: relabelErr } = await supabase.from("payment_refunds")
    .update({ source: "duplicate_funding", reason })
    .eq("stripe_refund_id", refund.id).eq("source", "stripe_dashboard").select("id");
  if (relabelErr) return `recorded; relabel of an earlier row failed: ${relabelErr.message}`;
  // Told once: only the delivery whose upsert wrote the row sends the notice
  // (a redelivery after a later throw finds the row and stays quiet).
  if (!inserted || inserted.length === 0) return null;
  if (!args.customerId) return "recorded; nobody on the job to tell (account deleted)";
  const dollars = (Math.round(Number(refund.amount ?? 0)) / 100).toFixed(2);
  const title = args.jobTitle ?? "Your job";
  const { error: noticeErr } = await supabase.from("notifications").insert({
    user_id: args.customerId,
    job_id: args.jobId,
    title: args.jobClosedUnfunded ? "Payment refunded" : "Second payment refunded",
    message: args.jobClosedUnfunded
      ? `"${title}" had already closed when this payment came through, so the $${dollars} was refunded in full. It can take 5 to 10 business days to show on your card.`
      : `"${title}" was already paid for, so the second payment of $${dollars} was refunded in full. It can take 5 to 10 business days to show on your card.`,
    type: "payment",
    link: `/posts?job=${args.jobId}`,
  });
  if (noticeErr) return `recorded; the notice to the person who paid failed: ${noticeErr.message}`;
  return null;
}
