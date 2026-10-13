/**
 * The READ-ONLY half of the Q1390 crew block fees: the ledger row shape, the
 * read, the cents that come out of the poster's money, and Q1490's refusal of
 * an admin full refund. Nothing here moves money.
 *
 * Split out of _shared/crewBlockFees.ts (2026-10-13) so a path that only READS
 * the fees (create-payment's admin full refund, which refuses rather than
 * pays) does not import the module that PAYS them. That module is
 * "shared-guarded" in src/test/decidedDisputeEscrowOnlyMovedBySplit.test.ts
 * (Q231): every file importing it must be an unsettled-dispute-check path, and
 * create-payment is checked per action instead, so its import of the payer
 * broke the guard. Zero imports: the edge harness serves the real module.
 */

export interface CrewBlockFeeRow {
  id: string;
  job_id: string;
  helper_id: string | null;
  slot_no: number;
  share_basis_cents: number;
  fee_percent: number;
  fee_cents: number;
  status: "owed" | "paid" | "failed" | "void";
  stripe_transfer_id: string | null;
}

// deno-lint-ignore no-explicit-any
type Db = any;

const isMissingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" ||
    /relation "[^"]*crew_block_fees[^"]*" does not exist|could not find the table '[^']*crew_block_fees'/i.test(e.message ?? ""));

/** The job's block-fee rows. Before the migration deploys there are none. */
export async function readCrewBlockFees(
  admin: Db,
  jobId: string,
): Promise<{ ok: true; rows: CrewBlockFeeRow[] } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("crew_block_fees")
    .select("id, job_id, helper_id, slot_no, share_basis_cents, fee_percent, fee_cents, status, stripe_transfer_id")
    .eq("job_id", jobId);
  if (error) return isMissingTable(error) ? { ok: true, rows: [] } : { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as CrewBlockFeeRow[] };
}

/** The fee cents that come out of the poster's money: every row but a void one. */
export function crewBlockFeeCents(rows: CrewBlockFeeRow[]): number {
  return rows.filter((r) => r.status !== "void").reduce((s, r) => s + Math.max(0, Number(r.fee_cents) || 0), 0);
}

/**
 * Q1490: why an admin FULL refund of this job must be refused, or null.
 *
 * A crew member the poster blocked is owed a fee out of this job's escrow
 * (every row but a void one, paid ones included: that money already left to
 * them from this charge). A full refund would give the poster that money too,
 * and Part F of void-cancelled-payments would then pay an unpaid fee from the
 * platform's balance. Cancelling the job instead withholds the fee from the
 * refund (void-cancelled-payments). Fails CLOSED: a read error refuses too.
 */
export async function crewBlockFeeRefusal(
  admin: Db,
  job: { id: string; is_group_job?: boolean | null },
  /** Which admin action asked: its way out differs (review of Q1490 #5). */
  action: "general" | "dispute" = "general",
): Promise<{ status: number; error: string; cents: number } | null> {
  if (!job.is_group_job) return null;
  const read = await readCrewBlockFees(admin, job.id);
  if (!read.ok) {
    return { status: 503, cents: 0, error: `Couldn't check whether a blocked crew member is owed a fee on this job (${read.error}). No money was moved; try again.` };
  }
  const cents = crewBlockFeeCents(read.rows);
  if (cents <= 0) return null;
  return {
    status: 409,
    cents,
    error: action === "dispute"
      ? `A crew member blocked by the person who posted this job is owed a $${(cents / 100).toFixed(2)} cancellation fee from this job's payment, so this dispute can't be refunded in full. No money was moved. Decide the dispute for each crew member instead.`
      : `A crew member blocked by the person who posted this job is owed a $${(cents / 100).toFixed(2)} cancellation fee from this job's payment, so it can't be refunded in full. No money was moved. Cancel the job instead (everything but that fee goes back to whoever paid), or refund a partial amount.`,
  };
}
