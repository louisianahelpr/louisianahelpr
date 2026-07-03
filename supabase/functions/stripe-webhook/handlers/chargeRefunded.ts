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
  logStep("Charge refunded", {
    chargeId: charge.id,
    pi: refundPiId,
    amount: charge.amount,
    amountRefunded: charge.amount_refunded,
  });

  // Only a FULL refund flips the job to "refunded". A partial refund (e.g. a
  // one-off duplicate-onboarding-fee correction, or a partial-dispute payout)
  // leaves the bulk of escrow in place, so marking the whole job refunded would
  // strand held funds in a wrong terminal state. Reconcile on the actual amounts.
  const isFullRefund = charge.amount_refunded >= charge.amount;
  const isOnboardingFeeCorrection =
    (charge.metadata as Record<string, string> | null)?.reason === "duplicate_onboarding_fee";

  if (refundPiId && isFullRefund && !isOnboardingFeeCorrection) {
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
  } else if (refundPiId) {
    // Partial refund or an onboarding-fee correction — intentionally NOT flipping
    // the job to refunded. Logged (not silent) so partial-refund reconciliation
    // is auditable rather than a mystery no-op.
    logStep("Refund not full — job status left unchanged", {
      pi: refundPiId,
      isFullRefund,
      isOnboardingFeeCorrection,
    });
  }
}
