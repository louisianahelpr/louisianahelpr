/**
 * Q2082 (b), owner 2026-10-18 ("J4"): a Helpr ruled at fault (admin ruling,
 * job_helpr_fault_rulings) owes the card cost of the poster's full refund.
 * It comes out of the Helpr's NEXT job payout, through the service_role-only
 * SQL pair in migration 20261019015303:
 *   take_helpr_fault_fee(helper, payout_ref, max_cents): what to keep back;
 *     a retry of the same payout returns the first answer, never takes twice.
 *   restore_helpr_fault_fee(helper, job): gives it back when the payout
 *     stops before any money moved (the exits that un-claim the onboarding
 *     fee); a no-op while another run's live payout row carries it.
 * The payout_ref is per JOB, shared by release-payout and
 * process-scheduled-payouts, so whichever pays it takes the debt once.
 *
 * Q2165 (owner, 2026-10-19): the debt is taken in EXACT CENTS. The payout is
 * first rounded down to whole dollars as always (Q236), THEN the debt comes
 * off it, so the transfer may carry cents and what it withholds is exactly
 * what the deduction rows book as collected. Every payout path writes it as
 * `roundPayoutDownCents(<payout before the debt>) - helprFaultFeeCents`; the
 * old `roundPayoutDownCents(x - debt)` withheld up to 99c more or less.
 */
import { roundPayoutDownCents } from "./money.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js rpc builder (thenable), as in heldTipRepay.ts
type Db = { rpc: (fn: string, args: Record<string, unknown>) => any; from?: (t: string) => any };

/** The payout every single-Helpr job path takes the debt under. */
function helprFaultPayoutRef(jobId: string): string {
  return `job_payout_${jobId}`;
}

/**
 * The most a payout may give up to the debt: everything above $1 of the
 * whole-dollar payout (roundPayoutDownCents of what it owes after its other
 * fees), so the transfer stays $1 or more. What is left of the debt waits
 * for the next payout. Q2165: the debt then comes off in exact cents.
 */
export function helprFaultFeeCapCents(unroundedAfterOtherFeesCents: number): number {
  const v = roundPayoutDownCents(Number(unroundedAfterOtherFeesCents)) - 100;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * The cents to withhold from this payout for the Helpr's fault debt, or an
 * error. Fails CLOSED: on an error the caller refuses the payout (and puts
 * its onboarding-fee claim back), so a debt is never skipped silently. A
 * database without the function yet (PGRST202, before db-deploy) withholds
 * nothing: the debt stays recorded and the next payout takes it.
 */
export async function takeHelprFaultFee(
  supabaseAdmin: Db,
  helperId: string,
  jobId: string,
  maxCents: number,
): Promise<{ cents: number; error?: undefined } | { cents?: undefined; error: string }> {
  const { data, error } = await supabaseAdmin.rpc("take_helpr_fault_fee", {
    p_helper_id: helperId,
    p_payout_ref: helprFaultPayoutRef(jobId),
    p_max_cents: Math.max(0, Math.floor(maxCents)),
  });
  if (error) {
    if (error.code === "PGRST202") return { cents: 0 };
    return { error: error.message ?? String(error) };
  }
  const cents = Math.round(Number(data ?? 0));
  if (!Number.isFinite(cents) || cents < 0 || cents > Math.max(0, Math.floor(maxCents))) {
    return { error: `take_helpr_fault_fee returned ${String(data)} (cap ${maxCents})` };
  }
  return { cents };
}

/**
 * Gives the withheld debt back; logged loudly when it cannot (never silent).
 * Stands down when an earlier attempt for this (job, Helpr) failed UNCLEARLY
 * (a failed payout_transfers row stamped helpr_fault_fee_kept_cents): that
 * transfer may be out with the fee held back, so a later run's early exit
 * must not hand the debt back for another payout to take again
 * (lh-money-escrow review of ab64957d4 #1). Fails closed: an unreadable
 * ledger keeps the deduction booked.
 */
export async function restoreHelprFaultFee(supabaseAdmin: Db, helperId: string, jobId: string, source: string): Promise<void> {
  if (supabaseAdmin.from) {
    const { data: failedRows, error: readErr } = await supabaseAdmin
      .from("payout_transfers")
      .select("id, status, metadata")
      .eq("job_id", jobId)
      .eq("helper_id", helperId)
      .eq("status", "failed");
    if (readErr) {
      console.error(`[${source}] Helpr-fault fee kept booked for job ${jobId}: the earlier attempts could not be read (${readErr.message ?? String(readErr)})`);
      return;
    }
    const kept = ((failedRows ?? []) as Array<{ status?: string; metadata?: Record<string, unknown> | null }>)
      .some((r) => r.status === "failed" && Number(r.metadata?.helpr_fault_fee_kept_cents ?? 0) > 0);
    if (kept) {
      console.warn(`[${source}] Helpr-fault fee kept booked for job ${jobId}: an earlier transfer attempt failed unclearly and may be out`);
      return;
    }
  }
  const { error } = await supabaseAdmin.rpc("restore_helpr_fault_fee", {
    p_helper_id: helperId,
    p_job_id: jobId,
  });
  if (error && error.code !== "PGRST202") {
    console.error(
      `CRITICAL: [${source}] payout did not proceed AND the Helpr-fault card fee withheld for job ${jobId} could not be given back (helper ${helperId}): the debt reads paid but was NOT collected; manual reconciliation needed:`,
      error,
    );
  }
}

/**
 * Once money has moved: make what this job's payout BOOKS as withheld equal
 * what its transfer actually withheld (set_helpr_fault_fee_withheld,
 * migration 20261019043252). Closes the gaps between the take before the
 * transfer and the money (lh-money-escrow reviews of c4ec33afb #5, b1730c932
 * #3, the exact-cents delta #7): another run restoring the deduction while
 * this run's transfer withheld it (the Helpr would owe it again), and an
 * adopted orphan transfer that withheld a different figure than this run took.
 * Never blocks the payout (the money is out); returns a problem to page, or
 * null. A database without the function yet (PGRST202) books nothing new.
 */
export async function recordHelprFaultFeeWithheld(
  supabaseAdmin: Db,
  helperId: string,
  jobId: string,
  withheldCents: number,
): Promise<string | null> {
  const want = Math.max(0, Math.round(Number(withheldCents) || 0));
  const { data, error } = await supabaseAdmin.rpc("set_helpr_fault_fee_withheld", {
    p_helper_id: helperId,
    p_payout_ref: helprFaultPayoutRef(jobId),
    p_cents: want,
  });
  if (error) {
    if (error.code === "PGRST202") {
      if (want > 0) console.warn(`[helprFaultFee] set_helpr_fault_fee_withheld not deployed yet: job ${jobId}'s ${want}c booking not re-checked`);
      return null;
    }
    return `the Helpr-fault card fee withheld (${want}c) could not be booked for job ${jobId}: ${error.message ?? String(error)}`;
  }
  const booked = Math.round(Number(data ?? 0));
  if (booked !== want) {
    return `job ${jobId}'s payout withheld ${want}c for a Helpr-fault card fee but only ${booked}c is owed: pay the Helpr back the difference`;
  }
  return null;
}

/**
 * The job ENDED with no payout that kept the debt (a full refund; a transfer
 * fully reversed by a lost card dispute or by hand): give every Helpr's
 * deduction on its payout back, so a fee nothing withheld never reads
 * collected (owner rule: never absorb a fee). restore_helpr_fault_fee_for_job
 * (20261019043251) itself refuses unless the job is refunded or holds a fully
 * reversed transfer, and keeps anything a pending/paid/partly reversed payout
 * still carries; what it cannot give back is paged by money-reconciliation
 * (helpr_fault_deduction_not_collected). Never throws: the refund or reversal
 * already happened in Stripe, so a failure is logged CRITICAL and left to that
 * check. Not for a reversal a won dispute repays (the repay is net of the fee).
 */
export async function restoreHelprFaultFeeForJob(supabaseAdmin: Db, jobId: string, source: string): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin.rpc("restore_helpr_fault_fee_for_job", { p_job_id: jobId });
    if (error) {
      if (error.code === "PGRST202") {
        console.warn(`[${source}] restore_helpr_fault_fee_for_job not deployed yet: job ${jobId}'s Helpr-fault deduction not re-checked`);
      } else {
        console.error(
          `CRITICAL: [${source}] job ${jobId} ended with no payout, and the Helpr-fault card fee its payout attempt withheld could not be given back: the debt reads collected but nothing was withheld; money-reconciliation will page it:`,
          error,
        );
      }
      return 0;
    }
    const cents = Math.round(Number(data ?? 0));
    return Number.isFinite(cents) && cents > 0 ? cents : 0;
  } catch (e) {
    console.error(`CRITICAL: [${source}] restore_helpr_fault_fee_for_job threw for job ${jobId}; money-reconciliation will page it:`, e);
    return 0;
  }
}

/**
 * The Helpr's payout notice names a Helpr-fault card fee it deducted, in exact
 * cents (lh-money-escrow re-review of b1730c932 #7: the Quick Release and
 * dispute-split notices said nothing). "" when nothing was deducted. The
 * amount comes from the payout's own ledger row (metadata.helpr_fault_fee_cents).
 */
export function helprFaultDeductionNote(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "";
  return ` A $${(Math.round(cents) / 100).toFixed(2)} card fee from a job you were ruled at fault on was deducted from it.`;
}

/** What a payout_transfers row's metadata says this payout withheld for a Helpr-fault card fee (0 when none). */
export function helprFaultFeeFromMetadata(metadata: unknown): number {
  const v = Number((metadata as { helpr_fault_fee_cents?: unknown } | null | undefined)?.helpr_fault_fee_cents);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}
