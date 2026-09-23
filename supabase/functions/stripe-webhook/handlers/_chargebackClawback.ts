// seed-policy: pages for seed/E2E jobs too, on purpose (same rule as every
// money handler in this directory): a reversal or re-payment Stripe refused is
// money that did not move, whoever owns the job.
//
// CARD-DISPUTE CLAW BACK (owner decision 2026-09-23 by pop-up, docs/OPEN.md Q202).
//
// Charges are separate charges + transfers: the poster's card pays the
// platform, and the Helpr is paid later by a transfer with
// `transfer_group: job_<id>`. When the cardholder disputes the charge, Stripe
// withdraws the disputed amount (plus a ~$15 fee) from the PLATFORM. Before
// this file, charge.dispute.created only blocked a payout that had not gone out
// yet; once a job was `released` the Helpr kept the money and the platform
// lost it all.
//
// Now:
//   created (a real chargeback, never an inquiry) on a RELEASED job →
//     reverse the Helpr's transfer(s) for the job, up to the disputed amount;
//   closed WON  → pay each reversed amount back to the same account;
//   closed LOST → the reversal stands.
// The Helpr is told each time, in-app.
//
// Every reversal and re-payment is keyed twice so it can never happen twice:
//   - a `chargeback_clawbacks` row per (dispute, transfer), claimed BEFORE the
//     Stripe call (unique on dispute_id + stripe_transfer_id), and
//   - Stripe's idempotency key `clawback-<dispute>-<transfer>` /
//     `clawback-repay-<dispute>-<transfer>`, with the SAME amount and metadata
//     on every retry (the amount is read back from the claimed row).
// A refusal from Stripe (the connected account's balance is short, the
// transfer was already reversed, ...) is recorded on the row and paged as a
// critical alert (the ops alert ledger). A transient Stripe failure (network,
// 5xx, rate limit) is thrown so the webhook answers 500 and Stripe redelivers.

import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

type Db = WebhookContext["supabase"];

export type ClawbackRow = {
  id: string;
  dispute_id: string;
  job_id: string;
  helper_id: string | null;
  stripe_transfer_id: string;
  stripe_account_id: string | null;
  transfer_amount_cents: number;
  reversed_cents: number;
  stripe_reversal_id: string | null;
  repay_transfer_id: string | null;
  status: string;
};

const ROW_COLS =
  "id, dispute_id, job_id, helper_id, stripe_transfer_id, stripe_account_id, transfer_amount_cents, reversed_cents, stripe_reversal_id, repay_transfer_id, status";

/** Row statuses that mean "this transfer's money is back with the platform". */
export const CLAWED_BACK_STATUSES = ["reversed", "repaying", "repay_failed", "kept"] as const;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Stripe failures worth a redelivery: the request may not have reached Stripe. */
function isTransientStripeError(err: unknown): boolean {
  const t = (err as { type?: string })?.type ?? "";
  return t === "StripeConnectionError" || t === "StripeAPIError" || t === "StripeRateLimitError";
}

function errMessage(err: unknown): string {
  return String((err as { message?: string })?.message ?? err).slice(0, 500);
}

export async function readClawbackRows(
  supabase: Db,
  disputeId: string,
): Promise<{ rows: ClawbackRow[]; error?: string }> {
  const { data, error } = await supabase
    .from("chargeback_clawbacks")
    .select(ROW_COLS)
    .eq("dispute_id", disputeId);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as ClawbackRow[] };
}

/**
 * Every payout transfer for this job, from Stripe (transfer_group job_<id>)
 * and from the payout_transfers ledger (a transfer the group list does not
 * carry is retrieved by id). Oldest first.
 */
async function jobTransfers(
  stripe: Stripe,
  supabase: Db,
  jobId: string,
): Promise<{ transfers: Stripe.Transfer[]; helperByTransfer: Map<string, string | null>; error?: string }> {
  const helperByTransfer = new Map<string, string | null>();
  const { data: ledger, error: ledgerErr } = await supabase
    .from("payout_transfers")
    .select("stripe_transfer_id, helper_id, status")
    .eq("job_id", jobId);
  if (ledgerErr) return { transfers: [], helperByTransfer, error: `payout_transfers: ${ledgerErr.message}` };
  for (const r of (ledger ?? []) as Array<{ stripe_transfer_id: string | null; helper_id: string | null }>) {
    if (r.stripe_transfer_id) helperByTransfer.set(r.stripe_transfer_id, r.helper_id ?? null);
  }

  const byId = new Map<string, Stripe.Transfer>();
  const grouped = await stripe.transfers.list({ transfer_group: `job_${jobId}`, limit: 100 });
  for (const t of grouped?.data ?? []) byId.set(t.id, t);
  for (const id of helperByTransfer.keys()) {
    if (!byId.has(id)) byId.set(id, await stripe.transfers.retrieve(id));
  }
  const transfers = [...byId.values()].sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  return { transfers, helperByTransfer };
}

async function helperForAccount(supabase: Db, accountId: string | null): Promise<string | null> {
  if (!accountId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

async function setRow(supabase: Db, id: string, patch: Record<string, unknown>, where: { status: string[] }) {
  return await supabase
    .from("chargeback_clawbacks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", where.status)
    .select("id");
}

export type ClawbackResult = {
  /** Cents reversed by THIS run (new reversals only). */
  reversedNowCents: number;
  /** Cents reversed for this dispute in total, this run and earlier ones. */
  reversedTotalCents: number;
  /** Transfers Stripe refused to reverse, with why. */
  failed: Array<{ transferId: string; error: string }>;
  /** Payees newly reversed this run, with their amounts. */
  payees: Map<string, number>;
};

/**
 * Reverse the Helpr's transfer(s) for a RELEASED job whose charge is disputed,
 * up to the disputed amount. Idempotent per (dispute, transfer).
 *
 * Throws only for a DB failure or a transient Stripe failure, so the webhook
 * answers 500 and Stripe redelivers (the claimed rows make the redelivery
 * resume, never repeat). A Stripe refusal is recorded and paged instead.
 */
export async function clawBackReleasedPayout(
  { stripe, supabase, logStep }: WebhookContext,
  dispute: Stripe.Dispute,
  job: { id: string; title?: string | null },
  opts: { alertIfNoTransfer?: boolean } = {},
): Promise<ClawbackResult> {
  const result: ClawbackResult = { reversedNowCents: 0, reversedTotalCents: 0, failed: [], payees: new Map() };

  const existing = await readClawbackRows(supabase, dispute.id);
  if (existing.error) throw new Error(`chargeback_clawbacks read failed for ${dispute.id}: ${existing.error}`);
  const rowByTransfer = new Map(existing.rows.map((r) => [r.stripe_transfer_id, r]));

  const { transfers, helperByTransfer, error: listErr } = await jobTransfers(stripe, supabase, job.id);
  if (listErr) throw new Error(`Clawback transfer lookup failed for job ${job.id}: ${listErr}`);

  // Already clawed back for this dispute counts against the disputed amount.
  let remaining = Math.max(0, Number(dispute.amount) || 0);
  for (const r of existing.rows) {
    if ((CLAWED_BACK_STATUSES as readonly string[]).includes(r.status)) {
      remaining -= r.reversed_cents;
      result.reversedTotalCents += r.reversed_cents;
    }
  }

  for (const t of transfers) {
    if (remaining <= 0) break;
    let row = rowByTransfer.get(t.id);
    if (row && row.status !== "reversing" && row.status !== "reverse_failed") continue; // done, or final

    let amount: number;
    if (row) {
      // Resume with the SAME amount the claim recorded: Stripe's idempotency
      // key refuses a retry whose parameters differ.
      amount = row.reversed_cents;
    } else {
      const reversible = Math.max(0, (t.amount ?? 0) - (t.amount_reversed ?? 0));
      amount = Math.min(reversible, remaining);
      if (amount <= 0) continue;
      const destination = typeof t.destination === "string" ? t.destination : (t.destination as { id?: string } | null)?.id ?? null;
      const helperId = helperByTransfer.get(t.id) ?? (await helperForAccount(supabase, destination));
      const { data: claimed, error: claimErr } = await supabase
        .from("chargeback_clawbacks")
        .insert({
          dispute_id: dispute.id,
          job_id: job.id,
          helper_id: helperId,
          stripe_transfer_id: t.id,
          stripe_account_id: destination,
          transfer_amount_cents: t.amount ?? 0,
          reversed_cents: amount,
          status: "reversing",
        })
        .select(ROW_COLS);
      if (claimErr) {
        if ((claimErr as { code?: string }).code === "23505") {
          // Another delivery claimed it between our read and this insert.
          logStep("Clawback already claimed by a concurrent delivery", { disputeId: dispute.id, transferId: t.id });
          continue;
        }
        throw new Error(`chargeback_clawbacks claim failed for ${dispute.id}/${t.id}: ${claimErr.message}`);
      }
      row = ((claimed ?? []) as ClawbackRow[])[0];
      if (!row) throw new Error(`chargeback_clawbacks claim for ${dispute.id}/${t.id} returned no row`);
    }

    try {
      const reversal = await stripe.transfers.createReversal(
        t.id,
        {
          amount,
          metadata: { source: "chargeback-clawback", dispute_id: dispute.id, job_id: job.id },
        },
        { idempotencyKey: `clawback-${dispute.id}-${t.id}` },
      );
      const { data: done, error: doneErr } = await setRow(
        supabase,
        row.id,
        { status: "reversed", stripe_reversal_id: reversal.id, error: null },
        { status: ["reversing", "reverse_failed"] },
      );
      if (doneErr || !done || done.length === 0) {
        // The money moved; only the record lags. Page, do not throw: a throw
        // would redeliver, and the resume above would read the row as
        // 'reversing' and replay the same idempotent call, which is harmless,
        // but the page is what gets the record fixed.
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Card-dispute clawback — Stripe reversal done, ledger row NOT updated",
          message: `Transfer ${t.id} was reversed (${dollars(amount)}, reversal ${reversal.id}) for dispute ${dispute.id}, but chargeback_clawbacks row ${row.id} could not be marked 'reversed'. Set it by hand so a won dispute pays it back.`,
          fields: { "Dispute ID": dispute.id, "Job ID": job.id, "Transfer": t.id, "DB error": doneErr?.message ?? "matched 0 rows" },
          link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
        });
      }
      remaining -= amount;
      result.reversedNowCents += amount;
      result.reversedTotalCents += amount;
      if (row.helper_id) result.payees.set(row.helper_id, (result.payees.get(row.helper_id) ?? 0) + amount);
      logStep("Clawback: transfer reversed", { disputeId: dispute.id, transferId: t.id, amount, reversalId: reversal.id });
    } catch (err) {
      const message = errMessage(err);
      const { error: failErr } = await setRow(
        supabase,
        row.id,
        { status: "reverse_failed", error: message },
        { status: ["reversing", "reverse_failed"] },
      );
      if (failErr) logStep("Clawback: could not record the failure", { rowId: row.id, error: failErr.message });
      if (isTransientStripeError(err)) {
        throw new Error(`Clawback reversal of ${t.id} for dispute ${dispute.id} failed transiently: ${message}`);
      }
      result.failed.push({ transferId: t.id, error: message });
    }
  }

  if (result.failed.length > 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Card dispute on a PAID job — clawback REFUSED by Stripe",
      message: `Dispute ${dispute.id} (${dollars(dispute.amount)}) is on a job whose Helpr was already paid. Stripe refused to reverse ${result.failed.length} transfer(s), so the platform is carrying the loss. Most often the Helpr's Stripe balance is short: recover it by hand (Stripe Dashboard → Connect → the account) and mark the chargeback_clawbacks row.`,
      fields: {
        "Dispute ID": dispute.id,
        "Job ID": job.id,
        "Reversed so far": dollars(result.reversedTotalCents),
        "Refused": result.failed.map((f) => `${f.transferId}: ${f.error}`).join(" | ").slice(0, 900),
      },
      link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
      oncePerDayKey: `clawback-refused:${dispute.id}`,
    });
  }
  if (opts.alertIfNoTransfer !== false && transfers.length === 0 && existing.rows.length === 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Card dispute on a released job — no payout transfer found to reverse",
      message: `Dispute ${dispute.id} is on a job marked released, but no transfer with transfer_group job_${job.id} (and no payout_transfers row) was found. Reconcile the job's payout by hand.`,
      fields: { "Dispute ID": dispute.id, "Job ID": job.id },
      link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
    });
  }

  // Tell each payee, in-app. Role-neutral: it names the job and the money.
  for (const [userId, cents] of result.payees) {
    const { error: noteErr } = await supabase.from("notifications").insert({
      user_id: userId,
      title: "Payment disputed by the card holder",
      message: `The card used to pay for "${job.title ?? "a job"}" has been disputed with the bank, so the ${dollars(cents)} paid to you for it has been taken back while the bank reviews the dispute. If the dispute is decided in our favor, it is paid back to you automatically. Questions? Contact support.`,
      type: "payment",
      link: `/my-jobs?job=${job.id}`,
    });
    if (noteErr) logStep("Clawback: payee notification failed", { userId, error: noteErr.message });
  }
  return result;
}

export type RepayResult = { repaidNowCents: number; failed: Array<{ transferId: string; error: string }>; rows: number };

/**
 * Dispute WON: pay back every amount this dispute clawed back. Idempotent per
 * (dispute, transfer). Returns rows = how many clawback rows this dispute has.
 */
export async function repayClawback(
  { stripe, supabase, logStep }: WebhookContext,
  dispute: Stripe.Dispute,
  job: { id: string; title?: string | null },
): Promise<RepayResult> {
  const out: RepayResult = { repaidNowCents: 0, failed: [], rows: 0 };
  const { rows, error } = await readClawbackRows(supabase, dispute.id);
  if (error) throw new Error(`chargeback_clawbacks read failed for ${dispute.id}: ${error}`);
  out.rows = rows.length;
  const payees = new Map<string, number>();

  for (const row of rows) {
    if (!["reversed", "repaying", "repay_failed"].includes(row.status)) continue;
    if (!row.stripe_account_id || row.reversed_cents <= 0) {
      out.failed.push({ transferId: row.stripe_transfer_id, error: "no destination account or amount on the clawback row" });
      continue;
    }
    const { data: claimed, error: claimErr } = await setRow(
      supabase,
      row.id,
      { status: "repaying" },
      { status: ["reversed", "repaying", "repay_failed"] },
    );
    if (claimErr) throw new Error(`chargeback_clawbacks repay claim failed for ${row.id}: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) continue; // another delivery took it

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: row.reversed_cents,
          currency: "usd",
          destination: row.stripe_account_id,
          transfer_group: `job_${row.job_id}`,
          metadata: {
            source: "chargeback-repay",
            dispute_id: dispute.id,
            job_id: row.job_id,
            original_transfer_id: row.stripe_transfer_id,
          },
        },
        { idempotencyKey: `clawback-repay-${dispute.id}-${row.stripe_transfer_id}` },
      );
      const { error: doneErr } = await setRow(
        supabase,
        row.id,
        { status: "repaid", repay_transfer_id: transfer.id, error: null },
        { status: ["repaying"] },
      );
      if (doneErr) {
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Card dispute won — Helpr re-paid, ledger row NOT updated",
          message: `Transfer ${transfer.id} re-paid ${dollars(row.reversed_cents)} for dispute ${dispute.id}, but chargeback_clawbacks row ${row.id} could not be marked 'repaid'. Mark it by hand; do NOT pay it again.`,
          fields: { "Dispute ID": dispute.id, "Job ID": row.job_id, "DB error": doneErr.message },
          link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
        });
      }
      // The original transfer's ledger row was flipped to 'reversed' by the
      // transfer.reversed webhook. The money is back with the Helpr, so it is
      // no longer a hold (findInternalPayoutHold reads 'reversed' as one).
      const { error: clearErr } = await supabase
        .from("payout_transfers")
        .update({ status: "reversal_cleared" })
        .eq("stripe_transfer_id", row.stripe_transfer_id)
        .eq("status", "reversed")
        .select("id");
      if (clearErr) logStep("Clawback repay: payout_transfers clear failed", { transferId: row.stripe_transfer_id, error: clearErr.message });
      out.repaidNowCents += row.reversed_cents;
      if (row.helper_id) payees.set(row.helper_id, (payees.get(row.helper_id) ?? 0) + row.reversed_cents);
      logStep("Clawback repaid", { disputeId: dispute.id, transferId: transfer.id, amount: row.reversed_cents });
    } catch (err) {
      const message = errMessage(err);
      await setRow(supabase, row.id, { status: "repay_failed", error: message }, { status: ["repaying"] });
      if (isTransientStripeError(err)) {
        throw new Error(`Clawback repay for ${row.stripe_transfer_id} (dispute ${dispute.id}) failed transiently: ${message}`);
      }
      out.failed.push({ transferId: row.stripe_transfer_id, error: message });
    }
  }

  if (out.failed.length > 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Card dispute WON — paying the Helpr back FAILED",
      message: `Dispute ${dispute.id} was won, but ${out.failed.length} clawed-back amount(s) could not be paid back to the Helpr. They are owed the money: pay it by hand and mark the chargeback_clawbacks row 'repaid'.`,
      fields: {
        "Dispute ID": dispute.id,
        "Job ID": job.id,
        "Failed": out.failed.map((f) => `${f.transferId}: ${f.error}`).join(" | ").slice(0, 900),
      },
      link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
      oncePerDayKey: `clawback-repay-failed:${dispute.id}`,
    });
  }

  for (const [userId, cents] of payees) {
    const { error: noteErr } = await supabase.from("notifications").insert({
      user_id: userId,
      title: "Disputed payment returned to you",
      message: `The card dispute on "${job.title ?? "a job"}" was decided in our favor, so the ${dollars(cents)} taken back has been paid to you again.`,
      type: "payment",
      link: `/my-jobs?job=${job.id}`,
    });
    if (noteErr) logStep("Clawback repay: payee notification failed", { userId, error: noteErr.message });
  }
  return out;
}

/**
 * Dispute LOST: the reversal stands. Marks the rows final and tells each payee.
 * A reversal that had FAILED is now a permanent platform loss, so it pages.
 */
export async function finalizeLostClawback(
  { supabase, logStep }: WebhookContext,
  dispute: Stripe.Dispute,
  job: { id: string; title?: string | null },
): Promise<{ rows: number }> {
  const { rows, error } = await readClawbackRows(supabase, dispute.id);
  if (error) throw new Error(`chargeback_clawbacks read failed for ${dispute.id}: ${error}`);
  const payees = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "reversed") continue;
    const { data: kept, error: keptErr } = await setRow(supabase, row.id, { status: "kept" }, { status: ["reversed"] });
    if (keptErr) throw new Error(`chargeback_clawbacks 'kept' write failed for ${row.id}: ${keptErr.message}`);
    if (kept && kept.length > 0 && row.helper_id) {
      payees.set(row.helper_id, (payees.get(row.helper_id) ?? 0) + row.reversed_cents);
    }
  }
  const unrecovered = rows.filter((r) => r.status === "reverse_failed" || r.status === "reversing");
  if (unrecovered.length > 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Card dispute LOST on a paid job — clawback never completed",
      message: `Dispute ${dispute.id} was lost. ${unrecovered.length} payout transfer(s) for the job were never reversed, so the Helpr still holds that money and the platform has paid the cardholder. Recover it by hand.`,
      fields: { "Dispute ID": dispute.id, "Job ID": job.id, "Transfers": unrecovered.map((r) => r.stripe_transfer_id).join(", ") },
      link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
    });
  }
  for (const [userId, cents] of payees) {
    const { error: noteErr } = await supabase.from("notifications").insert({
      user_id: userId,
      title: "Card dispute closed",
      message: `The bank decided the card dispute on "${job.title ?? "a job"}" for the card holder, so the ${dollars(cents)} taken back for this job stays with them. Questions? Contact support.`,
      type: "payment",
      link: `/my-jobs?job=${job.id}`,
    });
    if (noteErr) logStep("Clawback lost: payee notification failed", { userId, error: noteErr.message });
  }
  return { rows: rows.length };
}

/** transfer.reversed: is this reversal one of ours (a card-dispute clawback)? */
export async function clawbackForTransfer(
  supabase: Db,
  transferId: string,
): Promise<{ disputeId: string | null; error?: string }> {
  const { data, error } = await supabase
    .from("chargeback_clawbacks")
    .select("dispute_id, status")
    .eq("stripe_transfer_id", transferId)
    .in("status", ["reversing", "reversed", "kept"])
    .limit(1);
  if (error) return { disputeId: null, error: error.message };
  const row = ((data ?? []) as Array<{ dispute_id: string }>)[0];
  return { disputeId: row?.dispute_id ?? null };
}
