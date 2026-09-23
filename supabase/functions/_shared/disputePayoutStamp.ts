/**
 * Record on the `disputes` row the transfer that actually settled it (Q153).
 *
 * A dispute can be closed in two steps: `auto-resolve-disputes` (or an admin
 * path that calls `settle_dispute_record`) marks the row decided + executed
 * and flips the job to `payout_pending`, and the money moves LATER, through
 * `release-payout` or `process-scheduled-payouts`. Neither payer wrote the
 * dispute row, so it said "executed" with execution_transfer_id and
 * execution_helper_cents NULL for ever. Measured on prod 2026-09-23: dispute
 * 9756a585 (job e6979a12) was paid by tr_3UCwOtKp2H4b7tEC1UMtZPxp (3520c) and
 * still carried NULL/NULL, so the admin DisputeCard read
 * "Settled: $0.00 to the Helpr · $0.00 refunded" and the parties'
 * DisputeTimelineDialog showed no settled amount at all.
 *
 * `settle_dispute_record` cannot fix this: it only ever writes a row that is
 * still 'open'. This helper stamps the one row that is decided, executed, and
 * has NO transfer or helper amount recorded, and nothing else:
 *
 *   - never overwrites a stamp. Both the read and the UPDATE require
 *     execution_transfer_id IS NULL AND execution_helper_cents IS NULL, so a
 *     row execute-dispute-split stamped with its own transfer is untouched,
 *     and a concurrent writer that stamps first makes our UPDATE match zero
 *     rows (reported as `raced`, never retried over it);
 *   - never a dispute that settled by REFUND (execution_refund_id set): a
 *     payout landing on such a job later is not what settled that dispute,
 *     and stamping it would say the helper was paid for it;
 *   - one row, by id: the newest decided row (a re-filed job can carry an
 *     older one), never a job-wide UPDATE;
 *   - `.select("id")` on the write, so a zero-row match is seen, not assumed.
 *
 * It never throws and never blocks: the money has already moved and
 * payout_transfers records it. A failure is returned for the caller to log
 * and alert on.
 */

export type DisputeStampResult =
  | { outcome: "stamped"; disputeId: string }
  | { outcome: "none" }
  | { outcome: "raced"; disputeId: string }
  | { outcome: "error"; message: string; disputeId?: string };

// deno-lint-ignore no-explicit-any
type Client = { from: (t: string) => any };

export async function stampDisputePayout(
  supabaseAdmin: Client,
  args: { jobId: string; transferId: string; helperCents: number },
): Promise<DisputeStampResult> {
  try {
    const { data, error } = await supabaseAdmin
      .from("disputes")
      .select("id, execution_transfer_id, execution_helper_cents")
      .eq("job_id", args.jobId)
      .eq("status", "decided")
      .eq("execution_status", "executed")
      .is("execution_transfer_id", null)
      .is("execution_helper_cents", null)
      .is("execution_refund_id", null)
      .order("decided_at", { ascending: false })
      .limit(1);
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      // No disputes table: there is no row that could need a stamp.
      if (code === "42P01" || code === "PGRST205") return { outcome: "none" };
      return { outcome: "error", message: (error as { message?: string }).message ?? "dispute read failed" };
    }
    const row = (data as Array<{ id: string }> | null)?.[0];
    if (!row) return { outcome: "none" };

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("disputes")
      .update({
        execution_transfer_id: args.transferId,
        execution_helper_cents: args.helperCents,
      })
      .eq("id", row.id)
      .is("execution_transfer_id", null)
      .is("execution_helper_cents", null)
      .select("id");
    if (upErr) {
      return {
        outcome: "error",
        disputeId: row.id,
        message: (upErr as { message?: string }).message ?? "dispute stamp failed",
      };
    }
    // Zero rows: someone stamped it between our read and our write. Their
    // stamp stands; ours is not forced over it.
    if (!Array.isArray(updated) || updated.length === 0) return { outcome: "raced", disputeId: row.id };
    return { outcome: "stamped", disputeId: row.id };
  } catch (e) {
    return { outcome: "error", message: (e as Error).message ?? String(e) };
  }
}
