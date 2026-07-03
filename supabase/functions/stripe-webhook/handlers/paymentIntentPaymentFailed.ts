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
  const { data: failedJob } = await supabase
    .from("jobs")
    .select("id, customer_id, title")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();

  if (failedJob) {
    await supabase.from("notifications").insert({
      user_id: failedJob.customer_id,
      title: "⚠️ Payment failed",
      message: `Your payment for "${failedJob.title}" could not be processed. Please update your payment method and try again.`,
      type: "warning",
      link: "/my-posts",
    });
    await supabase.from("jobs").update({ payment_status: "failed" }).eq("id", failedJob.id);
    logStep("Notified poster of payment failure", { jobId: failedJob.id });
  }
}
