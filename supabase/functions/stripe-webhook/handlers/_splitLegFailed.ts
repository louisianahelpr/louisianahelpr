// Q2357: a dispute split's transfer to the Helpr failed or was canceled.
//
// The split already refunded the poster their share and paid the Helpr theirs in one settlement
// (execute-dispute-split, payout_transfers metadata.source 'execute_dispute_split'). The generic
// re-queue (payment_status released -> payout_pending) made the job payable by the ordinary payout
// path: get_payout_batches lists it, and the admin's "Send Payout" (release-payout) pays the FULL job
// amount, not the Helpr's share, on top of the poster's refund (its escrow cap ignores refunds).
// Measured 2026-10-23: RELEASE_PAYOUT_AUTO is "1" on prod (secret digest = sha256("1")).
//
// So a split leg is never re-queued. Instead its dispute goes back to execution_status 'failed', the
// state execute-dispute-split re-claims: the admin's "Retry settlement" (or, for a refund the two sides
// agreed, refund-request-sweep) re-runs the SPLIT, which sees the failed payout_transfers row and sends
// the Helpr's share again under a fresh key.
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

type Db = { from: (t: string) => any };

/** The payout_transfers row is a dispute split's leg. */
export function isDisputeSplitLeg(metadata: unknown): boolean {
  return ((metadata ?? {}) as { source?: unknown }).source === "execute_dispute_split";
}

/**
 * Re-open the split's dispute for a re-run. Throws on a DB error (the webhook answers 500 and Stripe
 * redelivers); pages when no executed dispute matched (nothing re-opened: reconcile by hand).
 */
export async function reopenDisputeSplit(
  supabase: Db,
  ledger: { job_id: string | null; helper_id?: string | null; amount_cents?: number | null; metadata?: unknown },
  transferId: string,
  reason: string,
  logStep: (msg: string, data?: Record<string, unknown>) => void,
): Promise<boolean> {
  const disputeId = String(((ledger.metadata ?? {}) as { dispute_id?: unknown }).dispute_id ?? "");
  let reopened = false;
  /** On a zero-row flip, the dispute's state as read (review should-fix 2): 'failed' means already re-opened. */
  let stateNow: string | null = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(disputeId)) {
    const { data, error } = await supabase
      .from("disputes")
      .update({ execution_status: "failed", execution_error: `split transfer ${transferId} did not settle: ${reason}`.slice(0, 500) })
      .eq("id", disputeId)
      .eq("execution_status", "executed")
      .select("id");
    if (error) {
      throw new Error(`dispute ${disputeId} could not be re-opened after split transfer ${transferId} failed: ${error.message}`);
    }
    reopened = (data ?? []).length > 0;
    if (!reopened) {
      const { data: now, error: readErr } = await supabase
        .from("disputes").select("execution_status").eq("id", disputeId).maybeSingle();
      if (readErr) throw new Error(`dispute ${disputeId} state read failed after split transfer ${transferId}: ${readErr.message}`);
      stateNow = (now as { execution_status?: string | null } | null)?.execution_status ?? "missing";
      // A second event for the same dead transfer (failed, then canceled; or a redelivery): already re-opened.
      if (stateNow === "failed") reopened = true;
    }
  }
  logStep("Dispute split leg failed — not re-queued", { jobId: ledger.job_id, disputeId, reopened });
  await postSlackOpsAlert({
    kind: "payout_failed",
    severity: "critical",
    title: "Dispute split transfer did not settle — re-run the split",
    message: reopened
      ? `Stripe transfer ${transferId} (the Helpr's share of a dispute split) did not settle: ${reason}. The job was NOT re-queued for a full payout; its dispute is back to 'failed', so Retry settlement re-sends the Helpr's share only.`
      : `Stripe transfer ${transferId} (the Helpr's share of a dispute split) did not settle: ${reason}. The job was NOT re-queued for a full payout, and the dispute could not be re-opened (its execution_status is ${stateNow ?? "unknown: no dispute id on the transfer"}${stateNow === "executing" ? "; a run is in flight and may mark it executed over this dead leg" : ""}), so nothing retries it. Reconcile by hand.`,
    fields: {
      "Transfer ID": transferId,
      "Job ID": String(ledger.job_id ?? "—"),
      "Dispute": disputeId || "—",
      "Amount": `$${(Number(ledger.amount_cents ?? 0) / 100).toFixed(2)}`,
    },
    oncePerDayKey: `split-leg-failed:${transferId}`,
  });
  return reopened;
}
