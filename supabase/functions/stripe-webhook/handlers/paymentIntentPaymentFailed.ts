import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

export async function handlePaymentIntentPaymentFailed(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const failedEmail = pi.receipt_email || (pi as any).last_payment_error?.charge?.billing_details?.email;
  logStep("Payment intent failed", { id: pi.id, email: failedEmail });

  // ME-040 (lh-money-escrow, 2026-09-04): `jobs.stripe_payment_intent_id` is
  // only written on the SUCCESS path (checkout.session.completed) — a card
  // declined at Checkout produces a real PaymentIntent that this column
  // never records, so looking the job up by that column silently matched no
  // row: no error (`.maybeSingle()` on zero rows is a normal `null`), no
  // notification, no `payment_status='failed'`. The poster saw nothing, and
  // re-opening `/payment-success` printed "hasn't been confirmed on our side
  // yet… don't pay again" — actively wrong advice to someone who should be
  // retrying with a different card. `create-payment` sets `job_id` in
  // `payment_intent_data.metadata` on every Checkout Session it creates, so
  // it survives onto the resulting PaymentIntent unconditionally — read the
  // job from there instead of a column only the success path populates.
  const jobId = pi.metadata?.job_id;
  const { data: failedJob, error: failedJobErr } = jobId
    ? await supabase
        .from("jobs")
        .select("id, customer_id, title, payment_status")
        .eq("id", jobId)
        .maybeSingle()
    : { data: null, error: null };

  if (failedJobErr) {
    // Throw so the outer handler rolls back the idempotency row and returns 500,
    // letting Stripe retry once the DB recovers. Silently returning would ack the
    // event permanently — leaving the job in its pre-failure state (e.g. "escrow")
    // with no "failed" marker and no poster notification, forever.
    throw new Error(`Job lookup failed for failed PI ${pi.id}: ${failedJobErr.message}`);
  }

  if (failedJob) {
    await supabase.from("notifications").insert({
      user_id: failedJob.customer_id,
      title: "Payment failed",
      message: `Your payment for "${failedJob.title}" could not be processed. Please update your payment method and try again.`,
      type: "warning",
      // `?job=` — My Posts opens on the "Needs you" bucket and a job whose
      // payment just failed is not necessarily in it. Activity resolves the
      // job id to whichever bucket it is actually in.
      link: `/my-posts?job=${failedJob.id}`,
    });
    // Must throw on failure: a silent drop here leaves the job in its pre-failure
    // state (e.g. "escrow") permanently. The outer handler rolls back the dedupe
    // row and returns 500 so Stripe retries once the DB recovers.
    // STATE PRECONDITION (R9). This had none, so an out-of-order or retried
    // payment_failed for a PaymentIntent that LATER succeeded flipped a funded
    // job escrow → failed — and PaymentSuccess.tsx then tells the poster no
    // money was ever taken while their money sits in escrow. Only a job that
    // is still unpaid (or has no payment_status yet) may be marked failed.
    const { data: failedUpdate, error: updateErr } = await supabase
      .from("jobs")
      .update({ payment_status: "failed" })
      .eq("id", failedJob.id)
      .or("payment_status.is.null,payment_status.eq.unpaid")
      .select("id")
      .maybeSingle();
    if (updateErr) {
      throw new Error(`Failed to mark job ${failedJob.id} as payment_failed: ${updateErr.message}`);
    }
    if (!failedUpdate) {
      // The job already moved past unpaid — this event is stale relative to a
      // successful charge. Acking without the write is correct; the earlier
      // notification is the only user-visible effect, and a poster being told
      // a payment attempt failed is true even when a later attempt succeeded.
      logStep("Stale payment_failed ignored — job is no longer unpaid", {
        jobId: failedJob.id,
        paymentStatus: failedJob.payment_status,
      });
    }
    logStep("Notified poster of payment failure", { jobId: failedJob.id });
  }
}
