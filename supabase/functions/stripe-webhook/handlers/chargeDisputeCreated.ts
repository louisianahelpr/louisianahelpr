import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

export async function handleChargeDisputeCreated(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  // A customer filed a Stripe chargeback. Stripe immediately withdraws the
  // disputed amount from the platform's bank balance. We must:
  //   1. Block any automated payout for the affected job (payout_pending
  //      or escrow) — paying the helper from money we no longer have
  //      compounds the loss.
  //   2. Alert ops so someone responds in Stripe Dashboard before the
  //      evidence due date (typically 7 days or Stripe auto-loses the case).
  const dispute = event.data.object as Stripe.Dispute;
  logStep("Chargeback filed", {
    id: dispute.id,
    amount: dispute.amount,
    reason: dispute.reason,
    status: dispute.status,
  });

  let disputePiId: string | null =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : (dispute.payment_intent as any)?.id ?? null;

  if (!disputePiId) {
    // Fallback: retrieve the charge to find the PaymentIntent
    try {
      const disputeCharge = await stripe.charges.retrieve(dispute.charge as string);
      disputePiId =
        typeof disputeCharge.payment_intent === "string"
          ? disputeCharge.payment_intent
          : (disputeCharge.payment_intent as any)?.id ?? null;
    } catch (e) {
      logStep("Could not retrieve charge for dispute", { error: String(e) });
    }
  }

  if (disputePiId) {
    const { data: chargebackJob } = await supabase
      .from("jobs")
      .select("id, customer_id, helper_id, title, payment_status, status")
      .eq("stripe_payment_intent_id", disputePiId)
      .maybeSingle();

    if (chargebackJob) {
      // Only flip payment_status if the payout hasn't been finalized yet —
      // 'released' jobs already paid the helper so we leave the status alone
      // and let ops handle the net loss manually.
      const shouldBlockPayout = ["payout_pending", "escrow"].includes(
        chargebackJob.payment_status,
      );

      await supabase
        .from("jobs")
        .update({
          ...(shouldBlockPayout ? { payment_status: "chargeback" } : {}),
          dispute_status: "stripe_chargeback",
          disputed_at: new Date().toISOString(),
        })
        .eq("id", chargebackJob.id);

      logStep(
        shouldBlockPayout
          ? "Blocked payout on chargebacked job"
          : "Chargeback on already-released job — manual reconciliation needed",
        {
          jobId: chargebackJob.id,
          prevPaymentStatus: chargebackJob.payment_status,
          shouldBlockPayout,
          disputeId: dispute.id,
        },
      );

      // Notify all admins — chargebacks require a Stripe Dashboard response
      // or the platform auto-loses and pays both the customer AND a $15 fee.
      const { data: chargebackAdminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      if (chargebackAdminRoles) {
        for (const admin of chargebackAdminRoles) {
          await supabase.from("notifications").insert({
            user_id: admin.user_id,
            title: "⚠️ Stripe chargeback filed",
            message: `A $${(dispute.amount / 100).toFixed(2)} chargeback was filed for "${chargebackJob.title}". Respond in Stripe Dashboard before the evidence deadline or the dispute is auto-lost.`,
            type: "warning",
            link: "/admin",
          });
        }
      }
    }
  }

  // Always alert ops even when no job is matched — funds already left
  // the platform and someone must respond in Stripe Dashboard.
  postSlackOpsAlert({
    kind: "dispute_filed",
    severity: "critical",
    title: "💳 Stripe chargeback filed",
    message: `A $${(dispute.amount / 100).toFixed(2)} chargeback was opened (reason: ${dispute.reason ?? "unknown"}). Respond in Stripe Dashboard before the evidence due date.`,
    fields: {
      "Dispute ID": dispute.id,
      "Payment Intent": disputePiId ?? "—",
      "Reason": dispute.reason ?? "—",
      "Amount": `$${(dispute.amount / 100).toFixed(2)}`,
      "Evidence Due": dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000)
            .toISOString()
            .split("T")[0]
        : "—",
    },
    link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
  });
}
