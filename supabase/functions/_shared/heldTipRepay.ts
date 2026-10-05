// Q1222: a tip paid while its Helpr is on a payout hold.
//
// A tip is a DESTINATION charge, so Stripe moves it to the Helpr the moment
// the poster pays; create-payment checks the hold only when it opens the
// Checkout. Tips are final (Q781): the poster is never refunded. Instead:
//
//   holdBackPaidTip   (stripe-webhook, checkout.session.completed) records a
//                     public.tip_hold_redrives claim row ('owed') and reverses
//                     the tip's transfer back to the platform ('reversed').
//   redriveHeldTips   (process-scheduled-payouts, every run) re-pays each
//                     reversed tip once its Helpr's hold is released:
//                     compare-and-set 'reversed' -> 'repaying' (the claim),
//                     adopt a transfer Stripe already holds for it (its own
//                     tip_<id> transfer group) or create one under a fixed
//                     key, then 'repaid'.
//
// Stripe, not the row, decides whether money moved: before an 'owed' row is
// marked 'kept' or reversed again, the transfer's own reversals are listed
// and OUR reversal (metadata.tip_id) is adopted when it exists (review of
// Q1222: a reversal whose row update failed must not be stranded, and a
// re-reversal after Stripe's ~24h key window is refused). The re-pay lives
// in tip_<id>, never job_<id>: the original tip has no transfer group, so a
// job_<id> transfer would be read by payoutClaim's unrecorded-transfer check
// (refusing the Helpr's job payout) and by the chargeback clawback as job money.
//
// Every Stripe call carries a fixed idempotency key, and every state change is
// a compare-and-set on the row's status (and, for a stale claim, on the
// updated_at it was read at), so a second run, a redelivery or a concurrent
// copy moves nothing twice.

import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { checkPayoutHold, loadPayoutHolds } from "../_shared/payoutHold.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

type Db = { from: (t: string) => any };

/** A stale claim: older than this, the run that took it is gone. */
const STALE_MS = 10 * 60 * 1000;
/** A held tip still owed after this long pages a warning (once a day). */
export const HELD_TIP_AGE_ALERT_MS = 14 * 24 * 60 * 60 * 1000;

export type HoldBackResult =
  | { kind: "not_held" }
  | { kind: "held_back"; reversalId: string }
  /** The hold was released before the reversal ran: the Helpr keeps it and has been told. */
  | { kind: "kept" }
  | { kind: "not_reversed"; reason: string };

/**
 * Worth retrying on the same key. NOT StripeIdempotencyError: it means this
 * key was used with different parameters (a changed destination account), a
 * thing that never fixes itself; a person decides (review of Q1222).
 */
function isTransient(err: unknown): boolean {
  const e = err as { type?: string; statusCode?: number } | null;
  const type = String(e?.type ?? "");
  // A concurrent request with the SAME key still in flight: it settles.
  if ((err as { code?: string } | null)?.code === "idempotency_key_in_use") return true;
  return type === "StripeConnectionError" || type === "StripeAPIError" || type === "StripeRateLimitError" ||
    (typeof e?.statusCode === "number" && e.statusCode >= 500);
}

/** The platform balance cannot fund the re-pay right now: wait, never final. */
function isBalanceShort(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "balance_insufficient";
}

function message(err: unknown): string {
  return caughtMessage(err);
}

const nowIso = () => new Date().toISOString();

/** OUR reversal of this tip's transfer, if Stripe holds one. */
async function ourReversal(stripe: Stripe, transferId: string, tipId: string): Promise<Stripe.TransferReversal | null> {
  const list = await stripe.transfers.listReversals(transferId, { limit: 100 });
  return (list?.data ?? []).find((r) => r.metadata?.tip_id === tipId) ?? null;
}

/**
 * Record a reversal Stripe holds on an 'owed' row. Zero rows is checked
 * (second review of Q1222): a row another copy already moved on is fine; any
 * other state means the money came back with no record of it, so it pages.
 */
async function markReversed(supabase: Db, tipId: string, reversalId: string): Promise<void> {
  const { data, error } = await supabase
    .from("tip_hold_redrives")
    .update({ status: "reversed", reversal_id: reversalId, failure_reason: null, updated_at: nowIso() })
    .eq("tip_id", tipId).eq("status", "owed").select("tip_id");
  if (error) throw new Error(`tip ${tipId} reversed (${reversalId}) but its row was not updated: ${error.message}`);
  if (data && data.length > 0) return;
  const { data: cur } = await supabase.from("tip_hold_redrives").select("status").eq("tip_id", tipId).maybeSingle();
  if (["reversed", "repaying", "repaid"].includes(String(cur?.status ?? ""))) return;
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title: "Held tip reversed, but its record did not move to 'reversed'",
    message: `Tip ${tipId}'s transfer was reversed back to the platform (${reversalId}), but its tip_hold_redrives row is '${String(cur?.status ?? "missing")}', so the re-drive will not re-pay it. Set the row to 'reversed' with reversal_id ${reversalId} by hand; do NOT pay the Helpr by hand.`,
    fields: { tip_id: tipId, reversal_id: reversalId },
  });
}

/** The Helpr keeps a tip whose hold was released before it was pulled back: tell them. */
async function notifyKept(supabase: Db, helperId: string, jobId: string | null): Promise<void> {
  await insertNotifications(supabase, {
    user_id: helperId,
    ...(jobId ? { job_id: jobId } : {}),
    title: "You received a tip!",
    message: "Someone tipped you for a completed job. Thanks for the great work!",
    type: "payment",
    link: "/profile?tab=earnings",
  });
}

/**
 * Called for a PAID tip session. When the Helpr is on a payout hold the tip's
 * transfer is reversed back to the platform and a claim row records the debt.
 * Throws on anything Stripe should redeliver (an unreadable hold, a transient
 * Stripe or DB fault). Idempotent across redeliveries.
 */
export async function holdBackPaidTip(
  stripe: Stripe,
  supabase: Db,
  args: { tipId: string; helperId: string; paymentIntentId: string; jobId: string },
): Promise<HoldBackResult> {
  const hold = await checkPayoutHold(supabase, args.helperId);
  if (hold.kind === "error") throw new Error(`payout hold read failed for a paid tip ${args.tipId}: ${hold.message}`);

  // An existing row is the state a previous delivery left.
  const { data: existing, error: readErr } = await supabase
    .from("tip_hold_redrives")
    .select("tip_id, status, transfer_id, reversal_id")
    .eq("tip_id", args.tipId)
    .maybeSingle();
  if (readErr) throw new Error(`tip_hold_redrives read failed for tip ${args.tipId}: ${readErr.message}`);
  if (existing && existing.status !== "owed") {
    if (existing.status === "kept") return { kind: "kept" };
    return existing.status === "not_reversed"
      ? { kind: "not_reversed", reason: "recorded earlier" }
      : { kind: "held_back", reversalId: String(existing.reversal_id ?? "") };
  }
  if (hold.kind === "clear") {
    if (!existing) return { kind: "not_held" };
    // Released between deliveries: ask Stripe whether our reversal went out.
    const found = await ourReversal(stripe, String(existing.transfer_id), args.tipId);
    if (found) {
      await markReversed(supabase, args.tipId, found.id);
      return { kind: "held_back", reversalId: found.id };
    }
    const { data: k } = await supabase.from("tip_hold_redrives").update({ status: "kept", updated_at: nowIso() })
      .eq("tip_id", args.tipId).eq("status", "owed").select("tip_id");
    // Second review of Q1222: the delivery that wrote 'owed' told nobody, so
    // the Helpr is told here, once (the row moves to 'kept' once).
    if (k && k.length > 0) await notifyKept(supabase, args.helperId, args.jobId);
    return { kind: "kept" };
  }

  let transferId = existing?.transfer_id as string | undefined;
  if (!transferId) {
    const pi = await stripe.paymentIntents.retrieve(args.paymentIntentId, { expand: ["latest_charge"] });
    const charge = (pi.latest_charge && typeof pi.latest_charge === "object") ? pi.latest_charge as Stripe.Charge : null;
    const transfer = charge?.transfer;
    transferId = typeof transfer === "string" ? transfer : transfer?.id;
    if (!transferId) throw new Error(`paid tip ${args.tipId} for a held Helpr has no transfer on its charge yet`);
    const t = await stripe.transfers.retrieve(transferId);
    const amountCents = Number(t.amount ?? 0);
    const { error: insErr } = await supabase
      .from("tip_hold_redrives")
      .insert({ tip_id: args.tipId, helper_id: args.helperId, transfer_id: transferId, amount_cents: amountCents, status: "owed" });
    if (insErr && (insErr as { code?: string }).code !== "23505") {
      throw new Error(`tip_hold_redrives insert failed for tip ${args.tipId}: ${insErr.message}`);
    }
  }
  return reverseOwed(stripe, supabase, { tipId: args.tipId, transferId: transferId!, jobId: args.jobId });
}

/**
 * Reverse an 'owed' tip's transfer and move the row on. Stripe is asked first:
 * a reversal of ours that already exists is adopted, never repeated.
 */
async function reverseOwed(
  stripe: Stripe,
  supabase: Db,
  a: { tipId: string; transferId: string; jobId?: string },
): Promise<HoldBackResult> {
  const found = await ourReversal(stripe, a.transferId, a.tipId);
  if (found) {
    await markReversed(supabase, a.tipId, found.id);
    return { kind: "held_back", reversalId: found.id };
  }
  let reversal: Stripe.TransferReversal;
  try {
    reversal = await stripe.transfers.createReversal(
      a.transferId,
      { metadata: { reason: "payout_hold", tip_id: a.tipId } },
      { idempotencyKey: `tip-hold-reverse-${a.tipId}` },
    );
  } catch (err) {
    if (isTransient(err)) throw err;
    const why = message(err);
    await supabase.from("tip_hold_redrives")
      .update({ status: "not_reversed", failure_reason: why.slice(0, 500), updated_at: nowIso() })
      .eq("tip_id", a.tipId).eq("status", "owed").select("tip_id");
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Tip reached a Helpr on a payout hold and could not be pulled back",
      message: `A tip${a.jobId ? ` on job ${a.jobId}` : ""} (tip ${a.tipId}) was paid while its Helpr's payouts were on hold. Stripe shows no reversal of its transfer ${a.transferId} and refused one: ${why.slice(0, 300)}. The Helpr has the money; decide by hand.`,
      fields: { tip_id: a.tipId, ...(a.jobId ? { job_id: a.jobId } : {}), transfer_id: a.transferId },
    });
    return { kind: "not_reversed", reason: why };
  }
  await markReversed(supabase, a.tipId, reversal.id);
  return { kind: "held_back", reversalId: reversal.id };
}

export type RedriveResult = { repaid: number; kept: number; waiting: number; defects: string[] };

type RedriveRow = {
  tip_id: string; helper_id: string; transfer_id: string; amount_cents: number; status: string;
  updated_at: string | null; created_at: string | null;
  first_repay_attempt_at?: string | null;
};

/**
 * Re-pay every held-back tip whose Helpr is no longer on hold. Never throws:
 * a fault is a defect the caller counts; the row is left for the next run.
 */
export async function redriveHeldTips(stripe: Stripe, supabase: Db): Promise<RedriveResult> {
  const out: RedriveResult = { repaid: 0, kept: 0, waiting: 0, defects: [] };
  const { data, error } = await supabase
    .from("tip_hold_redrives")
    .select("tip_id, helper_id, transfer_id, amount_cents, status, updated_at, created_at, first_repay_attempt_at")
    .in("status", ["owed", "reversed", "repaying"])
    .limit(200);
  if (error) {
    out.defects.push(`tip_hold_redrives read: ${error.message}`);
    return out;
  }
  const rows = (data ?? []) as RedriveRow[];
  if (rows.length === 0) return out;
  const holds = await loadPayoutHolds(supabase, rows.map((r) => r.helper_id));
  if (!holds.ok) {
    out.defects.push(`payout hold read for held tips: ${holds.message}`);
    return out;
  }
  const now = Date.now();
  for (const r of rows) {
    const stale = !r.updated_at || now - Date.parse(r.updated_at) > STALE_MS;
    const held = holds.holds.has(r.helper_id);
    try {
      if (r.status === "owed") {
        if (!stale) continue; // the webhook is mid-way
        if (!held) {
          // Released before the row moved on: Stripe says whether it did.
          const found = await ourReversal(stripe, r.transfer_id, r.tip_id);
          if (found) {
            await markReversed(supabase, r.tip_id, found.id);
            out.waiting++;
            continue;
          }
          const { data: k } = await supabase.from("tip_hold_redrives")
            .update({ status: "kept", updated_at: nowIso() })
            .eq("tip_id", r.tip_id).eq("status", "owed").select("tip_id");
          if (k && k.length) {
            out.kept++;
            const { data: tipRow } = await supabase.from("tips").select("job_id").eq("id", r.tip_id).maybeSingle();
            await notifyKept(supabase, r.helper_id, (tipRow?.job_id as string | undefined) ?? null);
          }
          continue;
        }
        const res = await reverseOwed(stripe, supabase, { tipId: r.tip_id, transferId: r.transfer_id });
        if (res.kind === "not_reversed") out.defects.push(`tip ${r.tip_id} reversal refused: ${res.reason}`);
        out.waiting++;
        continue;
      }
      if (held) {
        out.waiting++;
        await ageAlert(r, now, "the Helpr is still on a payout hold");
        continue;
      }
      if (r.status === "repaying" && !stale) continue; // another run holds it
      // The claim: 'reversed' -> 'repaying', or re-take a stale 'repaying' row
      // pinned to the updated_at it was read at, so two runs that both read it
      // stale cannot both take it (review of Q1222).
      let claimQ = supabase
        .from("tip_hold_redrives")
        // first_repay_attempt_at: the clock money-reconciliation measures a
        // stuck re-pay from (updated_at moves on every hourly attempt).
        .update({ status: "repaying", updated_at: nowIso(), first_repay_attempt_at: r.first_repay_attempt_at ?? nowIso() })
        .eq("tip_id", r.tip_id).eq("status", r.status);
      if (r.status === "repaying") claimQ = claimQ.eq("updated_at", r.updated_at);
      const { data: claimed, error: claimErr } = await claimQ.select("tip_id");
      if (claimErr) { out.defects.push(`tip ${r.tip_id} claim: ${claimErr.message}`); continue; }
      if (!claimed || claimed.length === 0) continue; // another run took it
      if (await repayOne(stripe, supabase, r, out, now)) out.repaid++;
    } catch (err) {
      out.defects.push(`tip ${r.tip_id}: ${message(err)}`);
    }
  }
  return out;
}

/** A held tip still owed after HELD_TIP_AGE_ALERT_MS: a warning, once a day. */
async function ageAlert(r: RedriveRow, now: number, why: string): Promise<void> {
  const since = Date.parse(r.created_at ?? "");
  if (!Number.isFinite(since) || now - since < HELD_TIP_AGE_ALERT_MS) return;
  await postSlackOpsAlert({
    kind: "payout_failed",
    severity: "warning",
    title: "A tip held back during a payout hold is still owed",
    message: `Tip ${r.tip_id} (${r.amount_cents}c) has waited ${Math.floor((now - since) / 86_400_000)} days: ${why}. It is re-paid automatically once that clears; do NOT pay it by hand (it would be paid twice).`,
    fields: { tip_id: r.tip_id, helper_id: r.helper_id, amount_cents: r.amount_cents },
    oncePerDayKey: `held-tip-age:${r.tip_id}`,
  });
}

/** Put a claimed row back to 'reversed' (waiting), compare-and-set. */
async function backToWaiting(supabase: Db, tipId: string, reason?: string): Promise<void> {
  await supabase.from("tip_hold_redrives")
    .update({ status: "reversed", updated_at: nowIso(), ...(reason ? { failure_reason: reason.slice(0, 500) } : {}) })
    .eq("tip_id", tipId).eq("status", "repaying").select("tip_id");
}

async function repayOne(stripe: Stripe, supabase: Db, r: RedriveRow, out: RedriveResult, now: number): Promise<boolean> {
  // Re-checked under the claim: a hold placed since the read stops it.
  const hold = await checkPayoutHold(supabase, r.helper_id);
  if (hold.kind !== "clear") {
    await backToWaiting(supabase, r.tip_id);
    if (hold.kind === "error") out.defects.push(`tip ${r.tip_id} hold re-check: ${hold.message}`);
    return false;
  }
  const { data: prof, error: profErr } = await supabase
    .from("profiles").select("stripe_account_id").eq("user_id", r.helper_id).maybeSingle();
  if (profErr || !prof?.stripe_account_id) {
    await backToWaiting(supabase, r.tip_id);
    if (profErr) out.defects.push(`tip ${r.tip_id} profile read: ${profErr.message}`);
    else await ageAlert(r, now, "the Helpr has no payout account to send it to");
    return false; // waits; retried next run
  }
  const { data: tipRow } = await supabase.from("tips").select("job_id").eq("id", r.tip_id).maybeSingle();
  const group = `tip_${r.tip_id}`;
  let transfer: Stripe.Transfer | undefined;
  try {
    const prior = await stripe.transfers.list({ transfer_group: group, limit: 10 });
    transfer = (prior?.data ?? []).find((t) =>
      t.metadata?.type === "tip_hold_repay" && t.metadata?.tip_id === r.tip_id && !t.reversed);
    transfer ??= await stripe.transfers.create(
      {
        amount: r.amount_cents,
        currency: "usd",
        destination: prof.stripe_account_id,
        transfer_group: group,
        metadata: { type: "tip_hold_repay", tip_id: r.tip_id },
      },
      { idempotencyKey: `tip-hold-repay-${r.tip_id}` },
    );
  } catch (err) {
    if (isTransient(err)) {
      // Left 'repaying': the next run resumes it with the SAME key.
      out.defects.push(`tip ${r.tip_id} re-pay (transient): ${message(err)}`);
      return false;
    }
    if (isBalanceShort(err)) {
      // No source charge to draw on (the tip's own was reversed): the platform
      // balance is short right now. Waits; never a final failure.
      await backToWaiting(supabase, r.tip_id, `balance_insufficient: ${message(err)}`);
      await ageAlert(r, now, "the platform balance could not fund the re-pay: top up the platform balance");
      return false;
    }
    const why = message(err);
    await supabase.from("tip_hold_redrives")
      .update({ status: "failed", failure_reason: why.slice(0, 500), updated_at: nowIso() })
      .eq("tip_id", r.tip_id).eq("status", "repaying").select("tip_id");
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Held tip could not be re-paid after the hold was released",
      message: `Tip ${r.tip_id} was held back during a payout hold; Stripe refused re-paying it to the Helpr: ${why.slice(0, 300)}. Pay it by hand and mark the tip_hold_redrives row repaid with that transfer id.`,
      fields: { tip_id: r.tip_id, helper_id: r.helper_id, amount_cents: r.amount_cents },
    });
    return false;
  }
  const { data: done, error: doneErr } = await supabase
    .from("tip_hold_redrives")
    .update({ status: "repaid", repay_transfer_id: transfer.id, failure_reason: null, updated_at: nowIso() })
    .eq("tip_id", r.tip_id).eq("status", "repaying").select("tip_id");
  if (doneErr || !done || done.length === 0) {
    // The transfer exists; the next run adopts it from its transfer group.
    out.defects.push(`tip ${r.tip_id} re-paid (${transfer.id}) but the row was not marked: ${doneErr?.message ?? "matched 0 rows"}`);
    return false;
  }
  await insertNotifications(supabase, {
    user_id: r.helper_id,
    ...(tipRow?.job_id ? { job_id: tipRow.job_id } : {}),
    title: "You received a tip!",
    message: "Someone tipped you for a completed job. Thanks for the great work!",
    type: "payment",
    link: "/profile?tab=earnings",
  });
  return true;
}

/**
 * Is this transfer reversal one of OUR held-tip reversals? transferReversed
 * (the webhook) then logs it instead of raising its generic "investigate"
 * warning. A read failure answers false (the warning fires: never quieter
 * than before).
 */
export async function isHeldTipReversal(supabase: Db, transferId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("tip_hold_redrives")
    .select("tip_id, transfer_id")
    .eq("transfer_id", transferId)
    .limit(1);
  if (error) return false;
  return ((data ?? []) as Array<{ transfer_id?: string }>).some((r) => r.transfer_id === transferId);
}
