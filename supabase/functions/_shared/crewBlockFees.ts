/**
 * Q1390 (owner 2026-10-07, decision (a)): a poster who blocks a COMMITTED crew
 * member close to the start owes that member a cancellation fee on their share
 * (poster_cancel_job's crew ladder). block_user_and_settle records it in
 * public.crew_block_fees and closes that spot (nobody is hired into it again);
 * the fee is paid HERE, from the job's own escrow, when the job settles:
 *   - process-scheduled-payouts, before the crew's unfilled shares are
 *     refunded (the fee comes out of the closed spot's share), and
 *   - void-cancelled-payments, when the job is cancelled instead (the fee is
 *     withheld from the poster's refund like the rest of the crew's fees).
 * Both callers withhold every row that is not 'void' from the poster's refund
 * and never wait on it (lh-money-escrow review): a fee that cannot go now (a
 * payout hold, no payout account) is retried every run by
 * void-cancelled-payments Part F once the job has settled.
 *
 * Exactly once: the Stripe idempotency key is the ledger row's id, Stripe's
 * transfer group for the job is listed first (a transfer already out repairs
 * the ledger instead of paying again), and the ledger flip is guarded on the
 * row not already being 'paid'.
 */
import type Stripe from "https://esm.sh/stripe@18.5.0";
import { readHelperFeePercentStrict, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { checkPayoutHold } from "../_shared/payoutHold.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { formatPayoutDollars, roundPayoutDownCents } from "../_shared/money.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

const CREW_BLOCK_FEE_TRANSFER_TYPE = "crew_block_fee";

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
 * Pay every unpaid row. `allPaid` is true only when no row is left 'owed' or
 * 'failed'. `chargeId` links each transfer to the job's charge (null for a
 * gift-funded job, which pays from the platform balance).
 */
export async function payCrewBlockFees(
  /** `settled`: the job's refund has already gone (the void-cancelled sweep). */
  deps: { stripe: Stripe; admin: Db; fn: string; settled?: boolean },
  job: { id: string; title?: string | null; helper_fee_percent?: number | string | null },
  rows: CrewBlockFeeRow[],
  chargeId: string | null,
): Promise<{ allPaid: boolean; problems: string[] }> {
  const { stripe, admin, fn } = deps;
  const problems: string[] = [];
  const unpaid = rows.filter((r) => r.status === "owed" || r.status === "failed");
  if (unpaid.length === 0) return { allPaid: true, problems };

  const feeGroup = `job_${job.id}`;
  let prior: Map<string, string>;
  try {
    const listed = await stripe.transfers.list({ transfer_group: feeGroup, limit: 100 });
    prior = new Map(
      listed.data
        .filter((t) => t.metadata?.type === CREW_BLOCK_FEE_TRANSFER_TYPE && !t.reversed && t.metadata?.block_fee_id)
        .map((t) => [String(t.metadata.block_fee_id), t.id]),
    );
  } catch (e) {
    // Fail CLOSED: without the list, any transfer may be a second one.
    problems.push(`crew block fee dedupe list ${job.id}: ${caughtMessage(e)}`);
    return { allPaid: false, problems };
  }

  const mark = async (row: CrewBlockFeeRow, patch: Record<string, unknown>, stage: string) => {
    const { data, error } = await admin
      .from("crew_block_fees")
      .update(patch)
      .eq("id", row.id)
      .neq("status", "paid")
      .select("id");
    if (error || !data || data.length === 0) {
      const why = error?.message ?? "zero rows";
      problems.push(`crew block fee ledger ${row.id} ${stage}: ${why}`);
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Crew block-fee ledger out of step with Stripe",
        message: `A crew block fee for job ${job.id} ${stage}, but crew_block_fees was not updated. Stripe's transfer group still stops a second payment; reconcile the row by hand.`,
        fields: { job_id: job.id, block_fee_id: row.id, stage, db_error: why.slice(0, 200), fn },
      });
      return false;
    }
    // The caller prices the refund from these rows after this returns.
    Object.assign(row, patch);
    return true;
  };

  let allPaid = true;
  for (const row of unpaid) {
    const feeDollars = Number(row.fee_cents) / 100;
    if (!row.helper_id) {
      // The member deleted their account: nobody to pay. The fee is not
      // withheld from the poster (void rows are left out of crewBlockFeeCents).
      if (!(await mark(row, { status: "void", failure_reason: "member account deleted" }, "was voided (member account deleted)"))) allPaid = false;
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "warning",
        title: "Crew block fee has no recipient",
        message: deps.settled
          ? "A crew member owed a block fee deleted their account before it was paid, after the job settled with the fee withheld from the poster's refund. Refund the poster that amount by hand."
          : "A crew member owed a block fee deleted their account before it was paid. The fee is no longer withheld; the poster's refund includes it.",
        fields: { job_id: job.id, block_fee_id: row.id, amount: feeDollars, fn },
      });
      continue;
    }
    const existing = prior.get(row.id);
    if (existing) {
      const ok = await mark(row, { status: "paid", stripe_transfer_id: existing, paid_at: new Date().toISOString(), failure_reason: null }, "was already paid in Stripe");
      if (!ok) allPaid = false;
      continue;
    }
    const hold = await checkPayoutHold(admin, row.helper_id);
    if (hold.kind === "error") {
      problems.push(`crew block fee hold check ${row.id}: ${hold.message}`);
      allPaid = false;
      continue;
    }
    if (hold.kind === "held") {
      // An outcome, not a defect: the job waits until the hold is released.
      allPaid = false;
      continue;
    }
    const frozen = job.helper_fee_percent === null || job.helper_fee_percent === undefined ? NaN : Number(job.helper_fee_percent);
    const feeRead = await readHelperFeePercentStrict(admin, row.helper_id, Number.isFinite(frozen) ? frozen : DEFAULT_TIER_FEE_PERCENT);
    if (!feeRead.ok) {
      problems.push(`crew block fee tier read ${row.id}: ${feeRead.error}`);
      allPaid = false;
      continue;
    }
    const platformCut = Math.round(feeDollars * (feeRead.percent / 100) * 100) / 100;
    // Whole dollars, rounded DOWN; the platform keeps the cents (Q236).
    const payoutCents = roundPayoutDownCents(Math.round((feeDollars - platformCut) * 100));
    const { data: prof, error: profErr } = await admin
      .from("profiles")
      .select("stripe_account_id")
      .eq("user_id", row.helper_id)
      .maybeSingle();
    if (profErr || !prof?.stripe_account_id || !(payoutCents > 0)) {
      const why = profErr ? `profile read failed: ${profErr.message}` : !prof?.stripe_account_id ? "no payout account" : "nothing left after commission";
      allPaid = false;
      if (row.status === "failed") continue; // paged once already; retried every run
      problems.push(`crew block fee ${row.id}: ${why}`);
      await mark(row, { status: "failed", failure_reason: why.slice(0, 200) }, `could not be paid (${why})`);
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "warning",
        title: "Crew block fee not paid",
        message: "A crew member's block fee could not be sent. The job keeps its escrow and the next run retries; fix the cause or pay it by hand.",
        fields: { job_id: job.id, block_fee_id: row.id, helper_id: row.helper_id, amount: payoutCents / 100, reason: why.slice(0, 200), fn },
      });
      continue;
    }
    try {
      const params: Record<string, unknown> = {
        amount: payoutCents,
        currency: "usd",
        destination: prof.stripe_account_id,
        transfer_group: feeGroup,
        metadata: { job_id: job.id, helper_id: row.helper_id, block_fee_id: row.id, type: CREW_BLOCK_FEE_TRANSFER_TYPE, platform_cut: platformCut },
      };
      if (chargeId) params.source_transaction = chargeId;
      const transfer = await stripe.transfers.create(params as unknown as Stripe.TransferCreateParams, {
        idempotencyKey: `crew-block-fee-${row.id}`,
      });
      const ok = await mark(row, { status: "paid", stripe_transfer_id: transfer.id, paid_at: new Date().toISOString(), failure_reason: null }, `was paid (${transfer.id})`);
      if (!ok) allPaid = false;
      await insertNotifications(admin, {
        user_id: row.helper_id,
        job_id: job.id,
        title: "Cancellation fee received",
        message: `You received a $${formatPayoutDollars(payoutCents / 100)} cancellation fee for "${job.title ?? "a job"}" (${feeRead.percent}% commission deducted).`,
        type: "payment",
        link: "/profile?tab=earnings",
      });
    } catch (e) {
      allPaid = false;
      const msg = caughtMessage(e).slice(0, 200);
      if (row.status === "failed") continue;
      problems.push(`crew block fee transfer ${row.id}: ${msg}`);
      await mark(row, { status: "failed", failure_reason: msg }, `transfer failed (${msg.slice(0, 80)})`);
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "warning",
        title: "Crew block fee transfer failed",
        message: "A crew member's block fee transfer failed. The job keeps its escrow and the next run retries.",
        fields: { job_id: job.id, block_fee_id: row.id, helper_id: row.helper_id, amount: payoutCents / 100, error: msg, fn },
      });
    }
  }
  return { allPaid, problems };
}
