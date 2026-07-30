import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

export async function handlePaymentIntentPaymentFailed(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const failedEmail = pi.receipt_email || (pi as any).last_payment_error?.charge?.billing_details?.email;
  logStep("Payment intent failed", { id: pi.id, email: failedEmail });

  // Find the job linked to this PI and notify the poster
  const { data: failedJob, error: failedJobErr } = await supabase
    .from("jobs")
    .select("id, customer_id, title")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();

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
      title: "⚠️ Payment failed",
      message: `Your payment for "${failedJob.title}" could not be processed. Please update your payment method and try again.`,
      type: "warning",
      link: "/my-posts",
    });
    // Must throw on failure: a silent drop here leaves the job in its pre-failure
    // state (e.g. "escrow") permanently. The outer handler rolls back the dedupe
    // row and returns 500 so Stripe retries once the DB recovers.
    const { error: updateErr } = await supabase
      .from("jobs")
      .update({ payment_status: "failed" })
      .eq("id", failedJob.id);
    if (updateErr) {
      throw new Error(`Failed to mark job ${failedJob.id} as payment_failed: ${updateErr.message}`);
    }
    logStep("Notified poster of payment failure", { jobId: failedJob.id });
  }
}
