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
//     reverse the Helpr's transfer(s) for the job, up to the disputed amount.
//     Several transfers (a crew job) share a PARTIAL dispute PRO RATA by each
//     transfer's amount (owner decision 2026-09-27, Q210(g)): see
//     proRataShares();
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
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
// `../_shared/` (not `./`) so the edge test harness mocks slack-alerts here
// exactly as it does for every function that imports it.
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { checkPayoutHold, loadPayoutHolds } from "../_shared/payoutHold.ts";

// Q1223: lives in _shared (it was stripe-webhook/handlers/_chargebackClawback.ts)
// so process-scheduled-payouts can re-run a won chargeback's re-payment once a
// payout hold is released. A module another function imports must be here:
// functions-deploy redeploys every function when _shared changes, and only the
// changed function when a function's own directory changes.

/** The request-scoped dependencies (stripe-webhook's WebhookContext, or any caller's). */
export interface ClawbackContext {
  stripe: Stripe;
  supabase: SupabaseClient;
  logStep: (step: string, details?: any) => void;
}
type WebhookContext = ClawbackContext;

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
  /** Pins the repay claim (a compare-and-set on status AND updated_at). */
  updated_at?: string | null;
};

const ROW_COLS =
  "id, dispute_id, job_id, helper_id, original_transfer_id, stripe_account_id, transfer_amount_cents, reversed_cents, stripe_reversal_id, repay_transfer_id, status, updated_at";

/** Row statuses that mean "this transfer's money is back with the platform". */
const CLAWED_BACK_STATUSES = ["reversed", "repaying", "repay_failed", "kept"] as const;

const REVERSAL_SOURCE = "chargeback-clawback";
const REPAY_SOURCE = "chargeback-repay";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Stripe failures worth a redelivery. An idempotency conflict (a concurrent
 * request on the same key) is included: the first request may have succeeded.
 */
/**
 * Worth retrying on the same key. NOT StripeIdempotencyError: it means the key
 * was reused with different parameters (e.g. the Helpr's stripe_account_id
 * changed since the first attempt), which never fixes itself, so retrying it
 * (webhook redelivery, or Q1223's re-drive every cron run) loops forever. A
 * person decides (lh-money-escrow review of Q1223).
 */
function isTransientStripeError(err: unknown): boolean {
  const t = (err as { type?: string })?.type ?? "";
  // idempotency_key_in_use: a concurrent request with the SAME key is still
  // in flight (the webhook and the re-drive racing one row). It settles; the
  // retry adopts what the winner created (second review of Q1223).
  if ((err as { code?: string })?.code === "idempotency_key_in_use") return true;
  return t === "StripeConnectionError" || t === "StripeAPIError" || t === "StripeRateLimitError";
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
    .eq("link", `/jobs?job=${jobId}`)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

export async function notifyPayee(supabase: Db, userId: string, jobId: string, title: string, message: string, disputeId: string) {
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    title,
    message,
    type: "payment",
    link: `/jobs?job=${jobId}`,
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

/**
 * Q210(g) (owner decision 2026-09-27): a partial dispute on a job paid by
 * several transfers (a crew) is taken back PRO RATA by each transfer's
 * amount, never oldest first. Largest-remainder rounding, so the shares sum
 * to exactly min(disputed, total paid); ties go to the older transfer (then
 * the smaller id), so a redelivery computes the same split.
 */
function proRataShares(
  transfers: ReadonlyArray<{ id: string; amount?: number | null; created?: number | null }>,
  disputedCents: number,
): Map<string, number> {
  const base = transfers.map((t) => ({ id: t.id, amount: Math.max(0, Math.floor(Number(t.amount) || 0)), created: t.created ?? 0 }));
  const total = base.reduce((n, t) => n + t.amount, 0);
  const target = Math.min(Math.max(0, Math.floor(Number(disputedCents) || 0)), total);
  const shares = new Map<string, number>();
  if (total <= 0) return shares;
  let given = 0;
  const frac: Array<{ id: string; rem: number; created: number }> = [];
  for (const t of base) {
    const exact = target * t.amount;
    const whole = Math.floor(exact / total);
    shares.set(t.id, whole);
    given += whole;
    frac.push({ id: t.id, rem: exact - whole * total, created: t.created });
  }
  frac.sort((a, b) => b.rem - a.rem || a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let k = 0; given < target && k < frac.length; k++, given++) {
    shares.set(frac[k].id, (shares.get(frac[k].id) ?? 0) + 1);
  }
  return shares;
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
  /** Pro-rata cents a transfer could not give (already reversed elsewhere). */
  shortfall: Array<{ transferId: string; cents: number }>;
};

/**
 * Reverse the Helpr's transfer(s) for a job whose charge is disputed, up to
 * the disputed amount, split pro rata across transfers (proRataShares).
 * Idempotent per (dispute, transfer).
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
  const result: ClawbackResult = { reversedNowCents: 0, reversedTotalCents: 0, failed: [], payees: new Map(), shortfall: [] };

  const existing = await readClawbackRows(supabase, dispute.id);
  if (existing.error) throw new Error(`chargeback_clawbacks read failed for ${dispute.id}: ${existing.error}`);
  const rowByTransfer = new Map(existing.rows.map((r) => [r.original_transfer_id, r]));

  const { transfers, helperByTransfer, unreadable } = await jobTransfers(stripe, supabase, job.id);

  // Already clawed back for this dispute counts against the disputed amount.
  let remaining = Math.max(0, Number(dispute.amount) || 0);
  // Each transfer's pro-rata part of the disputed amount (Q210(g)). A resumed
  // row keeps the amount it claimed; `remaining` stays the hard ceiling.
  const shares = proRataShares(transfers, remaining);
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
      const share = shares.get(t.id) ?? 0;
      amount = Math.min(share, reversible, remaining);
      if (reversible < share && reversible < remaining) {
        result.shortfall.push({ transferId: t.id, cents: Math.min(share, remaining) - reversible });
      }
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
  if (result.shortfall.length > 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Card-dispute clawback — a payout could not give its pro-rata share",
      message: `Dispute ${dispute.id} (${dollars(dispute.amount)}) is split pro rata across the job's payouts, but ${result.shortfall.length} transfer(s) had less left to reverse than their share (part of it was already reversed earlier, e.g. a partial refund or dispute split, so the gap may be refund-related rather than a true loss); the other members were not charged extra, so the platform is carrying ${dollars(result.shortfall.reduce((n, s) => n + s.cents, 0))}. Recover it by hand if it should be.`,
      fields: {
        "Dispute ID": dispute.id,
        "Job ID": job.id,
        "Short": result.shortfall.map((s) => `${s.transferId}: ${dollars(s.cents)}`).join(" | ").slice(0, 600),
      },
      link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
      oncePerDayKey: `clawback-shortfall:${dispute.id}`,
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

/** failure_reason written with held_repay_owed_at (Q1223); the COLUMN is the debt record. */
const HELD_REPAY_MARKER = "payout_hold: re-pay owed once the hold is released";

/** A held re-pay still owed after this long pages a warning (once a day). */
const HELD_REPAY_AGE_ALERT_MS = 14 * 24 * 60 * 60 * 1000;
/** A 'repaying' claim older than this belongs to a run that is gone. */
const STALE_REPAYING_MS = 10 * 60 * 1000;

/** The debt is settled (re-paid) or handed to a person (Stripe refused). Best-effort. */
async function clearHeldRepayOwed(
  supabase: Db,
  id: string,
  logStep: (step: string, details?: unknown) => void,
): Promise<void> {
  const { error } = await supabase
    .from("chargeback_clawbacks")
    .update({ held_repay_owed_at: null, held_repay_first_attempt_at: null })
    .eq("id", id)
    .not("held_repay_owed_at", "is", null)
    .select("id");
  if (error) logStep("held_repay_owed_at clear failed (column not deployed yet?)", { id, error: error.message });
}

/** What the re-drive knows about a row it owns. */
type SweepRow = { firstAttemptAt: string | null };

export type HeldRepayRedrive = { disputes: number; repaidCents: number; waiting: number; defects: string[] };

type OwedRow = {
  id: string; dispute_id: string; job_id: string; helper_id: string | null; status: string;
  held_repay_owed_at: string | null; updated_at: string | null; reversed_cents: number | null;
  held_repay_first_attempt_at?: string | null;
};

/**
 * Q1223: re-run a WON chargeback's re-payment that a payout hold (or an
 * unreadable hold) stopped. repayClawback records the debt in
 * held_repay_owed_at and charge.dispute.closed does not recur, so
 * process-scheduled-payouts calls this every run.
 *
 * PER ROW (review of Q1223): a row whose Helpr is clear now is re-driven even
 * when another member of the same dispute is still held; repayClawback checks
 * every row's hold itself and skips (quietly, fromSweep) the held ones. Rows
 * left 'repaying' by a run that died are picked up once stale. Each dispute
 * goes through repayClawback itself: the same 'repaying' claim, the same
 * adopt-or-create, the same idempotency key as the webhook, so a second run
 * or a concurrent copy pays nothing twice. A dispute whose every row is then
 * repaid returns its job from 'chargeback' to 'released' (what
 * charge.dispute.closed does when nothing waits). Never throws: a fault is a
 * defect the caller counts, and the row waits for the next run.
 */
export async function redriveHeldClawbackRepays(ctx: ClawbackContext): Promise<HeldRepayRedrive> {
  const out: HeldRepayRedrive = { disputes: 0, repaidCents: 0, waiting: 0, defects: [] };
  const { data, error } = await ctx.supabase
    .from("chargeback_clawbacks")
    .select("id, dispute_id, job_id, helper_id, status, held_repay_owed_at, held_repay_first_attempt_at, updated_at, reversed_cents")
    .not("held_repay_owed_at", "is", null)
    .in("status", ["reversed", "repay_failed", "repaying"])
    .limit(200);
  if (error) {
    // Before the column's migration is deployed there is nothing to re-drive.
    if ((error as { code?: string }).code === "42703") return out;
    out.defects.push(`chargeback_clawbacks held-repay read: ${error.message}`);
    return out;
  }
  const now = Date.now();
  const rows = ((data ?? []) as OwedRow[]).filter((r) =>
    r.status !== "repaying" || !r.updated_at || now - Date.parse(r.updated_at) > STALE_REPAYING_MS);
  if (rows.length === 0) return out;
  const holds = await loadPayoutHolds(ctx.supabase, rows.map((r) => r.helper_id));
  if (!holds.ok) {
    out.defects.push(`payout hold read for held clawback re-pays: ${holds.message}`);
    return out;
  }
  const ready = new Map<string, string>(); // dispute -> job
  // Second review of Q1223 (double pay): the sweep acts ONLY on the owed rows
  // it read here, never on a sibling of the same dispute (a row Stripe
  // refused was handed to a person, who may have paid it by hand).
  const owned = new Map<string, Map<string, SweepRow>>(); // dispute -> row id -> row
  for (const r of rows) {
    if (r.helper_id && holds.holds.has(r.helper_id)) {
      out.waiting++;
      const since = Date.parse(r.held_repay_owed_at ?? "");
      if (Number.isFinite(since) && now - since >= HELD_REPAY_AGE_ALERT_MS) {
        await postSlackOpsAlert({
          kind: "payout_failed",
          severity: "warning",
          title: "A won chargeback's re-pay still waits on a payout hold",
          message: `Clawback row ${r.id} (dispute ${r.dispute_id}, ${dollars(Number(r.reversed_cents ?? 0))}) has been owed for ${Math.floor((now - since) / 86_400_000)} days because the Helpr is still on a payout hold. It is re-paid automatically once the hold is released; do NOT pay it by hand (it would be paid twice).`,
          fields: { "Dispute ID": r.dispute_id, "Job ID": r.job_id, "Row": r.id },
          oncePerDayKey: `clawback-held-age:${r.id}`,
        });
      }
      continue;
    }
    ready.set(r.dispute_id, r.job_id);
    const mine = owned.get(r.dispute_id) ?? new Map<string, SweepRow>();
    mine.set(r.id, { firstAttemptAt: r.held_repay_first_attempt_at ?? null });
    owned.set(r.dispute_id, mine);
  }
  for (const [disputeId, jobId] of ready) {
    try {
      const { data: job } = await ctx.supabase.from("jobs").select("id, title").eq("id", jobId).maybeSingle();
      const res = await repayClawback(ctx, { id: disputeId } as Stripe.Dispute, { id: jobId, title: job?.title ?? null }, { fromSweep: true, owned: owned.get(disputeId) });
      out.disputes++;
      out.repaidCents += res.repaidNowCents;
      for (const f of res.failed) out.defects.push(`clawback re-pay ${disputeId}/${f.transferId}: ${f.error}`);
      for (const f of res.holdErrors) out.defects.push(`clawback re-pay ${disputeId}/${f.transferId}: ${f.error}`);
      // Every row of the dispute, not just the ones this run owned: a refused
      // or in-flight sibling keeps the job in 'chargeback'.
      if (res.rows > 0 && res.failed.length === 0 && res.held.length === 0 && res.holdErrors.length === 0 && res.othersOpen === 0) {
        const { error: backErr } = await ctx.supabase
          .from("jobs")
          .update({ payment_status: "released" })
          .eq("id", jobId)
          .eq("payment_status", "chargeback")
          .select("id");
        if (backErr) out.defects.push(`job ${jobId} not returned to released after the held re-pay: ${backErr.message}`);
      }
    } catch (err) {
      out.defects.push(`clawback re-pay ${disputeId}: ${errMessage(err)}`);
    }
  }
  return out;
}


export type RepayResult = {
  repaidNowCents: number;
  /** Stripe refused (or the row cannot be paid): a person pays it by hand. */
  failed: Array<{ transferId: string; error: string }>;
  /** Q1223: the Helpr is on a payout hold; marked owed, re-paid automatically. */
  held: string[];
  /** Q1223: the hold could not be read; marked owed, re-paid automatically once it can. */
  holdErrors: Array<{ transferId: string; error: string }>;
  /** Clawback rows this dispute has (any status). */
  rows: number;
  /** Sweep mode: rows still unpaid that this run did not own (a refused or in-flight sibling). */
  othersOpen: number;
  /** Rows whose money was never taken (the reversal failed or never ran). */
  neverTaken: number;
};

/** Dispute WON: pay back every amount this dispute clawed back. Idempotent per (dispute, transfer). */
export async function repayClawback(
  { stripe, supabase, logStep }: WebhookContext,
  dispute: Stripe.Dispute,
  job: { id: string; title?: string | null },
  opts: { fromSweep?: boolean; owned?: Map<string, SweepRow> } = {},
): Promise<RepayResult> {
  const out: RepayResult = { repaidNowCents: 0, failed: [], held: [], holdErrors: [], rows: 0, neverTaken: 0, othersOpen: 0 };
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
    // Sweep mode: only the owed rows the re-drive read (second review of
    // Q1223); a fresh 'repaying' row belongs to whoever claimed it.
    const sweepRow = opts.owned?.get(row.id);
    if (opts.owned && (!sweepRow || (row.status === "repaying" && row.updated_at &&
        Date.now() - Date.parse(row.updated_at) <= STALE_REPAYING_MS))) {
      out.othersOpen++;
      continue;
    }
    if (!row.stripe_account_id || row.reversed_cents <= 0) {
      out.failed.push({ transferId: row.original_transfer_id, error: "no destination account or amount on the clawback row" });
      continue;
    }
    // Payout hold (Q764): a held Helpr is not re-paid now. Checked before the
    // row is claimed, so it stays as it is. Q1223: the debt is recorded in its
    // own column (held_repay_owed_at) for a hold AND for an unreadable hold,
    // so process-scheduled-payouts' redriveHeldClawbackRepays re-runs this
    // re-payment once the Helpr is clear (this webhook event does not recur);
    // no later failure_reason can erase it. Only ever written here, i.e. on a
    // WON dispute. A hold is a WARNING page (re-paid automatically, do NOT pay
    // by hand: the re-drive adopts only REPAY_SOURCE transfers, so a manual
    // payment would be paid twice); an unreadable hold stays critical.
    const repayHold = await checkPayoutHold(supabase, row.helper_id);
    if (repayHold.kind !== "clear") {
      const { error: markErr } = await supabase
        .from("chargeback_clawbacks")
        .update({ held_repay_owed_at: new Date().toISOString(), failure_reason: HELD_REPAY_MARKER, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .in("status", ["reversed", "repay_failed", "repaying"])
        .is("held_repay_owed_at", null)
        .select("id");
      if (markErr) throw new Error(`chargeback_clawbacks hold marker failed for ${row.id}: ${markErr.message}`);
      if (repayHold.kind === "held") {
        out.held.push(row.original_transfer_id);
      } else {
        out.holdErrors.push({ transferId: row.original_transfer_id, error: `payout hold check failed: ${repayHold.message}` });
      }
      continue;
    }
    // The claim is a compare-and-set on the status AND the updated_at this
    // read saw (second review of Q1223): with a status list alone, a webhook
    // redelivery and the re-drive could both take one row.
    const claimedAt = new Date().toISOString();
    let claimQ = supabase
      .from("chargeback_clawbacks")
      .update({
        status: "repaying",
        updated_at: claimedAt,
        ...(sweepRow ? { held_repay_first_attempt_at: sweepRow.firstAttemptAt ?? claimedAt } : {}),
      })
      .eq("id", row.id)
      .eq("status", row.status);
    if (row.updated_at) claimQ = claimQ.eq("updated_at", row.updated_at);
    const { data: claimed, error: claimErr } = await claimQ.select("id");
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
      // Q1223: the debt is paid; nothing to re-drive. Its own write, so a
      // database without the column yet (migration not deployed) does not
      // fail the re-payment itself.
      await clearHeldRepayOwed(supabase, row.id, logStep);
      logStep("Clawback repaid", { disputeId: dispute.id, transferId: transfer.id, amount: row.reversed_cents, adopted: !!prior });
    } catch (err) {
      const message = errMessage(err);
      if (isTransientStripeError(err)) {
        // held_repay_owed_at stays: the re-drive retries it.
        await setRow(supabase, row.id, { status: "repay_failed", failure_reason: message }, { status: ["repaying"] });
        throw new Error(`Clawback repay for ${row.original_transfer_id} (dispute ${dispute.id}) failed transiently: ${message}`);
      }
      // Stripe refused: a person pays it (the page below); the re-drive stops.
      // Q1292: ONE write takes the row out of the re-drive AND records the
      // refusal. Two writes (status, then a best-effort clear of
      // held_repay_owed_at) let a failed second write leave the row owed, so
      // the sweep re-paid it after staff had paid by hand (the idempotency key
      // is gone after ~24h).
      const { data: failed, error: failErr } = await setRow(
        supabase,
        row.id,
        { status: "repay_failed", failure_reason: message, held_repay_owed_at: null, held_repay_first_attempt_at: null },
        { status: ["repaying"] },
      );
      if (failErr || !failed || failed.length === 0) {
        await recordLagPage(
          "Card dispute won — Helpr re-pay REFUSED, ledger row NOT updated",
          `Stripe refused re-paying ${dollars(row.reversed_cents)} for dispute ${dispute.id} (${message.slice(0, 200)}), and chargeback_clawbacks row ${row.id} could not be marked 'repay_failed' with its re-pay debt cleared. Until it is, process-scheduled-payouts may re-pay it automatically: set status='repay_failed', held_repay_owed_at=null BEFORE paying it by hand.`,
          { "Dispute ID": dispute.id, "Job ID": row.job_id, "Row": row.id, "DB error": failErr?.message ?? "matched 0 rows" },
          dispute.id,
        );
      }
      out.failed.push({ transferId: row.original_transfer_id, error: message });
    }
  }

  if (out.holdErrors.length > 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Card dispute WON — the Helpr's payout hold could not be read",
      message: `Dispute ${dispute.id} was won, but the payout hold of ${out.holdErrors.length} Helpr(s) could not be read, so they were not paid back yet. Each is marked owed and is re-paid automatically by process-scheduled-payouts once the hold reads clear; do NOT pay it by hand (it would be paid twice). Check the payout_holds read.`,
      fields: {
        "Dispute ID": dispute.id,
        "Job ID": job.id,
        "Rows": out.holdErrors.map((f) => `${f.transferId}: ${f.error}`).join(" | ").slice(0, 900),
      },
      oncePerDayKey: `clawback-repay-hold-read:${dispute.id}`,
    });
  }
  if (out.held.length > 0 && !opts.fromSweep) {
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "warning",
      title: "Card dispute WON — Helpr re-pay waits on a payout hold",
      message: `Dispute ${dispute.id} was won. ${out.held.length} clawed-back amount(s) belong to a Helpr on a payout hold; they are re-paid automatically by process-scheduled-payouts once the hold is released. Do NOT pay it by hand (it would be paid twice).`,
      fields: { "Dispute ID": dispute.id, "Job ID": job.id, "Transfers": out.held.join(", ").slice(0, 900) },
      oncePerDayKey: `clawback-repay-held:${dispute.id}`,
    });
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
