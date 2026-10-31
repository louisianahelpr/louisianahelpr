// Jobs audit 54a: the fee of a failed instant cash-out goes back to the Helpr.
//
// instant-payout moves its fee out of the Helpr's Connect balance BEFORE the
// payout. When no payout follows, that fee is owed back (the rule its alert and
// row note always stated: "reverse transfer to Helpr's Connect account"). This
// does the reversal, and a Helpr with a fee still owed starts no new attempt, so
// a retry can never charge a second one.
//
// Stripe, not the row, decides whether money moved (the rule of heldTipRepay.ts):
//   - a row can say failed while its payout went out (the reaper does not know;
//     a dropped connection on payouts.create does not either). A fee on a payout
//     that went is earned, and stays.
//   - a reversal whose row update failed is adopted, never made twice. Stripe's
//     idempotency key only lasts about 24 hours, so the key alone cannot do this.
//
// Each step is safe to repeat: fixed key per attempt, compare-and-set on the row.

import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

export interface InstantFeeRow {
  id: string;
  created_at: string;
  fee_amount: number | string;
  fee_state: string;
  fee_transfer_id: string | null;
  error_message: string | null;
}

export type FeeOutcome =
  /** The reversal is done: the money is back in the Helpr's balance. */
  | "returned"
  /** The payout really went out; the fee was earned. */
  | "kept"
  /** Stripe holds no fee transfer for this attempt; nothing to return. */
  | "not_taken";

const COLS = "id, created_at, fee_amount, fee_state, fee_transfer_id, error_message";

/** Stripe list window for this attempt: a minute before its row was written. */
const sinceEpoch = (row: InstantFeeRow) => Math.floor(new Date(row.created_at).getTime() / 1000) - 60;

async function recordOutcome(db: Db, row: InstantFeeRow, patch: Record<string, unknown>) {
  const { error } = await db
    .from("instant_payouts")
    .update(patch)
    .eq("id", row.id)
    .eq("fee_state", row.fee_state)
    .select("id");
  // Zero rows: a concurrent copy settled it first, which is the same answer. An
  // error throws: the row still reads as owed and the next call adopts the result.
  if (error) throw new Error(`could not record fee outcome for ${row.id}: ${error.message}`);
}

/** Works out and carries out what this attempt's fee is owed. Throws when it cannot. */
export async function returnInstantFee(
  stripe: Stripe,
  db: Db,
  row: InstantFeeRow,
  stripeAccount: string,
): Promise<FeeOutcome> {
  const created = { gte: sinceEpoch(row) };

  const payouts = await stripe.payouts.list({ limit: 100, created }, { stripeAccount });
  const sent = (payouts?.data ?? []).find((p) => p.metadata?.instant_payout_id === row.id);
  if (sent && sent.status !== "failed" && sent.status !== "canceled") {
    await recordOutcome(db, row, { fee_state: "kept" });
    return "kept";
  }

  let transferId = row.fee_transfer_id;
  if (!transferId) {
    const transfers = await stripe.transfers.list({ limit: 100, created }, { stripeAccount });
    transferId = (transfers?.data ?? []).find((t) => t.metadata?.instant_payout_id === row.id)?.id ?? null;
  }
  if (!transferId) {
    await recordOutcome(db, row, { fee_state: "not_taken" });
    return "not_taken";
  }

  const reversals = await stripe.transfers.listReversals(transferId, { limit: 100 }, { stripeAccount });
  const prior = (reversals?.data ?? []).find((r) => r.metadata?.instant_payout_id === row.id);
  const reversal = prior ?? await stripe.transfers.createReversal(
    transferId,
    { metadata: { instant_payout_id: row.id, source: "instant_payout_fee_return" } },
    { stripeAccount, idempotencyKey: `instant-payout-fee-return-${row.id}` },
  );
  const note = `fee returned to the Helpr's balance (${reversal.id})`;
  await recordOutcome(db, row, {
    fee_state: "returned",
    fee_transfer_id: transferId,
    fee_reversal_id: reversal.id,
    error_message: row.error_message ? `${row.error_message} | ${note}` : note,
  });
  return "returned";
}

/**
 * Before a quote or an attempt: return every fee this Helpr is owed from an
 * attempt that has ended. `owed` means at least one could not be returned yet,
 * and the caller refuses: no new attempt, so no second fee.
 */
export async function settleUnreturnedInstantFees(
  stripe: Stripe,
  db: Db,
  helperId: string,
  stripeAccount: string,
): Promise<{ kind: "clear" } | { kind: "owed"; feeCents: number }> {
  const { data, error } = await db
    .from("instant_payouts")
    .select(COLS)
    .eq("helper_id", helperId)
    .in("fee_state", ["attempting", "taken"])
    .neq("status", "pending");
  if (error) {
    console.error(`[instant-payout] could not read fees owed to ${helperId}: ${error.message}`);
    return { kind: "owed", feeCents: 0 };
  }
  let owedCents = 0;
  let stuck = false;
  for (const row of (data ?? []) as InstantFeeRow[]) {
    try {
      await returnInstantFee(stripe, db, row, stripeAccount);
    } catch (err) {
      stuck = true;
      owedCents += Math.round(Number(row.fee_amount) * 100);
      const msg = caughtMessage(err);
      console.error(`[instant-payout] fee return failed for ${row.id}: ${msg}`);
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Instant-payout fee could not be returned",
        message: "A failed instant payout's fee is still owed back and the automatic return failed. Instant cash-out stays refused for this Helpr until it is returned, so no second fee can be taken. Each cash-out they open tries the return again.",
        fields: { "Instant payout ID": row.id, "Helper ID": helperId, Error: msg.slice(0, 200) },
        oncePerDayKey: `instant_fee_return:${row.id}`,
      });
    }
  }
  return stuck ? { kind: "owed", feeCents: owedCents } : { kind: "clear" };
}
