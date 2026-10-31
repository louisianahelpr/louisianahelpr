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
    // Review of 9c498193ff #5: the payout went, so the row says so too (it read
    // failed, or was reaped), with the payout Stripe holds for it.
    await recordOutcome(db, row, { fee_state: "kept", status: "completed", stripe_payout_id: sent.id });
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
  // Review of 9c498193ff #2: a reversal made by hand (the dashboard; no metadata)
  // already gave the whole fee back. Another createReversal would be refused,
  // and the row would stay owed, locking cash-out for good. Stripe's own
  // amount_reversed says so; it is adopted as returned.
  let reversalId = prior?.id ?? null;
  if (!reversalId) {
    const transfer = await stripe.transfers.retrieve(transferId, {}, { stripeAccount });
    const amount = transfer?.amount ?? 0;
    if (amount > 0 && (transfer?.amount_reversed ?? 0) >= amount) {
      reversalId = (reversals?.data ?? [])[0]?.id ?? transfer?.reversals?.data?.[0]?.id ?? "reversed_by_hand";
    }
  }
  if (!reversalId) {
    reversalId = (await stripe.transfers.createReversal(
      transferId,
      { metadata: { instant_payout_id: row.id, source: "instant_payout_fee_return" } },
      { stripeAccount, idempotencyKey: `instant-payout-fee-return-${row.id}` },
    )).id;
  }
  const note = `fee returned to the Helpr's balance (${reversalId})`;
  await recordOutcome(db, row, {
    fee_state: "returned",
    fee_transfer_id: transferId,
    fee_reversal_id: reversalId,
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
  /** Made only when a fee is owed (review of 9c498193ff #1: this runs before every gate). */
  stripeFor: () => Promise<{ stripe: Stripe; seed: boolean }>,
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
  let seed = false;
  for (const row of (data ?? []) as InstantFeeRow[]) {
    try {
      const client = await stripeFor();
      seed = client.seed;
      await returnInstantFee(client.stripe, db, row, stripeAccount);
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
        // Review of 9c498193ff #4: a test account's fee (Stripe TEST) never pages the owner.
        seed,
      });
    }
  }
  return stuck ? { kind: "owed", feeCents: owedCents } : { kind: "clear" };
}

export interface FeeRedriveResult {
  returned: number;
  kept: number;
  not_taken: number;
  owed: number;
  /** Real Helprs' fees still owed: the cron's defects (they page). */
  defects: string[];
  /** Test accounts' fees still owed: the digest only. */
  seedDefects: string[];
}

/**
 * Review of 9c498193ff #1: the hourly half (process-scheduled-payouts). A fee
 * owed back from an attempt that ended goes back even when its Helpr never opens
 * cash-out again (instant cash-out is off while memberships are off). The same
 * returnInstantFee, so a run and a cash-out at once never reverse twice.
 */
export async function redriveInstantFeeReturns(
  db: Db,
  clientFor: (helperId: string) => Promise<{ stripe: Stripe; seed: boolean }>,
): Promise<FeeRedriveResult> {
  const out: FeeRedriveResult = { returned: 0, kept: 0, not_taken: 0, owed: 0, defects: [], seedDefects: [] };
  const { data, error } = await db
    .from("instant_payouts")
    .select(`${COLS}, helper_id`)
    .in("fee_state", ["attempting", "taken"])
    .neq("status", "pending")
    .limit(200);
  if (error) {
    out.defects.push(`instant payout fees owed: read failed: ${error.message}`);
    return out;
  }
  const rows = (data ?? []) as Array<InstantFeeRow & { helper_id: string }>;
  if (rows.length === 0) return out;
  const { data: profs, error: profErr } = await db
    .from("profiles")
    .select("user_id, stripe_account_id")
    .in("user_id", [...new Set(rows.map((r) => r.helper_id))]);
  if (profErr) {
    out.defects.push(`instant payout fees owed: payout accounts read failed: ${profErr.message}`);
    return out;
  }
  const accounts = new Map(((profs ?? []) as Array<{ user_id: string; stripe_account_id: string | null }>)
    .map((p) => [p.user_id, p.stripe_account_id]));
  for (const row of rows) {
    let seed = false;
    try {
      const account = accounts.get(row.helper_id);
      if (!account) throw new Error("the Helpr has no payout account linked");
      const client = await clientFor(row.helper_id);
      seed = client.seed;
      out[await returnInstantFee(client.stripe, db, row, account)] += 1;
    } catch (err) {
      out.owed += 1;
      (seed ? out.seedDefects : out.defects).push(
        `instant payout ${row.id} (Helpr ${row.helper_id}): fee not returned: ${caughtMessage(err).slice(0, 200)}`,
      );
    }
  }
  return out;
}
