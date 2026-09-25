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
 * Where each Stripe object kind is recorded in the database.
 * @type {Record<"payment_intent" | "transfer" | "refund", { table: string, column: string }[]>}
 */
export const DB_ID_COLUMNS = {
  payment_intent: [
    { table: "jobs", column: "stripe_payment_intent_id" },
    { table: "tips", column: "stripe_payment_intent_id" },
    { table: "gift_cards", column: "stripe_payment_intent_id" },
  ],
  transfer: [
    { table: "payout_transfers", column: "stripe_transfer_id" },
    { table: "disputes", column: "execution_transfer_id" },
    { table: "referral_credits", column: "stripe_transfer_id" },
    { table: "chargeback_clawbacks", column: "original_transfer_id" },
    { table: "chargeback_clawbacks", column: "repay_transfer_id" },
  ],
  refund: [
    { table: "payment_refunds", column: "stripe_refund_id" },
    { table: "disputes", column: "execution_refund_id" },
  ],
};

/**
 * Stripe-id columns that are deliberately NOT matched against a listing, each
 * with the reason. Two-way with types.ts in the test.
 */
export const NOT_MATCHED = {
  "jobs.stripe_session_id": "a Checkout Session; its PaymentIntent is matched through jobs.stripe_payment_intent_id",
  "tips.stripe_session_id": "a Checkout Session; its PaymentIntent is matched through tips.stripe_payment_intent_id",
  "gift_cards.stripe_session_id": "a Checkout Session; its PaymentIntent is matched through gift_cards.stripe_payment_intent_id",
  "payment_refunds.stripe_payment_intent_id": "the PaymentIntent a refund came from, not a record of that PaymentIntent",
  "payout_transfers.stripe_account_id": "the destination connected account, not a money movement",
  "chargeback_clawbacks.stripe_account_id": "the connected account, not a money movement",
  "chargeback_clawbacks.stripe_reversal_id": "a transfer reversal; listed per transfer, reconciled through its original_transfer_id",
  "instant_payouts.stripe_payout_id": "a payout ON a connected account; listing it needs a Stripe-Account header per helper — manual step in the runbook",
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
 * PaymentIntents the app creates WITHOUT writing their id to any row, keyed by
 * how to recognise them. They are listed for a human, never graded missing.
 */
export function unlinkableReason(pi) {
  const md = pi?.metadata ?? {};
  if (pi?.invoice) return "subscription invoice (reconciled by subscription-reconciliation)";
  if (md.kind === "job_boost") return "job boost (create-boost-payment records no PaymentIntent id)";
  if (md.kind === "background_check") return "background-check fee (create-bgc-payment records no PaymentIntent id)";
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
  throw new Error(`--mode must be test or live, not ${mode}`);
}
