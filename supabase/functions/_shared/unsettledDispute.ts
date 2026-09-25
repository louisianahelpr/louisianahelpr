/**
 * The one question every payout path must ask before it moves money:
 * has this job's dispute decision actually been settled?
 *
 * `rpc_decide_dispute` records the decision and, in the same transaction,
 * sets jobs.status='completed' and jobs.dispute_status='resolved' — while the
 * escrow is untouched and `disputes.execution_status` is 'pending'. So the two
 * markers a payout path naturally reaches for both say "closed, pay it", and
 * the only column that knows the truth is on the `disputes` row.
 *
 * Measured on prod 2026-09-08: job bb2c3732 (dispute c7a12050, decided 50/50)
 * carried status='completed', dispute_status='resolved', payment_status
 * ='escrow'. `release-payout`'s existing dispute guard admits exactly that
 * shape — dispute_status 'resolved' is on its allow-list — so a full 88%
 * transfer would have gone out on a job whose decision awards the helper 50%,
 * and a later "Retry settlement" would then have refunded and transferred on
 * top of it. Double-settle, from one admin click.
 *
 * The check is deliberately its own read rather than a column on `jobs`: the
 * authoritative state lives on `disputes`, and a job that has been disputed
 * twice (a re-file) must be blocked while ANY decided row is unexecuted.
 *
 * FAIL CLOSED. A read error here means we do not know whether a decision is
 * waiting, and the cost of guessing wrong is a real transfer on top of a real
 * refund. Callers must treat `{ blocked: true }` from an errored read as a
 * refusal, not a retryable nothing — which is why the error is returned in the
 * same shape as a genuine block rather than thrown.
 */

export type UnsettledDisputeCheck = {
  /** True when payout must not proceed — either a real unsettled decision, or an unreadable answer. */
  blocked: boolean;
  /** Set when the block is a genuine decided-but-unexecuted dispute. */
  dispute?: { id: string; execution_status: string | null; payout_split: unknown };
  /** Set when the block is a failed read (fail-closed), carrying the real cause. */
  readError?: string;
  /** Set when the block is a held (or dead holder's) dispute settlement claim. */
  claim?: { action: string; claimed_at: string };
};

/**
 * Look for a decided dispute on `jobId` whose split has not executed.
 *
 * `execution_status IS NULL` counts as unsettled for the same reason
 * AdminDisputes' `.or` admits NULL: a row predating the execution-column
 * backfill (20260907194838) must not read as settled just because nobody has
 * stamped it yet.
 */
export async function checkUnsettledDispute(
  supabaseAdmin: { from: (t: string) => any },
  jobId: string,
  opts: { crewFanout?: boolean } = {},
): Promise<UnsettledDisputeCheck> {
  // `crewFanout`: ONLY process-scheduled-payouts, and only for a group job.
  // A crew decision (rpc_decide_crew_dispute, 20260925234055) is recorded with
  // execution_status 'crew_fanout': it is settled BY that cron's per-member
  // fan-out, so it must not block the one path that executes it. Every other
  // caller still reads it as decided-unexecuted and refuses (a single-helper
  // release of a crew decision would pay over the per-member outcomes).
  const unsettled = opts.crewFanout
    ? "execution_status.is.null,and(execution_status.neq.executed,execution_status.neq.crew_fanout)"
    : "execution_status.is.null,execution_status.neq.executed";
  const { data, error } = await supabaseAdmin
    .from("disputes")
    .select("id, execution_status, payout_split")
    .eq("job_id", jobId)
    .eq("status", "decided")
    .or(unsettled)
    .limit(1);

  if (error) {
    // 42P01/PGRST205 (table not deployed) is the ONE tolerable failure: there
    // can be no dispute rows on a database that has no disputes table, so
    // there is nothing this check could have blocked. Everything else —
    // including 42703, a missing execution column, which would mean we cannot
    // tell settled from unsettled — is a refusal.
    const code = String((error as { code?: string }).code ?? "");
    if (code === "42P01" || code === "PGRST205") return { blocked: false };
    return {
      blocked: true,
      readError: (error as { message?: string }).message ?? "dispute settlement check failed",
    };
  }

  const row = (data as Array<{ id: string; execution_status: string | null; payout_split: unknown }> | null)?.[0];
  if (row) return { blocked: true, dispute: row };

  // A dispute settlement claim (20260915034822) also blocks. A claim row means
  // an admin Quick Release / Quick Refund, the 72h sweep or a split is moving
  // this escrow right now — or died part-way and may already have moved it
  // (a release/refund/split claim stamped at its money step never expires). A
  // withdrawal can take the job out of `disputed` underneath either, and every payout path that reads
  // only its ledger (this module's callers) then paid a second time
  // (lh-money-escrow review, dispute-races round 3, H1). Missing table
  // (42P01/PGRST205, the migration not deployed yet) blocks nothing; any other
  // read failure is a refusal, like the decision read above.
  const { data: claims, error: claimErr } = await supabaseAdmin
    .from("dispute_settlement_claims")
    .select("action, claimed_at")
    .eq("job_id", jobId)
    .limit(1);
  if (claimErr) {
    const code = String((claimErr as { code?: string }).code ?? "");
    if (code === "42P01" || code === "PGRST205") return { blocked: false };
    return {
      blocked: true,
      readError: (claimErr as { message?: string }).message ?? "dispute settlement claim check failed",
    };
  }
  const claim = (claims as Array<{ action: string; claimed_at: string }> | null)?.[0];
  if (claim) return { blocked: true, claim };
  return { blocked: false };
}
