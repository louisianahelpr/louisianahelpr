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
import { releaseUnsentClaim } from "./payoutClaim.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js rpc builder (thenable), as in heldTipRepay.ts
type Db = { rpc: (fn: string, args: Record<string, unknown>) => any };

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
  const cap = Math.max(0, Math.floor(maxCents));
  const cents = Math.round(Number(data ?? 0));
  if (!Number.isFinite(cents) || cents < 0) {
    return { error: `take_helpr_fault_fee returned ${String(data)} (cap ${maxCents})` };
  }
  if (cents > cap) {
    // Q2172 (d): a retry whose cap shrank (the setup fee owed on this run, or
    // the exact-cents cap) gets the first, larger answer. Give the excess back
    // (clamp_helpr_fault_fee, migration 20261102080407) instead of refusing
    // forever; what stays booked is what this payout withholds.
    return clampHelprFaultFee(supabaseAdmin, helperId, jobId, cap);
  }
  return { cents };
}

/**
 * Q2172 (c)/(d): gives back whatever this job's payout booked above `cents`
 * (newest debt first) and returns what stays booked, which is never more than
 * `cents`. Fails CLOSED (an error refuses the payout); the database refuses
 * once a paid payout carries the deduction.
 */
async function clampHelprFaultFee(
  supabaseAdmin: Db,
  helperId: string,
  jobId: string,
  cents: number,
): Promise<{ cents: number; error?: undefined } | { cents?: undefined; error: string }> {
  const want = Math.max(0, Math.floor(cents));
  const { data, error } = await supabaseAdmin.rpc("clamp_helpr_fault_fee", {
    p_helper_id: helperId,
    p_job_id: jobId,
    p_cents: want,
  });
  if (error) return { error: `clamp_helpr_fault_fee failed: ${error.message ?? String(error)}` };
  const kept = Math.round(Number(data ?? 0));
  if (!Number.isFinite(kept) || kept < 0 || kept > want) {
    return { error: `clamp_helpr_fault_fee returned ${String(data)} (cap ${want})` };
  }
  return { cents: kept };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js query builder, as in payoutClaim.ts
type DbWithTables = Db & { from: (t: string) => any };

/**
 * Q2172 (c), lead 11-02 (C1): a run that RESUMES (or adopts) another run's
 * open payout claim never takes the debt again. It reads what that claim
 * recorded it withholds (metadata.helpr_fault_fee_cents; absent = 0) and
 * clamps the job's booked deductions to it, so a debt billed in between is
 * never booked as collected by a transfer that did not withhold it. Fails
 * CLOSED: an unreadable claim, a failed clamp, or fewer cents booked than the
 * claim withholds (the Helpr would be charged twice) refuses the payout.
 */
export async function resumedClaimHelprFaultFee(
  supabaseAdmin: DbWithTables,
  helperId: string,
  jobId: string,
  claimId: string,
): Promise<{ cents: number; error?: undefined } | { cents?: undefined; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("payout_transfers")
    .select("id, metadata")
    .eq("id", claimId);
  if (error) return { error: `claim ${claimId} read failed: ${error.message ?? String(error)}` };
  const row = ((data ?? []) as Array<{ id?: string; metadata?: Record<string, unknown> | null }>).find((r) => r.id === claimId);
  if (!row) return { error: `claim ${claimId} not found` };
  const raw = row.metadata?.helpr_fault_fee_cents ?? 0;
  const stored = Math.round(Number(raw));
  if (!Number.isFinite(stored) || stored < 0) return { error: `claim ${claimId} records helpr_fault_fee_cents ${String(raw)}` };
  const clamped = await clampHelprFaultFee(supabaseAdmin, helperId, jobId, stored);
  if (clamped.error !== undefined) return clamped;
  if (clamped.cents !== stored) {
    return { error: `claim ${claimId} withholds ${stored} cents but only ${clamped.cents} are booked; reconcile by hand` };
  }
  return { cents: stored };
}

/**
 * Q2172 (c), lead 11-02 (C1): the fresh claim was written BEFORE the debt was
 * taken, with the payout before the debt; once taken, the claim is stamped
 * with what its transfer will carry and withhold, so a run that later resumes
 * or adopts it reads the right numbers. Guarded on the claim still being an
 * unsent pending claim; zero rows is a failure.
 */
export async function stampClaimHelprFaultFee(
  supabaseAdmin: DbWithTables,
  claimId: string,
  patch: { amountCents: number; metadata: Record<string, unknown> },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabaseAdmin
    .from("payout_transfers")
    .update({ amount_cents: patch.amountCents, metadata: { ...patch.metadata, claim: true } })
    .eq("id", claimId)
    .eq("status", "pending")
    .is("stripe_transfer_id", null)
    .select("id");
  if (error) return { ok: false, message: error.message ?? String(error) };
  if (!data || data.length === 0) return { ok: false, message: "claim row was no longer an unsent pending claim" };
  return { ok: true };
}

/** Gives the withheld debt back; logged loudly when it cannot (never silent). */
export async function restoreHelprFaultFee(supabaseAdmin: Db, helperId: string, jobId: string, source: string): Promise<void> {
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
 * Q2245 (owner MASTER-LIST 2026-10-21): a series visit whose Helpr's setup
 * lapsed after it was paid is refunded to the poster IN FULL, and the Helpr
 * owes that charge's card fee, taken from their NEXT payout by the same
 * take/restore pair as above (migration 20261102072106). Bills the visit
 * payment's own Helpr once (bill_helpr_card_fee_debt is idempotent on the
 * visit payment, so a re-run bills nothing).
 *
 * Returns the cents billed by THIS call (0 for a replay or nothing to bill:
 * an unreadable or zero fee) with problem null, else the problem. Fails
 * CLOSED: the caller refunds nothing this run on a problem, so a refund never
 * goes out with the debt unrecorded. A database without the function yet
 * (PGRST202) is a problem too: the row waits a run.
 */
export async function billLapsedHelprCardFee(
  supabaseAdmin: Db,
  visitPaymentId: string,
  cardFeeCents: number,
  refundRef: string,
): Promise<{ problem: string | null; billedCents: number }> {
  const cents = Math.round(Number(cardFeeCents));
  if (!Number.isFinite(cents) || cents <= 0) return { problem: null, billedCents: 0 };
  const { data, error } = await supabaseAdmin.rpc("bill_helpr_card_fee_debt", {
    p_visit_payment_id: visitPaymentId,
    p_card_fee_cents: cents,
    p_refund_ref: refundRef,
  });
  if (error) return { problem: `billing the lapsed Helpr ${cents} cents failed (${error.message ?? String(error)})`, billedCents: 0 };
  const billed = Number(data ?? 0);
  if (!Number.isFinite(billed) || billed < 0 || billed > cents) {
    return { problem: `bill_helpr_card_fee_debt returned ${String(data)} for ${cents} cents`, billedCents: 0 };
  }
  return { problem: null, billedCents: billed };
}

/**
 * Q2172 (c): the step after a FRESH claim failed and nothing was sent. The
 * claim is released ('canceled'), then whatever this job's payout booked goes
 * back (restore refuses while a pending claim exists, so the order matters).
 * If the release fails the claim stays pending without a recorded fee; the
 * run that resumes it reads 0 and clamps the booking to 0, so the debt is
 * never read as collected. Logged loudly, never silent.
 */
export async function releaseClaimAndRestoreFaultFee(
  supabaseAdmin: DbWithTables,
  claimId: string,
  helperId: string,
  jobId: string,
  reason: string,
  source: string,
): Promise<void> {
  const released = await releaseUnsentClaim(supabaseAdmin, claimId, reason);
  if (!released.ok) {
    console.error(`[${source}] could not release unsent claim ${claimId} for job ${jobId} (${released.message}); the next run resumes it and clamps the fee to what it recorded`);
    return;
  }
  await restoreHelprFaultFee(supabaseAdmin, helperId, jobId, source);
}
