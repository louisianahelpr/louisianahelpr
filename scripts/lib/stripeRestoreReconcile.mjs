/**
 * DR-006, after a database restore to time T: what did Stripe do after T that
 * the database no longer knows about?
 *
 * A restore rewinds Postgres, never Stripe. Every charge, transfer and refund
 * Stripe processed after T is still real, and its row is gone. The dangerous
 * one is a transfer: `process-scheduled-payouts` / `auto-release-payment` would
 * find the job still owing and pay the helper again, and Stripe's idempotency
 * keys replay only inside its ~24 h window
 * (docs/runbooks/restore-from-backup.md §5).
 *
 * scripts/check-stripe-restore-drift.mjs lists Stripe objects created since T
 * and looks each one up BY ID in the columns below. This file is the pure half:
 * the id inventory and the grading. src/test/stripeRestoreReconcile.test.ts
 * derives every Stripe-id column from src/integrations/supabase/types.ts and
 * fails when one is in neither DB_ID_COLUMNS nor NOT_MATCHED, so a new money
 * table cannot be left out of the reconciliation.
 */

/**
 * Where each Stripe object kind is recorded in the database. `orderBy`: the
 * column the script pages a table by when it has no `id` column.
 *
 * Declutter and Shops (Q2230, before the Declutter switch goes past testers,
 * 2026-10-19): what each column holds, read from its writers and pg_constraint
 * on prod (every one of these tables was empty on prod that day):
 *   - declutter_orders / shop_orders.stripe_payment_intent_id: the order's
 *     PaymentIntent (shop_orders CHECK '^pi_'; declutter_orders is written by
 *     the checkout webhook from the session's payment_intent).
 *   - declutter_refunds.stripe_payment_intent_id (CHECK '^pi_'): ONE row per
 *     PAYMENT, including a payment no order holds (reasons superseded,
 *     duplicate_payment, order_missing), so it is a record of that PI.
 *   - declutter_hand_refunds.* (CHECK '^pi_' and '^(re|pyr)_'; primary key
 *     stripe_refund_id, no id column) and declutter_delivery_refunds.*: the
 *     payment's PI and the refund Stripe made.
 *   - declutter_refunds / declutter_delivery_refunds.stripe_refund_ref: no
 *     CHECK, but every writer passes a Stripe refund's own id (declutter-money,
 *     stripe-webhook declutterCheckout / chargeRefundUpdated, the hand-settle
 *     RPC) or keeps the old value (COALESCE). Any value that is not a Stripe
 *     id of its kind is left out by collectDbIds (ID_PREFIX) and listed, so a
 *     placeholder can never stand in for a missing object.
 *   - declutter_payouts / helpr_task_payouts / shop_payouts.stripe_transfer_id
 *     (CHECK '^tr_'): the payout's transfer.
 *   - shop_refunds.* (Q2232; Shops M3, 20261019071055: CHECK '^pi_', and
 *     stripe_refund_id NULL or '^(re|pyr)_', set once Stripe made the refund)
 *     and shop_hand_refunds.* (CHECK '^pi_' and '^(re|pyr)_'; primary key
 *     stripe_refund_id, no id column, so it pages by it): one refund per
 *     order, by the app or by hand in Stripe.
 * @type {Record<"payment_intent" | "transfer" | "refund", { table: string, column: string, orderBy?: string }[]>}
 */
export const DB_ID_COLUMNS = {
  payment_intent: [
    { table: "jobs", column: "stripe_payment_intent_id" },
    { table: "tips", column: "stripe_payment_intent_id" },
    { table: "gift_cards", column: "stripe_payment_intent_id" },
    { table: "recurring_visit_payments", column: "stripe_payment_intent_id" },
    { table: "declutter_orders", column: "stripe_payment_intent_id" },
    { table: "declutter_refunds", column: "stripe_payment_intent_id" },
    { table: "declutter_hand_refunds", column: "stripe_payment_intent_id", orderBy: "stripe_refund_id" },
    { table: "declutter_delivery_refunds", column: "stripe_payment_intent_id" },
    // Q1929: a delivery-pay raise is its own charge (20261021185418).
    { table: "declutter_delivery_raises", column: "stripe_payment_intent_id" },
    // Q2453: a Declutter delivery tip is its own charge (20261028014848; the webhook writes the paid PI).
    { table: "helpr_task_tips", column: "stripe_payment_intent_id" },
    { table: "shop_orders", column: "stripe_payment_intent_id" },
    { table: "shop_refunds", column: "stripe_payment_intent_id" },
    { table: "shop_hand_refunds", column: "stripe_payment_intent_id", orderBy: "stripe_refund_id" },
  ],
  transfer: [
    { table: "payout_transfers", column: "stripe_transfer_id" },
    { table: "disputes", column: "execution_transfer_id" },
    { table: "referral_credits", column: "stripe_transfer_id" },
    { table: "crew_cancellation_fee_shares", column: "stripe_transfer_id" },
    // Q1390: a crew member's cancellation fee for a poster's block.
    { table: "crew_block_fees", column: "stripe_transfer_id" },
    { table: "cancellation_fee_transfers", column: "stripe_transfer_id" },
    { table: "chargeback_clawbacks", column: "original_transfer_id" },
    { table: "chargeback_clawbacks", column: "repay_transfer_id" },
    // No id column (its key is tip_id): pages by tip_id, or every run answers 42703 and exits 2
    // (Declutter payout proof run 39345010494, 2026-10-20 00:08Z).
    { table: "tip_hold_redrives", column: "transfer_id", orderBy: "tip_id" },
    { table: "tip_hold_redrives", column: "repay_transfer_id", orderBy: "tip_id" },
    { table: "declutter_payouts", column: "stripe_transfer_id" },
    { table: "helpr_task_payouts", column: "stripe_transfer_id" },
    // Q1929: the raise part of a Helpr payout, sent from the raise's own charge.
    { table: "declutter_delivery_raises", column: "payout_transfer_id" },
    // Q2453 (owner #3706): a HELD delivery tip's own transfer, sent with the Helpr's delivery pay (CHECK '^tr_').
    { table: "helpr_task_tips", column: "payout_transfer_id" },
    { table: "shop_payouts", column: "stripe_transfer_id" },
    // An admin's hand settlement of a held payout or refund (20261019070737, CHECK '^(tr|re|pyr|po)_'):
    // listed under each kind it can hold; collectDbIds skips the other kinds quietly.
    { table: "payout_settlements", column: "stripe_ref" },
  ],
  refund: [
    { table: "payment_refunds", column: "stripe_refund_id" },
    { table: "disputes", column: "execution_refund_id" },
    { table: "declutter_refunds", column: "stripe_refund_ref" },
    { table: "declutter_hand_refunds", column: "stripe_refund_id", orderBy: "stripe_refund_id" },
    { table: "declutter_delivery_refunds", column: "stripe_refund_ref" },
    { table: "shop_refunds", column: "stripe_refund_id" },
    { table: "shop_hand_refunds", column: "stripe_refund_id", orderBy: "stripe_refund_id" },
    { table: "declutter_delivery_raises", column: "stripe_refund_ref" },
    // Q2352 (20261026154738): a Declutter setup fee sent back once (setup_fee_state 'refunded').
    { table: "declutter_orders", column: "setup_fee_refund_id" },
    { table: "payout_settlements", column: "stripe_ref" },
  ],
};

/** The id shape of each Stripe object kind (a refund can be re_ or pyr_). */
export const ID_PREFIX = {
  payment_intent: /^pi_[A-Za-z0-9]+$/,
  transfer: /^tr_[A-Za-z0-9]+$/,
  refund: /^(re|pyr)_[A-Za-z0-9]+$/,
};

/** Any Stripe object id this check can meet in a column (po_: a connected-account payout). */
const ANY_STRIPE_ID = /^(pi|tr|re|pyr|po)_[A-Za-z0-9]+$/;

/**
 * The ids of one kind the database holds, from the values read out of each
 * DB_ID_COLUMNS column (`valuesByColumn["table.column"]`). Only a Stripe id of
 * THAT kind counts. A Stripe id of another kind is skipped quietly (a column
 * such as payout_settlements.stripe_ref holds tr_ / po_ / re_ / pyr_ and is
 * listed under each kind it can hold); a value that is no Stripe id at all is
 * returned in `rejected`, so a placeholder can never match and a human sees it.
 */
export function collectDbIds(kind, valuesByColumn) {
  const ids = new Set();
  const rejected = [];
  for (const { table, column } of DB_ID_COLUMNS[kind]) {
    for (const v of valuesByColumn[`${table}.${column}`] ?? []) {
      if (v === null || v === undefined || v === "") continue;
      const s = String(v);
      if (ID_PREFIX[kind].test(s)) ids.add(s);
      else if (!ANY_STRIPE_ID.test(s)) rejected.push(`${table}.${column} = ${s.slice(0, 60)}`);
    }
  }
  return { ids, rejected };
}

/**
 * Stripe-id columns that are deliberately NOT matched against a listing, each
 * with the reason. Two-way with types.ts in the test.
 */
export const NOT_MATCHED = {
  "provider_payouts.payout_transfer_id": "PayPal phase 1 (20261023223419): a uuid FK to public.payout_transfers(id) (our own row), not a Stripe id",
  "provider_refunds.provider_refund_id": "PayPal phase 1 (20261023223419): PayPal's refund id, not a Stripe id; PayPal records are reconciled against PayPal, not Stripe",
  "cancellation_fee_transfers.failed_transfer_ids": "Q2356 (20261023151810): transfers of this fee Stripe reported failed or canceled, kept so a retry never counts them as paid; the row's stripe_transfer_id is the matched record of the one that paid",
  "crew_cancellation_fee_shares.failed_transfer_ids": "Q2356 (20261023151810): the same for a crew share; the share's stripe_transfer_id is the matched record",
  "shop_pickup_addresses.stripe_tax_location_id": "a cache of a Stripe Tax location made from the row's own address; after a restore shop-checkout simply makes (or, by idempotency key, gets back) a fresh one, nothing to reconcile",
  "shop_pickup_addresses.stripe_tax_location_mode": "the Stripe mode of that cached location (live/test), not a Stripe id",
  "stuck_payment_stripe_checks.stripe_session_id": "a cache of Stripe's answer about jobs.stripe_session_id, rewritten every 15 minutes by stuck-payment-check; the job row is the record",
  "stuck_payment_stripe_checks.payment_intent_id": "the session's PaymentIntent as stuck-payment-check last read it, for the alert text only; jobs.stripe_payment_intent_id is the matched record",
  "job_checkout_nudges.stripe_session_id": "checkout nudge (20261025170841): the expired Checkout Session that triggered the one notice, kept for the notice trail; it never took money, nothing to restore",
  "jobs.stripe_session_id": "a Checkout Session; its PaymentIntent is matched through jobs.stripe_payment_intent_id",
  "job_card_holds.payment_intent_id": "card hold at posting (Q2399, 20261027185146): an authorization holds no captured money; once captured, the same PaymentIntent is jobs.stripe_payment_intent_id, the matched record",
  "job_card_holds.stripe_customer_id": "card hold at posting (Q2399): the poster's Stripe customer the saved card belongs to; customer linkage, not a money movement",
  "job_card_holds.stripe_mode": "card hold at posting (Q2399): the Stripe mode (live/test) of the hold, not a Stripe id",
  "rental_rent_charges.rent_charge_id": "not a Stripe id: a late-fee row's link to the rent row it is for (Homes rent tracker, 20261019073106, pay direct; no money moves through the app)",
  "declutter_buyer_cards.stripe_customer_id": "a saved card's Stripe customer (row 36); no money moves on it, nothing to restore",
  "stripe_customers.stripe_customer_id": "one wallet (20261018090700): the member's Stripe customer per mode; customer linkage, not a money movement, nothing to restore",
  "declutter_orders.stripe_checkout_session_id": "a Checkout Session; its PaymentIntent is declutter_orders.stripe_payment_intent_id",
  "declutter_orders.stripe_paid_at": "a timestamp (the charge's own time, B41), not a Stripe id",
  "shop_orders.stripe_checkout_session_id": "a Checkout Session; its PaymentIntent is shop_orders.stripe_payment_intent_id",
  "declutter_refunds.refund_cents": "an amount, not a Stripe id",
  "declutter_order_jobs.seller_fault_refund_id": "a uuid pointing at our own declutter_refunds row (Add a Helpr A10, 20261017073146), not a Stripe id; the Stripe refund it stands for is declutter_refunds.stripe_refund_ref",
  "shop_refunds.refund_cents": "an amount, not a Stripe id",
  "shop_hand_refunds.shop_refund_id": "our own shop_refunds row id, not a Stripe id",
  "declutter_seller_fee_debts.shop_refund_id": "our own shop_refunds row id, not a Stripe id",
  "declutter_seller_fee_debts.refund_id": "our own declutter_refunds row id, not a Stripe id",
  "declutter_refund_requests.refund_id": "our own declutter_refunds row id (the refund a settled Declutter refund request wrote, 20261026155251), not a Stripe id",
  "payout_payee_waits.payout_id": "our own payout / refund row id (uuid) whose transfer waits for the payee's Stripe setup (payout readiness, 20261019070737), not a Stripe id",
  "payout_send_marks.payout_id": "our own payout / refund row id (uuid) marked as sending (payout readiness, 20261019070737), not a Stripe id",
  "payout_settlements.off_stripe_note": "free text saying how money was paid outside Stripe ('other: ...'), not a Stripe id",
  "declutter_delivery_refunds.refund_cents": "an amount, not a Stripe id",
  "declutter_delivery_raises.refund_cents": "an amount, not a Stripe id",
  "declutter_delivery_raises.stripe_checkout_session_id": "a Checkout Session; its PaymentIntent is declutter_delivery_raises.stripe_payment_intent_id",
  "tips.stripe_session_id": "a Checkout Session; its PaymentIntent is matched through tips.stripe_payment_intent_id",
  "helpr_task_tips.stripe_session_id": "a Checkout Session; its PaymentIntent is matched through helpr_task_tips.stripe_payment_intent_id",
  "gift_cards.stripe_session_id": "a Checkout Session; its PaymentIntent is matched through gift_cards.stripe_payment_intent_id",
  "recurring_visit_payments.stripe_session_id": "a Checkout Session; its PaymentIntent is matched through recurring_visit_payments.stripe_payment_intent_id",
  "refund_notices.payment_intent_id": "the PaymentIntent a refund notice is about (Q1714), a dedupe record, not a record of that PaymentIntent",
  "payment_refunds.stripe_payment_intent_id": "the PaymentIntent a refund came from, not a record of that PaymentIntent",
  "payout_transfers.stripe_account_id": "the destination connected account, not a money movement",
  "chargeback_clawbacks.stripe_account_id": "the connected account, not a money movement",
  "payout_schedule_freezes.stripe_account_id": "the held Helpr's connected account whose payout schedule a hold froze (Q1221), not a money movement",
  "tip_hold_redrives.reversal_id": "a transfer reversal of a held tip (Q1222); NOT listed by the script (reversals live under each transfer), the same manual runbook step as chargeback_clawbacks.stripe_reversal_id",
  "chargeback_clawbacks.stripe_reversal_id": "a transfer reversal; NOT listed by the script (reversals live under each transfer) — runbook §5.1 has it as a manual step with Stripe disputes",
  "instant_payouts.stripe_payout_id": "a payout ON a connected account; listing it needs a Stripe-Account header per helper — manual step in the runbook",
  "instant_payouts.fee_transfer_id": "NIGHT-JOBSRE4-1 (20261031051513): the instant-payout fee's transfer, created and listed ON the Helpr's connected account (Stripe-Account header per helper, _shared/instantPayoutFeeReturn.ts) — same manual runbook step as instant_payouts.stripe_payout_id",
  "instant_payouts.fee_reversal_id": "NIGHT-JOBSRE4-1 (20261031051513): the reversal that gives that fee back; NOT listed by the script (reversals live under each transfer, on the connected account) — same manual step as tip_hold_redrives.reversal_id",
  "payout_failures.stripe_payout_id": "a FAILED bank payout ON a member's connected account (board 143, 20261021030052): a notice record, no platform money moves; Stripe returns the money to that account's balance. Listing it needs a Stripe-Account header per member, same manual runbook step as instant_payouts.stripe_payout_id",
  "payout_failures.stripe_account_id": "the connected account the failed payout was on, not a money movement",
  "connect_account_retirements.stripe_account_id": "a connected account stripe-connect replaced after Stripe rejected it (owner 2026-10-25), not a money movement",
  "payout_failures.stripe_event_id": "the webhook event id (evt_), a dedupe key for redelivery, not a money movement",
  "profiles.stripe_account_id": "account linkage, not a money movement",
  "profiles.stripe_customer_id": "customer linkage, not a money movement",
  "profiles.stripe_subscription_id": "subscription linkage; subscription-reconciliation re-reads it from Stripe",
  "profiles.idv_session_id": "an Identity verification session, not money",
  "disputes.execution_refund_cents": "an amount, not an id",
};

/** Candidate Stripe-id columns in types.ts, for the two-way test. */
export const CANDIDATE_COLUMN = /(stripe|payment_intent|transfer_id|refund_id|refund_cents|charge_id|payout_id|session_id|reversal_id)/;

/** The Stripe list endpoint for each kind. */
export const STRIPE_LISTS = {
  payment_intent: "/v1/payment_intents",
  transfer: "/v1/transfers",
  refund: "/v1/refunds",
};

/** PaymentIntent statuses that mean money was taken or is held. Others are abandoned checkouts. */
export const MONEY_PI_STATUSES = new Set(["succeeded", "requires_capture", "processing"]);

/**
 * Single PaymentIntents made by hand, which no rule below can recognise (no
 * metadata, no description). Exact ids only; each names where it is recorded.
 */
export const KNOWN_ONE_OFF_PIS = {
  pi_3UIpdrKp2H4b7tEC1666cTsf: "Q145 $500 TEST balance top-up, 2026-09-23 12:51Z, via the temporary tmp-q145-test-topup function (docs/archive/OPEN-done-2026-09.md Q145)",
};

/**
 * PaymentIntents the app creates WITHOUT writing their id to any row, keyed by
 * how to recognise them. They are listed for a human, never graded missing.
 */
export function unlinkableReason(pi) {
  const md = pi?.metadata ?? {};
  if (pi?.id && Object.hasOwn(KNOWN_ONE_OFF_PIS, pi.id)) return KNOWN_ONE_OFF_PIS[pi.id];
  if (pi?.invoice) return "subscription invoice (reconciled by subscription-reconciliation)";
  if (md.kind === "job_boost") return "job boost (create-boost-payment records no PaymentIntent id)";
  if (md.kind === "background_check") return "background-check fee (create-bgc-payment records no PaymentIntent id)";
  if (md.kind === "onboarding_fee") return "onboarding fee (pay-onboarding-fee records only profiles.onboarding_fee_paid)";
  // TEST balance top-ups: metadata since Q425; the description matches the ones made before it.
  if (md.kind === "platform_topup" || /^TEST-mode platform balance top-up/.test(pi?.description ?? "")) return "platform balance top-up (stripe-test-topup.yml; no DB row by design)";
  return null;
}

/** Is `page` a Stripe list object? */
export function isStripeList(page) {
  return !!page && page.object === "list" && Array.isArray(page.data) && typeof page.has_more === "boolean";
}

/** One line of context a human can act on. */
export function hint(kind, obj) {
  const md = obj?.metadata ?? {};
  const bits = [];
  for (const k of ["type", "kind", "job_id", "parent_job_id", "tipper_id", "helper_id", "dispute_id", "gift_card_id"]) if (md[k]) bits.push(`${k}=${md[k]}`);
  if (kind === "transfer" && obj?.transfer_group) bits.push(`transfer_group=${obj.transfer_group}`);
  if (kind === "transfer" && obj?.destination) bits.push(`destination=${obj.destination}`);
  if (kind === "refund" && obj?.payment_intent) bits.push(`payment_intent=${obj.payment_intent}`);
  return bits.join(" ");
}

/**
 * Grade Stripe objects of one kind against the ids the database holds.
 * `objects`: Stripe objects created in the window. `dbIds`: Set of every id of
 * that kind found in any DB_ID_COLUMNS column.
 * Returns { matched, missing, unlinkable, ignored } — `missing` is the finding.
 */
export function gradeKind(kind, objects, dbIds) {
  const out = { matched: 0, missing: [], unlinkable: [], ignored: 0 };
  for (const o of objects) {
    if (dbIds.has(o.id)) {
      out.matched++;
      continue;
    }
    if (kind === "payment_intent") {
      if (!MONEY_PI_STATUSES.has(o.status)) {
        out.ignored++;
        continue;
      }
      const why = unlinkableReason(o);
      if (why) {
        out.unlinkable.push({ id: o.id, amount: o.amount, created: o.created, why, hint: hint(kind, o) });
        continue;
      }
    }
    if (kind === "refund" && o.status && !["succeeded", "pending", "requires_action"].includes(o.status)) {
      out.ignored++;
      continue;
    }
    out.missing.push({ id: o.id, amount: o.amount, created: o.created, status: o.status ?? null, reversed: o.reversed ?? null, hint: hint(kind, o) });
  }
  return out;
}

/** Parse `--since` as ISO-8601 or epoch seconds; returns epoch seconds or throws. */
export function parseSince(value) {
  if (value === undefined || value === null || value === "") throw new Error("--since is required: the time the restored backup was taken (ISO-8601 or epoch seconds)");
  const s = String(value).trim();
  const n = /^\d{9,11}$/.test(s) ? Number(s) : Math.floor(Date.parse(s) / 1000);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--since is not a time: ${s}`);
  return n;
}

/** Which key to use for a mode, and whether it matches the mode. */
export function keyForMode(mode, env) {
  if (mode === "test") {
    const key = env.STRIPE_TEST_SECRET_KEY;
    if (!key) throw new Error("STRIPE_TEST_SECRET_KEY is not set");
    if (!/^(sk|rk)_test_/.test(key)) throw new Error("STRIPE_TEST_SECRET_KEY is not a test-mode key");
    return key;
  }
  if (mode === "live") {
    const key = env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    if (!/^(sk|rk)_live_/.test(key)) throw new Error("--mode live needs a live-mode key in STRIPE_SECRET_KEY");
    return key;
  }
  throw new Error(`--mode is required and must be test or live (not ${JSON.stringify(mode ?? "")}): after launch a default of "test" would read the sandbox and pass while live money went unchecked`);
}
