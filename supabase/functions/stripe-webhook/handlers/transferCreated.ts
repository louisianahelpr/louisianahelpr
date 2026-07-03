import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

export async function handleTransferCreated(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const transfer = event.data.object as Stripe.Transfer;
  const destAccount = transfer.destination as string;
  logStep("Transfer created", { id: transfer.id, amount: transfer.amount, destination: destAccount });

  // 1. Update the payout_transfers ledger row (release-payout wrote it
  //    with status='pending'; this is the Stripe-side confirmation).
  //    Most marketplace transfers settle as 'paid' immediately on
  //    creation, so flip directly to 'paid' here. transfer.failed /
  //    transfer.reversed below override if the path doesn't hold.
  const { data: ledgerRow } = await supabase
    .from("payout_transfers")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("stripe_transfer_id", transfer.id)
    .select("job_id, helper_id")
    .maybeSingle();

  // 2. Find the helper and associated job.
  // Only flip payment_status to "released" for transfers that have a
  // payout_transfers ledger row. Cancellation-fee transfers issued by
  // void-cancelled-payments carry job_id in their metadata but never
  // write a ledger row — using metadata here would incorrectly overwrite
  // a job's "refunded" status with "released".
  const transferJobId = ledgerRow?.job_id;
  const { data: paidHelper } = await supabase
    .from("profiles")
    .select("user_id, full_name")
    .eq("stripe_account_id", destAccount)
    .maybeSingle();

  if (paidHelper) {
    const amountDollars = (transfer.amount / 100).toFixed(2);
    await supabase.from("notifications").insert({
      user_id: paidHelper.user_id,
      title: "💵 Payment sent!",
      message: `$${amountDollars} has been transferred to your payout account. It should arrive in 1-2 business days.`,
      type: "payment",
      link: "/earnings",
    });

    if (transferJobId) {
      await supabase.from("jobs").update({ payment_status: "released" }).eq("id", transferJobId);
      logStep("Job payment status set to released", { jobId: transferJobId });
    }

    logStep("Helper notified of transfer", { userId: paidHelper.user_id, amount: amountDollars });
  }
}
