// Q1419: the refund of a checkout payment that would have funded a job already
// funded another way (or closed). Its own module so the refund-path inventories
// can see it never touches a tip (tipsAreFinal) or a job's escrow
// (decidedDisputeEscrowOnlyMovedBySplit): the payment it refunds funded nothing.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

/**
 * Q1419: a full refund of a payment that would have funded an already-funded
 * job. Keyed on the PaymentIntent, so a redelivery refunds nothing twice;
 * "already refunded" (a retry after the key's 24 h) counts as done only when a
 * live refund really exists.
 *
 * Returns the refund this path made, so the caller can ledger it (Q1819): the
 * one created, or on a retry the live refund stamped as ours
 * (metadata.source duplicate_funding), or the only live refund on a payment
 * refunded before the stamp existed. null when a retry finds live refunds but
 * cannot tell which is ours: the money is back, but nothing is ledgered blind.
 */
export async function refundDuplicateFunding(stripe: WebhookContext["stripe"], pi: string): Promise<Stripe.Refund | null> {
  try {
    // own-mistake full refund (owner, 2026-10-14): we took a second payment
    // for a job already funded, so it goes back in full, card fee included;
    // the card fee rule (_shared/refundAmount.ts) does not apply to our errors.
    return await stripe.refunds.create(
      { payment_intent: pi, metadata: { source: DUPLICATE_FUNDING_SOURCE } },
      { idempotencyKey: `duplicate-funding-refund:${pi}` },
    );
  } catch (e) {
    const err = e as { type?: string; code?: string } | null;
    const maybeDone = err?.code === "charge_already_refunded" ||
      err?.type === "StripeIdempotencyError" || err?.type === "idempotency_error";
    if (!maybeDone) throw e;
    const prior = await stripe.refunds.list({ payment_intent: pi, limit: 100 });
    const live = prior.data.filter((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled");
    if (live.length === 0) throw e;
    const ours = live.find((r: Stripe.Refund) => (r.metadata as Record<string, string> | null)?.source === DUPLICATE_FUNDING_SOURCE);
    if (ours) return ours;
    return live.length === 1 ? live[0] : null;
  }
}

/** The ledger source (and refund metadata stamp) of a duplicate-funding refund. */
export const DUPLICATE_FUNDING_SOURCE = "duplicate_funding";

/**
 * Q1819: the duplicate-funding refund gets its payment_refunds ledger row,
 * like every other refund path (charge.refunded ledgers a full refund only
 * when a job holds that PaymentIntent, and this one funded nothing). Upserted
 * on the Stripe refund id, so a redelivery writes one row.
 *
 * job_id is NULL on purpose (lh-money-escrow + lh-silent-failure reviews of
 * 5f292defa): this money never funded the job. Every job-keyed reader of
 * payment_refunds (Release, the dispute split, auto-resolve, the settle RPCs,
 * money-reconciliation) reads any row on a job as that job's escrow having
 * gone back, so a row on the funded job would strand its Helpr's payout. The
 * job it collided with is kept in metadata.job_id.
 *
 * A failed write pages and THROWS, so Stripe redelivers: the refund is keyed
 * (and found again on a retry), so the retry refunds nothing twice and the
 * ledger write heals itself. A refund that cannot be identified (null) is
 * paged and not ledgered.
 */
export async function ledgerDuplicateFundingRefund(
  supabase: WebhookContext["supabase"],
  refund: Stripe.Refund | null,
  args: { jobId: string; customerId: string | null; pi: string; sessionId: string },
): Promise<void> {
  if (!refund) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Duplicate-funding refund not ledgered: which refund is ours is unclear",
      message: "A second payment on an already-funded job is refunded, but a retry found several live refunds on it and none stamped as the duplicate-funding refund. Add its payment_refunds row by hand (source duplicate_funding, job_id empty).",
      fields: { job_id: args.jobId, payment_intent: args.pi },
      oncePerDayKey: `duplicate-funding-ledger-unclear:${args.pi}`,
    });
    return;
  }
  const { error } = await supabase.from("payment_refunds").upsert(
    {
      job_id: null,
      customer_id: args.customerId,
      stripe_refund_id: refund.id,
      stripe_payment_intent_id: args.pi,
      amount_cents: Math.round(Number(refund.amount ?? 0)),
      currency: refund.currency ?? "usd",
      is_partial: false,
      reason: "a second payment on a job already funded another way, refunded in full",
      source: DUPLICATE_FUNDING_SOURCE,
      initiated_by_user_id: null,
      metadata: { checkout_session_id: args.sessionId, job_id: args.jobId, funded_nothing: true },
    },
    { onConflict: "stripe_refund_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error(`[stripe-webhook] duplicate-funding refund ${refund.id} ledger write failed:`, error);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Duplicate-funding refund ledger write failed",
      message: "A second payment on an already-funded job was refunded in full, but its payment_refunds row was not written. Stripe will redeliver the event and the write is retried; if this repeats, add the row by hand.",
      fields: { job_id: args.jobId, payment_intent: args.pi, refund_id: refund.id, db_error: error.message },
      oncePerDayKey: `duplicate-funding-ledger:${refund.id}`,
    });
    throw new Error(`duplicate-funding refund ${refund.id} not ledgered: ${error.message}`);
  }
}
