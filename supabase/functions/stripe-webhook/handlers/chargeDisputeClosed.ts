import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

export async function handleChargeDisputeClosed(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  // A Stripe chargeback reached its final state:
  //   "won"            → Stripe ruled for the platform; funds restored.
  //   "lost"           → Stripe ruled for the cardholder; funds gone.
  //   "warning_closed" → Early-fraud warning dismissed; no funds moved.
  //
  // On "won": notify admins to manually release the helper's blocked
  //   payout. We do NOT auto-release — a human should confirm the job
  //   was legitimate before paying the helper after a chargeback.
  // On "lost": record the final outcome for finance reconciliation.
  const closedDispute = event.data.object as Stripe.Dispute;
  const outcome = closedDispute.status; // "won" | "lost" | "warning_closed"
  logStep("Dispute closed", { id: closedDispute.id, status: outcome, amount: closedDispute.amount });

  let closedPiId: string | null =
    typeof closedDispute.payment_intent === "string"
      ? closedDispute.payment_intent
      : (closedDispute.payment_intent as any)?.id ?? null;

  if (!closedPiId) {
    try {
      const closedCharge = await stripe.charges.retrieve(closedDispute.charge as string);
      closedPiId =
        typeof closedCharge.payment_intent === "string"
          ? closedCharge.payment_intent
          : (closedCharge.payment_intent as any)?.id ?? null;
    } catch (e) {
      logStep("Could not retrieve charge for closed dispute", { error: String(e) });
    }
  }

  const finalDisputeStatus =
    outcome === "won" ? "dispute_won"
    : outcome === "lost" ? "dispute_lost"
    : "warning_closed";

  if (closedPiId) {
    const { data: closedJob } = await supabase
      .from("jobs")
      .select("id, customer_id, helper_id, title, payment_status")
      .eq("stripe_payment_intent_id", closedPiId)
      .maybeSingle();

    if (closedJob) {
      await supabase
        .from("jobs")
        .update({
          dispute_status: finalDisputeStatus,
          dispute_resolved_at: new Date().toISOString(),
        })
        .eq("id", closedJob.id);

      if (outcome === "won") {
        // Funds are back on the platform balance. Notify admins to
        // release the helper's payout that was blocked at dispute.created.
        // Admin uses admin_release_dispute (which sets payment_status =
        // "released") or manually sets dispute_status = "resolved" to
        // let release-payout through its dispute gate.
        const { data: wonAdminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        if (wonAdminRoles) {
          for (const admin of wonAdminRoles) {
            await supabase.from("notifications").insert({
              user_id: admin.user_id,
              title: "✅ Chargeback WON — release helper payout",
              message: `Stripe ruled in our favor on the $${(closedDispute.amount / 100).toFixed(2)} chargeback for "${closedJob.title}". Funds are restored. Please release the helper's payout from the Admin panel.`,
              type: "payment",
              link: "/admin",
            });
          }
        }
      }
    }
  }

  postSlackOpsAlert({
    kind: outcome === "won" ? "dispute_won" : outcome === "lost" ? "dispute_lost" : "custom",
    severity: outcome === "won" ? "info" : outcome === "lost" ? "critical" : "info",
    title:
      outcome === "won"
        ? "✅ Stripe chargeback WON"
        : outcome === "lost"
        ? "❌ Stripe chargeback LOST"
        : "ℹ️ Stripe early-fraud warning closed",
    message:
      outcome === "won"
        ? `Stripe ruled in our favor on a $${(closedDispute.amount / 100).toFixed(2)} chargeback. Funds restored — release the helper's blocked payout manually via the Admin panel.`
        : outcome === "lost"
        ? `Stripe ruled against us on a $${(closedDispute.amount / 100).toFixed(2)} chargeback. Funds permanently withdrawn. Reconcile the loss.`
        : `An early-fraud warning for $${(closedDispute.amount / 100).toFixed(2)} was dismissed without a chargeback.`,
    fields: {
      "Dispute ID": closedDispute.id,
      "Payment Intent": closedPiId ?? "—",
      "Amount": `$${(closedDispute.amount / 100).toFixed(2)}`,
      "Outcome": outcome,
    },
    link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
  });
}
