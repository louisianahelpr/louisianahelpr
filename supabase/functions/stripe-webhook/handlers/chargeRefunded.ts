import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

export async function handleChargeRefunded(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const refundPiId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : (charge.payment_intent as any)?.id;
  logStep("Charge refunded", { chargeId: charge.id, pi: refundPiId });

  if (refundPiId) {
    const { data: refundedJob } = await supabase
      .from("jobs")
      .select("id, customer_id, title")
      .eq("stripe_payment_intent_id", refundPiId)
      .maybeSingle();

    if (refundedJob) {
      await supabase.from("jobs").update({ payment_status: "refunded" }).eq("id", refundedJob.id);
      await supabase.from("notifications").insert({
        user_id: refundedJob.customer_id,
        title: "💸 Refund processed",
        message: `Your payment for "${refundedJob.title}" has been refunded.`,
        type: "payment",
        link: "/my-posts",
      });
      logStep("Job marked as refunded", { jobId: refundedJob.id });
    }
  }
}
