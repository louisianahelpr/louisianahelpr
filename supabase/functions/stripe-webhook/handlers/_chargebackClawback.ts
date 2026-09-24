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
//   a real chargeback (never an inquiry) on a job whose Helpr was paid →
//     reverse the Helpr's transfer(s) for the job, up to the disputed amount;
//   closed WON  → pay each reversed amount back to the same account;
//   closed LOST → the reversal stands.
// The payee is told each time, in-app.
//
// NEVER TWICE. Each reversal and re-payment is guarded three ways:
//   - a `chargeback_clawbacks` row per (dispute, transfer), claimed BEFORE the
//     Stripe call (unique on dispute_id + original_transfer_id);
//   - on any RESUME (a row left 'reversing' / 'reverse_failed' / 'repaying' /
//     'repay_failed'), Stripe is asked first whether the money already moved:
//     the transfer's reversals are listed for one carrying this dispute's
//     metadata, the job's transfer group for a re-payment carrying it. Found →
//     adopted, never re-issued. Stripe keeps an idempotency key ~24h and
//     retries a webhook for ~3 days, so the key alone is not enough;
//   - Stripe's idempotency key `clawback-<dispute>-<transfer>` /
//     `clawback-repay-<dispute>-<transfer>`, with the SAME amount and metadata
//     on every retry (the amount is read back from the claimed row).
// A refusal from Stripe (the connected account's balance is short, ...) is
// recorded on the row and paged as a critical alert (the ops alert ledger). A
// transient failure (network, 5xx, rate limit, an idempotency conflict) is
// thrown so the webhook answers 500 and Stripe redelivers.

import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

type Db = WebhookContext["supabase"];

type ClawbackRow = {
  id: string;
  dispute_id: string;
  job_id: string;
  helper_id: string | null;
  original_transfer_id: string;
  stripe_account_id: string | null;
  transfer_amount_cents: number;
  reversed_cents: number;
  stripe_reversal_id: string | null;
  repay_transfer_id: string | null;
  status: string;
};

const ROW_COLS =
  "id, dispute_id, job_id, helper_id, original_transfer_id, stripe_account_id, transfer_amount_cents, reversed_cents, stripe_reversal_id, repay_transfer_id, status";

/** Row statuses that mean "this transfer's money is back with the platform". */
const CLAWED_BACK_STATUSES = ["reversed", "repaying", "repay_failed", "kept"] as const;

const REVERSAL_SOURCE = "chargeback-clawback";
const REPAY_SOURCE = "chargeback-repay";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Stripe failures worth a redelivery. An idempotency conflict (a concurrent
 * request on the same key) is included: the first request may have succeeded.
 */
function isTransientStripeError(err: unknown): boolean {
  const t = (err as { type?: string })?.type ?? "";
  return t === "StripeConnectionError" || t === "StripeAPIError" || t === "StripeRateLimitError" ||
    t === "StripeIdempotencyError";
}

function errMessage(err: unknown): string {
  return String((err as { message?: string })?.message ?? err).slice(0, 500);
}

async function readClawbackRows(
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
 * carry is retrieved by id). Oldest first. A ledger id Stripe refuses to
 * return (not a transient failure) is reported in `unreadable`, not thrown:
 * the transfers that WERE found are still clawed back.
 */
async function jobTransfers(
  stripe: Stripe,
  supabase: Db,
  jobId: string,
): Promise<{ transfers: Stripe.Transfer[]; helperByTransfer: Map<string, string | null>; unreadable: string[] }> {
  const helperByTransfer = new Map<string, string | null>();
  const { data: ledger, error: ledgerErr } = await supabase
    .from("payout_transfers")
    .select("stripe_transfer_id, helper_id, status")
    .eq("job_id", jobId);
  if (ledgerErr) throw new Error(`Clawback: payout_transfers read failed for job ${jobId}: ${ledgerErr.message}`);
  for (const r of (ledger ?? []) as Array<{ stripe_transfer_id: string | null; helper_id: string | null }>) {
    if (r.stripe_transfer_id) helperByTransfer.set(r.stripe_transfer_id, r.helper_id ?? null);
  }

  const byId = new Map<string, Stripe.Transfer>();
  const unreadable: string[] = [];
  // A list failure of any kind throws: without it nothing can be reversed, and
  // the dispute page and admin notices have already gone out before this runs.
  const grouped = await stripe.transfers.list({ transfer_group: `job_${jobId}`, limit: 100 });
  for (const t of grouped?.data ?? []) byId.set(t.id, t);
  for (const id of helperByTransfer.keys()) {
    if (byId.has(id)) continue;
    try {
      byId.set(id, await stripe.transfers.retrieve(id));
    } catch (err) {
      if (isTransientStripeError(err)) throw err;
      unreadable.push(`${id}: ${errMessage(err)}`);
    }
  }
  const transfers = [...byId.values()].sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  return { transfers, helperByTransfer, unreadable };
}

/** The payee of a connected account, or null. A read error is paged, not dropped. */
async function helperForAccount(supabase: Db, accountId: string | null, disputeId: string): Promise<string | null> {
  if (!accountId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  if (error) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Card-dispute clawback — payee lookup failed",
      message: `Dispute ${disputeId}: the owner of connected account ${accountId} could not be read, so the payee will not be told about the clawback in-app.`,
      fields: { "Dispute ID": disputeId, "Account": accountId, "DB error": error.message.slice(0, 200) },
      oncePerDayKey: `clawback-payee-lookup:${disputeId}`,
    });
    return null;
  }
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

/** A money-moved-but-not-recorded page. Never throws: the money already moved. */
async function recordLagPage(title: string, message: string, fields: Record<string, string>, disputeId: string) {
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title,
    message,
    fields,
    link: `https://dashboard.stripe.com/disputes/${disputeId}`,
  });
}

/** Stripe's own answer to "did this dispute already reverse this transfer?" */
async function existingReversal(stripe: Stripe, transferId: string, disputeId: string): Promise<Stripe.TransferReversal | null> {
  const list = await stripe.transfers.listReversals(transferId, { limit: 100 });
  return (list?.data ?? []).find((r) =>
    (r.metadata as Record<string, string> | null)?.source === REVERSAL_SOURCE &&
    (r.metadata as Record<string, string> | null)?.dispute_id === disputeId
  ) ?? null;
}

/** Stripe's own answer to "was this clawed-back amount already paid back?" */
async function existingRepay(stripe: Stripe, row: ClawbackRow, disputeId: string): Promise<Stripe.Transfer | null> {
  const list = await stripe.transfers.list({ transfer_group: `job_${row.job_id}`, limit: 100 });
  return (list?.data ?? []).find((t) =>
    (t.metadata as Record<string, string> | null)?.source === REPAY_SOURCE &&
    (t.metadata as Record<string, string> | null)?.dispute_id === disputeId &&
    (t.metadata as Record<string, string> | null)?.original_transfer_id === row.original_transfer_id
  ) ?? null;
}

/** The ME-009 notice a Helpr gets when a card dispute holds an unpaid payout. */
export const HOLD_NOTICE_TITLE = "Payout on hold: card dispute";

/**
 * Whether this Helpr was told their payout for this job was held (ME-009). The
 * outcome notices are sent only then: a released job flipped to 'chargeback'
 * with nothing to claw back looks the same on the job row, and its Helpr was
 * paid, so "stays on hold" / "asked to release" would be false. A read failure
 * answers false — a missing notice is recoverable, a false one is not.
 */
export async function wasToldOnHold(supabase: Db, userId: string, jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("title", HOLD_NOTICE_TITLE)
    .eq("link", `/my-jobs?job=${jobId}`)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

export async function notifyPayee(supabase: Db, userId: string, jobId: string, title: string, message: string, disputeId: string) {
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    title,
    message,
    type: "payment",
    link: `/my-jobs?job=${jobId}`,
  });
  if (error) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Card-dispute clawback — payee notice NOT sent",
      message: `Dispute ${disputeId}: the in-app notice "${title}" to the payee of job ${jobId} failed to insert. Tell them by hand.`,
      fields: { "Dispute ID": disputeId, "Job ID": jobId, "User": userId, "DB error": error.message.slice(0, 200) },
      oncePerDayKey: `clawback-notice:${disputeId}:${userId}:${title}`,
    });
  }
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
 * Reverse the Helpr's transfer(s) for a job whose charge is disputed, up to
 * the disputed amount. Idempotent per (dispute, transfer).
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
  const rowByTransfer = new Map(existing.rows.map((r) => [r.original_transfer_id, r]));

  const { transfers, helperByTransfer, unreadable } = await jobTransfers(stripe, supabase, job.id);

  // Already clawed back for this dispute counts against the disputed amount.
  let remaining = Math.max(0, Number(dispute.amount) || 0);
  for (const r of existing.rows) {
    if ((CLAWED_BACK_STATUSES as readonly string[]).includes(r.status)) {
      remaining -= r.reversed_cents;
      result.reversedTotalCents += r.reversed_cents;
    }
  }

  // The job must not read 'released' while its money is being taken back:
  // transfer.reversed re-queues a 'released' job, and every screen would say
  // "paid". A payout that settled after the dispute handler's read (a race the
  // status read cannot see) is caught here. Compare-and-set, idempotent.
  let jobMarked = false;
  const markJob = async () => {
    if (jobMarked) return;
    const { error: markErr } = await supabase
      .from("jobs")
      .update({ payment_status: "chargeback" })
      .eq("id", job.id)
      .eq("payment_status", "released")
      .select("id");
    if (markErr) throw new Error(`Clawback: could not mark job ${job.id} chargeback: ${markErr.message}`);
    jobMarked = true;
  };

  for (const t of transfers) {
    if (remaining <= 0) break;
    let row = rowByTransfer.get(t.id);
    if (row && row.status !== "reversing" && row.status !== "reverse_failed") continue; // done, or final

    let amount: number;
    if (row) {
      // RESUME. Ask Stripe first: the reversal may have gone through while
      // its record did not (a lost response, a killed function, a key older
      // than Stripe's ~24h idempotency window).
      const found = await existingReversal(stripe, t.id, dispute.id);
      if (found) {
        const { data: adopted, error: adoptErr } = await setRow(
          supabase, row.id,
          { status: "reversed", stripe_reversal_id: found.id, reversed_cents: found.amount, failure_reason: null },
          { status: ["reversing", "reverse_failed"] },
        );
        if (adoptErr || !adopted || adopted.length === 0) {
          await recordLagPage(
            "Card-dispute clawback — reversal found at Stripe, ledger row NOT updated",
            `Transfer ${t.id} already carries reversal ${found.id} for dispute ${dispute.id}, but chargeback_clawbacks row ${row.id} could not be marked 'reversed'. Mark it by hand; do NOT reverse again.`,
            { "Dispute ID": dispute.id, "Job ID": job.id, "Transfer": t.id, "DB error": adoptErr?.message ?? "matched 0 rows" },
            dispute.id,
          );
        }
        remaining -= found.amount;
        result.reversedTotalCents += found.amount;
        logStep("Clawback: adopted an existing reversal", { disputeId: dispute.id, transferId: t.id, reversalId: found.id });
        continue;
      }
      // Not at Stripe: retry with the SAME amount the claim recorded (Stripe's
      // idempotency key refuses a retry whose parameters differ).
      amount = row.reversed_cents;
    } else {
      const reversible = Math.max(0, (t.amount ?? 0) - (t.amount_reversed ?? 0));
      amount = Math.min(reversible, remaining);
      if (amount <= 0) continue;
      const destination = typeof t.destination === "string" ? t.destination : (t.destination as { id?: string } | null)?.id ?? null;
      const helperId = helperByTransfer.get(t.id) ?? (await helperForAccount(supabase, destination, dispute.id));
      const { data: claimed, error: claimErr } = await supabase
        .from("chargeback_clawbacks")
        .insert({
          dispute_id: dispute.id,
          job_id: job.id,
          helper_id: helperId,
          original_transfer_id: t.id,
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

    await markJob();
    try {
      const reversal = await stripe.transfers.createReversal(
        t.id,
        {
          amount,
          metadata: { source: REVERSAL_SOURCE, dispute_id: dispute.id, job_id: job.id },
        },
        { idempotencyKey: `clawback-${dispute.id}-${t.id}` },
      );
      const { data: done, error: doneErr } = await setRow(
        supabase,
        row.id,
        { status: "reversed", stripe_reversal_id: reversal.id, failure_reason: null },
        { status: ["reversing", "reverse_failed"] },
      );
      if (doneErr || !done || done.length === 0) {
        // The money moved; only the record lags. Page, do not throw. A resume
        // would find this reversal at Stripe and adopt it (never re-issue).
        await recordLagPage(
          "Card-dispute clawback — Stripe reversal done, ledger row NOT updated",
          `Transfer ${t.id} was reversed (${dollars(amount)}, reversal ${reversal.id}) for dispute ${dispute.id}, but chargeback_clawbacks row ${row.id} could not be marked 'reversed'. Set it by hand so a won dispute pays it back.`,
          { "Dispute ID": dispute.id, "Job ID": job.id, "Transfer": t.id, "DB error": doneErr?.message ?? "matched 0 rows" },
          dispute.id,
        );
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
        { status: "reverse_failed", failure_reason: message },
        { status: ["reversing", "reverse_failed"] },
      );
      if (failErr) logStep("Clawback: could not record the failure", { rowId: row.id, error: failErr.message });
      if (isTransientStripeError(err)) {
        throw new Error(`Clawback reversal of ${t.id} for dispute ${dispute.id} failed transiently: ${message}`);
      }
      result.failed.push({ transferId: t.id, error: message });
    }
  }

  if (result.failed.length > 0 || unreadable.length > 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Card dispute on a PAID job — clawback REFUSED by Stripe",
      message: `Dispute ${dispute.id} (${dollars(dispute.amount)}) is on a job whose Helpr was already paid. ${result.failed.length} transfer(s) could not be reversed and ${unreadable.length} could not be read, so the platform is carrying that loss. Most often the Helpr's Stripe balance is short: recover it by hand (Stripe Dashboard → Connect → the account) and mark the chargeback_clawbacks row.`,
      fields: {
        "Dispute ID": dispute.id,
        "Job ID": job.id,
        "Reversed so far": dollars(result.reversedTotalCents),
        "Refused": result.failed.map((f) => `${f.transferId}: ${f.error}`).join(" | ").slice(0, 600) || "—",
        "Unreadable": unreadable.join(" | ").slice(0, 300) || "—",
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
    await notifyPayee(
      supabase, userId, job.id,
      "Payment disputed by the card holder",
      `The card used to pay for "${job.title ?? "a job"}" has been disputed with the bank, so the ${dollars(cents)} paid to you for it has been taken back while the bank reviews the dispute. If the dispute is decided in our favor, it is paid back to you automatically. Questions? Contact support.`,
      dispute.id,
    );
  }
  return result;
}

/**
 * A row whose reversal never recorded ('reversing' / 'reverse_failed'): did
 * Stripe reverse it after all? Found → the row is promoted to 'reversed' and
 * returned as such; not found → null (nothing was taken from the payee).
 */
async function reconcileUnrecorded(
  stripe: Stripe,
  supabase: Db,
  row: ClawbackRow,
  disputeId: string,
): Promise<ClawbackRow | null> {
  const found = await existingReversal(stripe, row.original_transfer_id, disputeId);
  if (!found) return null;
  const { data, error } = await setRow(
    supabase, row.id,
    { status: "reversed", stripe_reversal_id: found.id, reversed_cents: found.amount, failure_reason: null },
    { status: ["reversing", "reverse_failed"] },
  );
  if (error || !data || data.length === 0) {
    throw new Error(`chargeback_clawbacks: could not record reversal ${found.id} on row ${row.id}: ${error?.message ?? "matched 0 rows"}`);
  }
  return { ...row, status: "reversed", stripe_reversal_id: found.id, reversed_cents: found.amount };
}

export type RepayResult = {
  repaidNowCents: number;
  failed: Array<{ transferId: string; error: string }>;
  /** Clawback rows this dispute has (any status). */
  rows: number;
  /** Rows whose money was never taken (the reversal failed or never ran). */
  neverTaken: number;
};

/** Dispute WON: pay back every amount this dispute clawed back. Idempotent per (dispute, transfer). */
export async function repayClawback(
  { stripe, supabase, logStep }: WebhookContext,
  dispute: Stripe.Dispute,
  job: { id: string; title?: string | null },
): Promise<RepayResult> {
  const out: RepayResult = { repaidNowCents: 0, failed: [], rows: 0, neverTaken: 0 };
  const { rows, error } = await readClawbackRows(supabase, dispute.id);
  if (error) throw new Error(`chargeback_clawbacks read failed for ${dispute.id}: ${error}`);
  out.rows = rows.length;
  const payees = new Map<string, number>();

  for (let row of rows) {
    if (row.status === "reversing" || row.status === "reverse_failed") {
      const reconciled = await reconcileUnrecorded(stripe, supabase, row, dispute.id);
      if (!reconciled) {
        out.neverTaken++;
        continue;
      }
      row = reconciled;
    }
    if (!["reversed", "repaying", "repay_failed"].includes(row.status)) continue;
    if (!row.stripe_account_id || row.reversed_cents <= 0) {
      out.failed.push({ transferId: row.original_transfer_id, error: "no destination account or amount on the clawback row" });
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
      // A resumed row may already have been paid back (a lost response, or a
      // key past Stripe's ~24h window). Adopt that transfer; never pay twice.
      const prior = row.status === "reversed" ? null : await existingRepay(stripe, row, dispute.id);
      const transfer = prior ?? await stripe.transfers.create(
        {
          amount: row.reversed_cents,
          currency: "usd",
          destination: row.stripe_account_id,
          transfer_group: `job_${row.job_id}`,
          metadata: {
            source: REPAY_SOURCE,
            dispute_id: dispute.id,
            job_id: row.job_id,
            original_transfer_id: row.original_transfer_id,
          },
        },
        { idempotencyKey: `clawback-repay-${dispute.id}-${row.original_transfer_id}` },
      );
      const { data: done, error: doneErr } = await setRow(
        supabase,
        row.id,
        { status: "repaid", repay_transfer_id: transfer.id, failure_reason: null },
        { status: ["repaying", "repay_failed"] },
      );
      if (doneErr || !done || done.length === 0) {
        await recordLagPage(
          "Card dispute won — Helpr re-paid, ledger row NOT updated",
          `Transfer ${transfer.id} re-paid ${dollars(row.reversed_cents)} for dispute ${dispute.id}, but chargeback_clawbacks row ${row.id} could not be marked 'repaid'. Mark it by hand; do NOT pay it again.`,
          { "Dispute ID": dispute.id, "Job ID": row.job_id, "DB error": doneErr?.message ?? "matched 0 rows" },
          dispute.id,
        );
      }
      // The re-payment is a payout: it goes in the payout ledger, so the
      // reconciler counts the job as paid, the unrecorded-transfer checks
      // (payoutClaim.checkUnrecordedTransfers, create-payment's admin paths)
      // see it as recorded, and a later transfer.failed / transfer.canceled
      // on it is handled. The ORIGINAL row stays 'reversed' (Stripe's truth);
      // 'reversal_cleared' would mean "an operator allowed a re-pay".
      const { data: origRows } = await supabase
        .from("payout_transfers")
        .select("amount_cents, platform_fee_cents")
        .eq("stripe_transfer_id", row.original_transfer_id)
        .limit(1);
      const orig = ((origRows ?? []) as Array<{ amount_cents: number; platform_fee_cents: number }>)[0];
      const feeCents = orig && orig.amount_cents > 0
        ? Math.round((orig.platform_fee_cents * row.reversed_cents) / orig.amount_cents)
        : 0;
      const { error: ledgerErr } = await supabase
        .from("payout_transfers")
        .upsert({
          job_id: row.job_id,
          helper_id: row.helper_id,
          stripe_transfer_id: transfer.id,
          stripe_account_id: row.stripe_account_id,
          amount_cents: row.reversed_cents,
          currency: "usd",
          platform_fee_cents: feeCents,
          status: "paid",
          initiated_by: "system",
          paid_at: new Date().toISOString(),
          metadata: { source: REPAY_SOURCE, dispute_id: dispute.id, original_transfer_id: row.original_transfer_id },
        }, { onConflict: "stripe_transfer_id" })
        .select("id");
      if (ledgerErr) {
        await recordLagPage(
          "Card dispute won — Helpr re-paid, payout_transfers row NOT written",
          `Re-payment transfer ${transfer.id} (${dollars(row.reversed_cents)}) for dispute ${dispute.id} has no payout_transfers row, so the reconciler and the payout guards cannot see it. Insert it by hand.`,
          { "Dispute ID": dispute.id, "Job ID": row.job_id, "Transfer": transfer.id, "DB error": ledgerErr.message.slice(0, 200) },
          dispute.id,
        );
      }
      if (!prior) {
        out.repaidNowCents += row.reversed_cents;
        if (row.helper_id) payees.set(row.helper_id, (payees.get(row.helper_id) ?? 0) + row.reversed_cents);
      }
      logStep("Clawback repaid", { disputeId: dispute.id, transferId: transfer.id, amount: row.reversed_cents, adopted: !!prior });
    } catch (err) {
      const message = errMessage(err);
      await setRow(supabase, row.id, { status: "repay_failed", failure_reason: message }, { status: ["repaying"] });
      if (isTransientStripeError(err)) {
        throw new Error(`Clawback repay for ${row.original_transfer_id} (dispute ${dispute.id}) failed transiently: ${message}`);
      }
      out.failed.push({ transferId: row.original_transfer_id, error: message });
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
    await notifyPayee(
      supabase, userId, job.id,
      "Disputed payment returned to you",
      `The card dispute on "${job.title ?? "a job"}" was decided in our favor, so the ${dollars(cents)} taken back has been paid to you again.`,
      dispute.id,
    );
  }
  return out;
}

/**
 * Dispute LOST: the reversal stands. Marks the rows final and tells each payee.
 * A reversal that never happened is now a permanent platform loss, so it pages.
 */
export async function finalizeLostClawback(
  { stripe, supabase, logStep }: WebhookContext,
  dispute: Stripe.Dispute,
  job: { id: string; title?: string | null },
): Promise<{ rows: number }> {
  const { rows, error } = await readClawbackRows(supabase, dispute.id);
  if (error) throw new Error(`chargeback_clawbacks read failed for ${dispute.id}: ${error}`);
  const payees = new Map<string, number>();
  const unrecovered: ClawbackRow[] = [];
  for (let row of rows) {
    if (row.status === "reversing" || row.status === "reverse_failed") {
      const reconciled = await reconcileUnrecorded(stripe, supabase, row, dispute.id);
      if (!reconciled) {
        unrecovered.push(row);
        continue;
      }
      row = reconciled;
    }
    if (row.status !== "reversed") continue;
    const { data: kept, error: keptErr } = await setRow(supabase, row.id, { status: "kept" }, { status: ["reversed"] });
    if (keptErr) throw new Error(`chargeback_clawbacks 'kept' write failed for ${row.id}: ${keptErr.message}`);
    if (kept && kept.length > 0 && row.helper_id) {
      payees.set(row.helper_id, (payees.get(row.helper_id) ?? 0) + row.reversed_cents);
    }
  }
  if (unrecovered.length > 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Card dispute LOST on a paid job — clawback never completed",
      message: `Dispute ${dispute.id} was lost. ${unrecovered.length} payout transfer(s) for the job were never reversed (checked at Stripe), so the Helpr still holds that money and the platform has paid the cardholder. Recover it by hand.`,
      fields: { "Dispute ID": dispute.id, "Job ID": job.id, "Transfers": unrecovered.map((r) => r.original_transfer_id).join(", ") },
      link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
    });
  }
  for (const [userId, cents] of payees) {
    await notifyPayee(
      supabase, userId, job.id,
      "Card dispute closed",
      `The bank decided the card dispute on "${job.title ?? "a job"}" for the card holder, so the ${dollars(cents)} taken back for this job stays with them. Questions? Contact support.`,
      dispute.id,
    );
  }
  logStep("Clawback lost: finalized", { disputeId: dispute.id, rows: rows.length, unrecovered: unrecovered.length });
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
    .eq("original_transfer_id", transferId)
    .in("status", ["reversing", "reversed", "kept"])
    .limit(1);
  if (error) return { disputeId: null, error: error.message };
  const row = ((data ?? []) as Array<{ dispute_id: string }>)[0];
  return { disputeId: row?.dispute_id ?? null };
}
