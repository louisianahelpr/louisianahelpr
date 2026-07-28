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
  const { data: ledgerRow, error: ledgerUpdateErr } = await supabase
    .from("payout_transfers")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("stripe_transfer_id", transfer.id)
    .select("job_id, helper_id")
    .maybeSingle();

  if (ledgerUpdateErr) {
    // A failed update here leaves the row stuck at "pending" (or whatever the
    // prior status was). In the normal path release-payout/process-scheduled-payouts
    // already inserts the row as "paid", so this is usually a no-op confirmation.
    // But if this webhook fires before that insert (a race), or the row was
    // genuinely "pending", a silent failure permanently strands the ledger.
    // Throw so the outer handler rolls back the idempotency row and returns 500,
    // letting Stripe retry once the DB recovers.
    throw new Error(
      `Failed to update payout_transfers for transfer ${transfer.id}: ${ledgerUpdateErr.message}`,
    );
  }

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
    if (transferJobId) {
      // Flip the job to "released". For scheduled payouts this is a backup
      // confirmation (process-scheduled-payouts already flipped it); for
      // admin dispute releases it is the authoritative flip.
      const { data: updatedJob, error: jobUpdateErr } = await supabase
        .from("jobs")
        .update({ payment_status: "released" })
        .eq("id", transferJobId)
        .select("id")
        .maybeSingle();
      if (jobUpdateErr) {
        // Log loudly but don't throw: the job flip is belt-and-suspenders here —
        // all transfer-initiating code paths (release-payout, process-scheduled-payouts,
        // admin_release_dispute) already flip the job before this webhook fires.
        // A failed write here leaves the job in its prior state, but the
        // initiating path already set it correctly, so no money↔state divergence.
        logStep("ERROR updating job payment_status to released", {
          error: jobUpdateErr.message,
          jobId: transferJobId,
        });
      } else if (!updatedJob) {
        // Zero rows matched — the job doesn't exist for this ledger entry.
        // Belt-and-suspenders path: log for auditability but don't throw.
        logStep("WARN job update matched 0 rows — job missing for ledger entry", {
          jobId: transferJobId,
        });
      } else {
        logStep("Job payment status set to released", { jobId: transferJobId });
      }
    }

    // Do NOT send a "Payment sent!" notification here. Every transfer-initiating
    // code path already notifies the helper:
    //   - process-scheduled-payouts → "💰 Payout sent!"
    //   - admin_release_dispute      → "Dispute resolved — payment released!"
    //   - tip checkout               → "💰 You received a tip!" (via checkout.session.completed)
    //   - void-cancelled-payments   → "Cancellation fee received"
    // Sending here was causing helpers to receive two notifications for every
    // payout and every tip/cancellation-fee transfer.
    logStep("Transfer confirmed for helper", { userId: paidHelper.user_id, amount: (transfer.amount / 100).toFixed(2) });
  }
}
