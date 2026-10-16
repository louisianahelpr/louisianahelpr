import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { insertNotifications } from "../../_shared/insertNotifications.ts";

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
  // A tip is not the job's payment. A declined tip (auto-tip-charge carries
  // `job_id` for its receipt) must never tell the poster their JOB payment
  // failed; auto-tip-charge sends its own "your auto-tip didn't go through"
  // notice, and a manual tip is retried in the Tip dialog.
  if (pi.metadata?.type === "tip") return;
  const jobId = pi.metadata?.job_id;
  const { data: failedJob, error: failedJobErr } = jobId
    ? await supabase
        .from("jobs")
        .select("id, customer_id, title, payment_status, stripe_session_id")
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
      // The job already moved past unpaid: a late event for a PaymentIntent
      // that later succeeded, or a declined BOOST on a funded open job (a
      // boost PaymentIntent carries the job_id too). Ack without writing and
      // WITHOUT notifying: "the job isn't posted" would be false, and would
      // send a poster whose job is live to post and pay for it again
      // (lh-money-escrow review of 15921ea17, 2026-09-27).
      logStep("Stale payment_failed ignored — job is no longer unpaid", {
        jobId: failedJob.id,
        paymentStatus: failedJob.payment_status,
      });
      return;
    }
    // Q769: a decline inside a still-OPEN Checkout Session is NOT the end of
    // the payment — the poster can try another card on the same page.
    // checkoutSessionExpired is the right place for that notice because only
    // when the session expires is it true that "the job isn't posted".
    //
    // ME-046: for async payment methods (ACH / US bank account), the session
    // expires ~24h after checkout while the bank debit is still pending. By
    // the time the ACH bounces (days later), the session is long gone and
    // checkoutSessionExpired has already run without sending a "failed" notice
    // (the job was still "unpaid", not "failed", at expiry). The poster is
    // never told. Notify now when the session has already expired
    // (stripe_session_id is null = checkoutSessionExpired already cleared it).
    const sessionAlreadyExpired = !(failedJob as any).stripe_session_id;
    if (sessionAlreadyExpired && failedJob.customer_id) {
      await insertNotifications(supabase, {
        user_id: failedJob.customer_id,
        job_id: failedJob.id,
        title: "Payment failed",
        message: `Your payment for "${failedJob.title}" didn't go through, so the job isn't posted. Open Post a Job and load your draft to try again.`,
        type: "warning",
        link: "/post-job",
      });
      logStep("Job marked failed; poster notified (async payment — session already expired)", { jobId: failedJob.id });
    } else {
      logStep("Job marked failed; poster is told on session expiry", { jobId: failedJob.id });
    }
  }
}
