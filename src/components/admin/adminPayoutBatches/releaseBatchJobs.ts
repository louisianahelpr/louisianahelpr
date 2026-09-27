import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * Guard against a SILENT NO-OP on the money path.
 *
 * History: "Send Payout" and then "Bulk Approve" (until Q758) invoked the
 * `stripe-payouts` edge function with `{ helper_id }`. Both now go through
 * `releaseBatchJobs` below. That function never reads `helper_id`, and it never
 * calls `stripe.transfers.create` — it looks up THE CALLER'S OWN
 * `profiles.stripe_account_id` and returns a read-only Connect balance summary
 * (`{ connected, payouts_enabled, available, pending, payouts }`). It is the
 * same endpoint a Helpr's own Earnings tab calls with an empty body.
 *
 * An admin has no `stripe_account_id`, so the function returns
 * `{ connected:false, payouts:[] }` with HTTP 200 and NO `error` field. The old
 * code's `if (error) throw error` therefore never fired: after a Face ID
 * prompt and a confirm dialog reading "This moves real money and can't be
 * undone", the UI wrote an `admin_audit_log` row claiming the payout was
 * triggered, closed the dialog, and moved on — while zero cents moved and the
 * batch stayed in the queue.
 *
 * It is kept on the `release-payout` path as a tripwire: any balance-shaped
 * answer is a no-op made LOUD instead of silent, so the admin sees a real
 * error and the audit log is not falsified.
 */
function assertTransferHappened(data: unknown): void {
  const d = data as Record<string, unknown> | null | undefined;
  if (d && ("connected" in d || "payouts_enabled" in d)) {
    throw new Error(
      "Payout not sent. The endpoint this button calls only reads a Connect balance — it never creates a transfer, so no money moved. Escrow release still runs automatically; this batch is unchanged.",
    );
  }
}

/**
 * Pay one helper's batch the only way that moves money: resolve the batch's
 * job ids (get_payout_batch_job_ids shares get_payout_batches' predicate) and
 * call `release-payout` once per job. Shared by the per-batch "Send Payout"
 * AND the bulk run (Q758: the bulk run used to call `stripe-payouts`, a
 * balance read that never transfers, so every bulk batch failed). Throws when
 * the job-id read fails or finds nothing; per-job failures are returned, not
 * thrown, so each caller reports a partial run as one.
 */
export async function releaseBatchJobs(helperId: string): Promise<{ jobIds: string[]; failures: string[] }> {
  // `release-payout` is what actually transfers, and it takes a JOB id.
  // get_payout_batches() aggregates by helper and returns no job ids,
  // which is why the old call went to `stripe-payouts` — a function that
  // never reads helper_id and only reports the CALLER's own balance. It
  // answered 200 with no `error`, so this handler logged a payout that
  // never happened. get_payout_batch_job_ids (20260831213026) shares that
  // RPC's predicate exactly, so what we pay is what the batch counted.
  const { data: jobRows, error: jobsErr } = await supabase.rpc(
    "get_payout_batch_job_ids",
    { p_helper_id: helperId },
  );
  if (jobsErr) throw jobsErr;
  const jobIds = (jobRows ?? []).map((r) => r.job_id);
  if (jobIds.length === 0) {
    // Zero rows is also what a non-admin sees, by design in the RPC.
    throw new Error(
      "Nothing left to pay in this batch — it may have settled already. Refresh to re-check.",
    );
  }

  // One job at a time, and a partial success is reported as one. The claim
  // protocol in release-payout means a job already paid answers cleanly
  // rather than double-paying, so a retry after a partial failure is safe.
  const failures: string[] = [];
  for (const jobId of jobIds) {
    const { data, error } = await supabase.functions.invoke("release-payout", {
      body: { job_id: jobId },
    });
    if (error) { failures.push(jobId); continue; }
    try {
      assertTransferHappened(data);
    } catch (err) {
      // NOT silent: release-payout answered without a transfer. The admin
      // sees this job in the failure count, but a count is not a diagnosis
      // — and a payout that reports success while moving no money is the
      // single worst failure this screen can have. Record it with the job
      // id so it can be reconciled against Stripe afterwards.
      report(err, {
        severity: "error",
        tags: { area: "payout", op: "releaseBatch.assertTransfer" },
        context: { jobId },
      });
      failures.push(jobId);
    }
  }
  return { jobIds, failures };
}
