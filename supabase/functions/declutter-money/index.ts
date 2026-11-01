/**
 * declutter-money — the money cron of Declutter slice 4
 * (docs/specs/declutter-auctions.md rows 22, 67, 93, 96, 99; B53, B57).
 *
 * pg_cron posts here every 10 minutes (Bearer service key; verifyCronSecret).
 * The SQL decides every amount; this function only moves what it is told,
 * once, and reports back:
 *
 *   1. REFUNDS  declutter_refunds_due(): refund rows the webhook did not finish
 *      (pending > 2 min, or failed and past their back-off). Each is first
 *      RECONCILED against Stripe (a refund already carrying metadata.refund_id
 *      = the row id is recorded, never sent twice: Stripe's idempotency key
 *      only lives 24 h and the back-off reaches a day), then created with
 *      idempotency key `declutter-refund-<row id>` (the webhook's key and
 *      parameters, so an overlap is one refund; `-r<n>` after a refund Stripe
 *      failed), then recorded with declutter_refund_executed.
 *      The buyer is told once Stripe took it (row 44 money email).
 *   2. PAYOUTS  declutter_payouts_due(): payout rows written at handover
 *      (amount = item price minus the seller's card-fee debt, already taken by
 *      declutter_consume_fee_debt in SQL; 'nothing_due' rows never appear).
 *      Each is reconciled by transfer_group `declutter_order_<order id>`, then
 *      sent with stripe.transfers.create to the seller's Connect account,
 *      funded by the order's own charge (source_transaction), idempotency key
 *      `declutter-payout-<row id>`, and recorded with declutter_payout_executed.
 *      The seller is then emailed "Your payout is on its way" (_shared/declutterSellerEmail.ts).
 *   3. HELPR PAYOUTS (slice 5, Helpr delivery; rows 42-43)
 *      helpr_task_payouts_due(): a Helpr's pay for a confirmed delivery (the
 *      delivery fee minus jobs' flat 5% + 70c, computed in SQL). Same shape as
 *      a seller payout: reconciled in the order's transfer group by
 *      metadata.payout_id, sent from the order's own charge to the Helpr's
 *      Connect account, key `helpr-task-payout-<row id>`, recorded with
 *      helpr_task_payout_executed.
 *   4. DELIVERY-FEE REFUNDS (row 40: no Helpr in 48 h; or a delivery that never
 *      happened) declutter_delivery_refunds_due(): the delivery fee alone, back
 *      to the buyer's card. Reconciled by metadata.delivery_refund_id, sent with
 *      key `declutter-delivery-refund-<row id>`, recorded with
 *      declutter_delivery_refund_executed. metadata.kind stays
 *      "declutter_refund" so the webhook's charge.refunded path leaves it to
 *      this function.
 *   4b. DELIVERY-PAY RAISES (Q1929, row 40; 20261021185418)
 *      declutter_delivery_raise_refunds_due(): a paid raise the delivery did
 *      not use (nobody took it, the sale was cancelled, a page paid after the
 *      delivery stopped waiting) goes back in full on the raise's OWN charge,
 *      once: reconciled by metadata.raise_id, key
 *      `declutter-raise-refund-<raise id>`, recorded with
 *      declutter_delivery_raise_refund_executed. A raise the Helpr earned is
 *      paid in step 3: the payout's raise part is a transfer from the raise's
 *      own charge (_shared/helprPayoutParts.ts), the rest from the order's.
 *
 *   5. SHOPS (M1, migration 20261018164442) the order clock (shop_order_sweep),
 *      then every card hold to cancel (shop_holds_to_release) and every
 *      accepted order whose capture did not land (shop_captures_due), through
 *      _shared/shopHolds.ts with one idempotency key per capture attempt. Isolated: a
 *      Shops failure is a defect, never a stop for the steps above.
 *
 *   5b. SHOP REFUNDS (M3, migration 20261019071055) shop_refund_sweep() first
 *      (a left-out order with no ready photo 3 days after its date is refunded
 *      as the shop's fault), then shop_refunds_due(): every Shops refund the
 *      member's tap did not finish, through _shared/shopRefunds.ts (reconciled
 *      by metadata.shop_refund_id, key `shop-refund-<row id>`, recorded with
 *      shop_refund_executed). The SQL decided the amount under the order's row
 *      lock; this only sends it. Isolated like step 5.
 *
 *   5c. LOUISIANA FACILITATOR THRESHOLD (20261019071055 section 12):
 *      facilitator_threshold_check() counts the year's completed Shops +
 *      Declutter item totals; past $80,000 it pages ops once (then
 *      facilitator_alert_sent), ahead of the $100,000 registration duty.
 *
 *   6. SHOP PAYOUTS (M2, migration 20261018211820) shop_handover_sweep() first
 *      (the automatic finish), then shop_payouts_due(): a shop's item price
 *      minus its card-fee debt (taken in SQL at the handover). Same shape as a
 *      Declutter payout: reconciled in the order's transfer group
 *      `shop_order_<order id>` (set by shop-checkout) by metadata.payout_id,
 *      sent from the order's own charge, key `shop-payout-<row id>`, recorded
 *      with shop_payout_executed; the order's recorded Stripe mode (shopOrderMode)
 *      before its parties. Isolated like step 5.
 *
 *   A charge is "whole" for a payout when it is paid, not disputed, and has
 *   given back no more than the refunds the order RECORDED
 *   (refunds_recorded_cents): a delivery fee refunded on its own is known, an
 *   unknown refund (by hand, or a dispute) still moves nothing.
 *
 * Never pays or refunds (outcome, not defect): a seller on payout hold
 * (payout_holds), an account under an open ban settlement review (Q1415(c)),
 * a seller with no payout account yet (skipped, not a failed try: paid the
 * run after they set one up), parties that mix a test account and a real one. Fail closed: a
 * hold or ban-review read that fails moves no money this run.
 *
 * Stripe mode by parties (owner 2026-10-12): test accounts on the test key.
 * Stripe is LIVE on prod: tests run this file only through the edge harness.
 */
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { checkIdentityHold, checkPayoutHold } from "../_shared/payoutHold.ts";
import { isTransientStripeError, peekConnectReadiness, readConnectReadiness, transferReady, type ConnectReadiness, type ReadinessCache } from "../_shared/connectReadiness.ts";
import { syncConnectGate } from "../_shared/connectGateSync.ts";
import { loadBanReviewUsers } from "../_shared/banReview.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { queueEmail } from "../_shared/resend.ts";
import { emailSeller } from "../_shared/declutterSellerEmail.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { createStripeModeResolver, isPartyRefusal, sessionIdMode, StripeModeRefused } from "../_shared/stripeMode.ts";

/**
 * Why a party refusal (isPartyRefusal) holds a row back, in words: a mix of a
 * test and a real account, or a party that looks like a test account without
 * being enrolled (Oct 2026 money audit, finding 7).
 */
const partyWhy = (e: StripeModeRefused, what: string): string =>
  e.reason === "mixed_parties"
    ? `${what} mixes a test account and a real one`
    : `a party on ${what} looks like a test account but is not enrolled`;
import { captureShopHold, releaseShopHold, shopOrderMode, type ShopHoldRow } from "../_shared/shopHolds.ts";
import { sendShopRefund, type ShopRefundRow } from "../_shared/shopRefunds.ts";
import { heldTipParts, helprPayoutParts, type PayoutPart } from "../_shared/helprPayoutParts.ts";

const FN = "declutter-money";
const BATCH = 25;

// deno-lint-ignore no-explicit-any
type Db = any;

type RefundDue = {
  refund_id: string;
  reason: string;
  order_id: string | null;
  buyer_id: string | null;
  seller_id: string | null;
  payment_intent_id: string;
  refund_cents: number;
  attempts: number;
  /** The payment's Stripe mode, recorded by the webhook (null: not recorded). */
  livemode: boolean | null;
  /** The order's Checkout Session id (null: no order, or no page): its cs_live_/cs_test_ prefix names the mode. */
  checkout_session_id?: string | null;
};
type PayoutDue = {
  payout_id: string;
  order_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  amount_cents: number;
  stripe_account_id: string | null;
  payment_intent_id: string | null;
  attempts: number;
  /** Refunds the order recorded (not failed): the most the charge may have given back. */
  refunds_recorded_cents?: number | null;
};
/** declutter_manager_payouts_due (20261101233256): the manager's share of one sale, paid to the MANAGER's account. */
type ManagerPayoutDue = {
  payout_id: string;
  order_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  manager_id: string | null;
  amount_cents: number;
  stripe_account_id: string | null;
  payment_intent_id: string | null;
  attempts: number;
  refunds_recorded_cents?: number | null;
};
type HelprPayoutDue = {
  payout_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
  helpr_id: string | null;
  customer_id: string | null;
  pickup_contact_id: string | null;
  amount_cents: number;
  stripe_account_id: string | null;
  payment_intent_id: string | null;
  transfer_group: string | null;
  refunds_recorded_cents: number | null;
  attempts: number;
  /** Q1929: how much of the pay came from paid raises, and each raise's own charge (20261021185418). */
  raised_cents?: number | null;
  raise_parts?: unknown;
  /** Owner #3706: each held delivery tip of this payout, paid and not yet sent (20261028014848). */
  tip_parts?: unknown;
};
type ShopPayoutDue = {
  payout_id: string;
  order_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  amount_cents: number;
  stripe_account_id: string | null;
  payment_intent_id: string | null;
  /** The payment's Stripe mode, recorded by the webhook (null: not recorded). */
  livemode: boolean | null;
  checkout_session_id: string | null;
  attempts: number;
};
type DeliveryRefundDue = {
  delivery_refund_id: string;
  reason: string;
  order_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  payment_intent_id: string;
  refund_cents: number;
  attempts: number;
  checkout_session_id: string | null;
};

/** Q1929: a paid raise of a delivery's pay to give back in full, on its OWN charge. */
type RaiseRefundDue = {
  raise_id: string;
  reason: string;
  order_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  payment_intent_id: string;
  refund_cents: number;
  attempts: number;
  livemode: boolean | null;
  checkout_session_id: string | null;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const tookIt = (status: string | null | undefined) => status !== "failed" && status !== "canceled";

/**
 * The order's charge, if a payout may be funded from it: paid, not disputed,
 * and refunded by no more than the order recorded (lh-money-escrow review 3.4;
 * slice 5: a delivery fee refunded on its own is a known refund). Throws
 * "the order's charge is not whole" otherwise, so nothing moves.
 */
async function wholeCharge(stripe: Stripe, paymentIntentId: string | null, refundsRecordedCents: number | null | undefined): Promise<string> {
  if (!paymentIntentId) throw new Error("the order has no payment to pay from");
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const known = Math.max(0, Number(refundsRecordedCents ?? 0));
  if (pi.status !== "succeeded" || !ch || ch.amount_refunded > known || ch.disputed) {
    throw new Error(`the order's charge is not whole (status ${pi.status}, refunded ${ch?.amount_refunded ?? "?"}, recorded ${known}, disputed ${ch?.disputed ?? "?"})`);
  }
  return ch.id;
}

/** Best-effort money email (row 44). Never throws: the money already moved. */
async function tellBuyerRefunded(admin: Db, buyerId: string | null, cents: number): Promise<void> {
  if (!buyerId) return;
  try {
    const { data: profile, error } = await admin.from("profiles").select("email").eq("user_id", buyerId).maybeSingle();
    const to = (profile as { email?: string | null } | null)?.email;
    if (error || !to) return;
    const link = `${getAppUrl()}/declutter?tab=buying`;
    const body = `${dollars(cents)} is on its way back to your card. Card refunds usually show up in 5 to 10 business days.`;
    await queueEmail(admin, {
      to,
      subject: "Your Declutter refund",
      templateName: "declutter_refund",
      html: `<p>${body}</p><p><a href="${link}">Open your Declutter cart</a></p>`,
      text: `${body}\n\nOpen your Declutter cart: ${link}`,
    });
  } catch (e) {
    console.log(JSON.stringify({ event: "declutter_refund_email_failed", detail: caughtMessage(e, "email failed") }));
  }
}

/** declutter_payouts_due stops offering a row after 12 tries: the 12th failure pages, so nobody is left unpaid silently. */
async function pageIfLastTry(p: PayoutDue, why: string): Promise<void> {
  if (p.attempts + 1 < 12) return;
  await postSlackOpsAlert({
    kind: "payout_failed", severity: "critical",
    title: "Declutter seller payout gave up",
    // A charge that is not whole (refunded or disputed) must NEVER be paid by hand (lh-money-escrow review of lane J, 3).
    message: /charge is not whole/.test(why)
      ? `Payout ${p.payout_id} (${dollars(p.amount_cents)}, order ${p.order_id}) gave up: the order's charge was refunded or disputed. Do NOT pay the seller by hand; decide the order first. Last reason: ${why.slice(0, 200)}.`
      : `Payout ${p.payout_id} (${dollars(p.amount_cents)}, order ${p.order_id}) failed 12 times. Last reason: ${why.slice(0, 200)}. Pay it by hand.`,
    fields: { Group: `declutter_order_${p.order_id}` },
  });
}

serve(async (req) => {
  const refused = verifyCronSecret(req);
  if (refused) return refused;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    // A cron's reads are bounded so one hung request cannot stall the run (cronReadsCannotHang).
    { global: { fetch: boundedFetch() } },
  );
  const modes = createStripeModeResolver(admin, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" }));
  const defects = defectTracker();
  // Money review 3.6: a refund runs on the key that took the payment. The row's
  // recorded mode wins; with none recorded (rows written by SQL: no-shows,
  // problem decisions), the order's Checkout Session id prefix names it
  // (re-review should-fix 3). Every source present must agree (recorded vs
  // page, and the parties when the row has an order); any disagreement moves
  // nothing. An orderless row with no recorded mode is never guessed: it waits
  // for a person.
  const refundClient = async (r: RefundDue): Promise<{ stripe: Stripe } | null> => {
    const hasParties = !!(r.buyer_id || r.seller_id);
    const recorded = r.livemode === true ? "live" : r.livemode === false ? "test" : null;
    const byPage = sessionIdMode(r.checkout_session_id);
    if (recorded && byPage && recorded !== byPage) throw new Error(`refund row says ${recorded} but its order's page is ${byPage}`);
    const mode = recorded ?? byPage;
    if (mode) {
      if (hasParties) {
        const byParties = await modes.modeForParties([r.buyer_id, r.seller_id], "refund");
        if (byParties !== mode) throw new Error(`refund row says ${mode} but its parties are ${byParties}`);
      }
      return { stripe: modes.clientFor(mode) };
    }
    if (!hasParties) return null;
    // A refund returns money already taken: an unenrolled test-looking party is not refused (Q4).
    return await modes.clientForParties([r.buyer_id, r.seller_id], "refund");
  };
  const out = {
    refunds_sent: 0, refunds_reconciled: 0, refunds_failed: 0, refunds_gave_up: 0,
    payouts_sent: 0, payouts_reconciled: 0, payouts_failed: 0,
    manager_payouts_sent: 0, manager_payouts_reconciled: 0, manager_payouts_failed: 0,
    helpr_payouts_sent: 0, helpr_payouts_reconciled: 0, helpr_payouts_failed: 0, held_tips_stranded: 0,
    delivery_refunds_sent: 0, delivery_refunds_reconciled: 0, delivery_refunds_failed: 0,
    raise_refunds_sent: 0, raise_refunds_reconciled: 0, raise_refunds_failed: 0,
    held: 0, ban_review: 0, no_payout_account: 0, payout_account_not_ready: 0, payout_account_unreadable: 0,
    payee_setup_paged: 0, payee_banned: 0, payout_retry_later: 0, mixed_parties: 0,
    shop_expired: 0, shop_holds_released: 0, shop_captures: 0, shop_capture_retries: 0, shop_holds_lost: 0,
    shop_handed_over: 0, shop_payouts_sent: 0, shop_payouts_reconciled: 0, shop_payouts_failed: 0,
    shop_no_photo_refunded: 0, shop_refunds_sent: 0, shop_refunds_reconciled: 0, shop_refunds_failed: 0,
  };

  // Payouts a payee cannot receive yet (/code-review of f6551863a, 20261019070737). Every row a
  // loop below SKIPS is deferred (payout_defer: next_attempt_at moves forward, no try used), so a
  // skipped row never stays at the front of its 25-row queue and starves the ready ones. Before
  // ANY Stripe call, a payee with no payout account, or one already found not payable this run,
  // is deferred (a row that has used a try is reconciled first: a transfer may exist). Otherwise
  // the readiness read (_shared/connectReadiness.ts transferReady, one read per mode + account per
  // run) runs only AFTER the reconcile (a sent-but-unrecorded transfer is recorded, never paged or
  // paid twice) and after wholeCharge (a refunded or disputed order still fails loudly). A passing
  // Stripe or lookup failure before the transfer is deferred too, never a failed try.
  const readiness: ReadinessCache = new Map();
  /** The Stripe transfer group (or refund payment) of each row this run touches, for the page text. */
  const groupOf = new Map<string, string | null>();
  /** Rows a transfer / refund may already exist for (a try used or a send started). */
  const maybeSentRows = new Set<string>();
  /** Accounts Stripe refused our read of this run, per mode (3+ = our key, not the payees). */
  const refusedAccounts = new Map<string, Set<string>>();
  /** Modes whose platform-key probe already ran this run. */
  const probedModes = new Set<string>();
  const gateSynced = new Set<string>();
  type PayoutKind = "declutter" | "helpr_task" | "shop" | "declutter_manager";
  type SkipKind = PayoutKind | "declutter_refund" | "delivery_refund";
  let waitRpcMissing = false;
  /** A 20261019070737 RPC; PGRST202 (edge deployed before the migration) is one defect a run, not one per row. */
  const waitRpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await admin.rpc(name, args);
    if (!error) return data;
    if ((error as { code?: string }).code === "PGRST202") {
      if (!waitRpcMissing) defects.record(`${name}: not deployed yet (PGRST202); skipped rows are not deferred this run`);
      waitRpcMissing = true;
      return null;
    }
    defects.record(`${name} failed: ${error.message}`.slice(0, 200));
    return null;
  };
  const deferRow = (kind: SkipKind, rowId: string, minutes: number) =>
    waitRpc("payout_defer", { p_kind: kind, p_payout_id: rowId, p_minutes: minutes });
  /** Any end for a payout (paid, settled by hand, gave up): its wait goes, so a later wait starts fresh. */
  const clearWait = (kind: PayoutKind, payoutId: string) =>
    waitRpc("payout_payee_wait_cleared", { p_kind: kind, p_payout_id: payoutId });
  // Waits of payouts that ended any other way (cancelled, nothing due, gave up elsewhere).
  await waitRpc("payout_payee_waits_prune", {});
  // Held rows never go quiet: re-raised into the ops ledger daily, the person owed told once.
  await waitRpc("payout_held_check", {});
  type WaitCategory = "no_account" | "setup_unfinished" | "under_review" | "rejected" | "unusable"
    | "payee_deleted" | "mixed_parties" | "banned" | "data_defect" | "transient" | "record_failed" | "unreadable" | "held" | "ban_review"
    | "suspended" | "needs_reconcile" | "identity";
  type WaitKind = PayoutKind | "declutter_refund" | "delivery_refund";
  /**
   * Reasons that will not fix themselves: once the page goes out the row is HELD FOR REVIEW
   * (payout_hold_for_review: out of every queue until an admin releases it or marks it settled).
   */
  const STUCK: ReadonlySet<WaitCategory> = new Set(["rejected", "unusable", "payee_deleted", "mixed_parties", "banned", "data_defect", "needs_reconcile"]);
  const WAIT_WORDS: Record<WaitCategory, string> = {
    no_account: "the payee has not set up payouts",
    setup_unfinished: "the payee has not finished Stripe payout setup",
    under_review: "Stripe is still reviewing the payee's payout account",
    rejected: "Stripe rejected the payee's payout account",
    unusable: "the payee's payout account is gone or unusable",
    payee_deleted: "the payee deleted their Louisiana Helpr account",
    mixed_parties: "the order mixes a test account and a real one",
    banned: "the payee is banned",
    suspended: "the payee's account is suspended for now",
    needs_reconcile: "a transfer may already exist and could not be checked automatically (check Stripe by hand)",
    data_defect: "the row cannot be paid as recorded (a data defect)",
    transient: "Stripe or our test-account lookup kept failing",
    record_failed: "a transfer Stripe holds could not be recorded",
    unreadable: "Stripe refuses our read of this payee's payout account",
    held: "an admin payout hold",
    ban_review: "a ban review",
    identity: "the payee has not verified their ID",
  };
  /**
   * EVERY deferred payout is recorded (no defer is unbounded): payout_payee_wait_seen reminds the
   * payee when they can act, and answers page_due once per payout when the reason's bound is reached
   * (at once / 24 h / 7 days), again only when it turns into a reason that will not fix itself.
   */
  const noteWaiting = async (kind: WaitKind, payoutId: string, payeeId: string | null, amountCents: number,
    category: WaitCategory, reason: string) => {
    const group = groupOf.get(payoutId) ?? null;
    const w = await waitRpc("payout_payee_wait_seen", {
      p_kind: kind, p_payout_id: payoutId, p_payee: payeeId, p_amount_cents: amountCents, p_category: category, p_reason: reason,
    }) as { page_due?: boolean; waiting_since?: string; payee_seed?: boolean } | null;
    if (w?.page_due !== true) return;
    // Marked only after the post went through (a failed post is tried next run). A warning kind;
    // a test account's routes as seed (the digest, not the channel).
    const stuck = STUCK.has(category);
    const delivered = await postSlackOpsAlert({
      kind: "payout_wait", severity: "warning", seed: w.payee_seed === true, oncePerDayKey: `payout-wait-${kind}-${payoutId}-${category}`,
      title: stuck ? "A payout won't pay itself: held for review" : "A payout has been waiting too long",
      message: `${dollars(amountCents)} (${kind} ${payoutId}${group ? `, Stripe group/payment ${group}` : ""}) is held on the platform because ${WAIT_WORDS[category]}, since ${w.waiting_since ?? "?"}. `
        + (category === "needs_reconcile"
          ? "It is now HELD FOR REVIEW. A transfer for THIS row may already exist: search Stripe for it by its payout metadata (payout_id) and its transfer group above, never another payout of the same payee; if you find it, \"Mark settled by hand\" with that tr_ (or re_); if not, \"Release to automatic\" and confirm no transfer was made."
          : stuck
          ? "It won't pay itself and is now HELD FOR REVIEW (no automatic retry). On the admin money page: \"Release to automatic\" once the cause is fixed (after confirming in Stripe nothing was sent), or contact the payee, pay by hand after checking Stripe for a transfer to their account, and \"Mark settled by hand\" with the Stripe id (or \"other: how it was paid\")."
          : "It is retried and pays itself once that clears; look into why it has not.")
        + ` ${reason.slice(0, 160)}`,
      fields: { Payee: payeeId ?? "deleted", Reason: category, Group: group ?? "?" },
    });
    if (delivered === false) return;
    if (stuck) await waitRpc("payout_hold_for_review", { p_kind: kind, p_id: payoutId, p_category: category, p_reason: reason });
    else await waitRpc("payout_payee_paged", { p_kind: kind, p_payout_id: payoutId, p_category: category });
    out.payee_setup_paged++;
  };
  /** Defer a payout row (no try used) AND record why, so its wait is bounded. */
  const skipRow = async (kind: WaitKind, payoutId: string, payeeId: string | null, amountCents: number,
    minutes: number, category: WaitCategory, reason: string) => {
    // A row a transfer / refund may already exist for, on a reason that could not look at Stripe
    // first, is held as needs_reconcile: the page says to search Stripe before anything else.
    if ((category === "mixed_parties" || category === "data_defect") && maybeSentRows.has(payoutId)) {
      category = "needs_reconcile";
    }
    await deferRow(kind, payoutId, minutes);
    await noteWaiting(kind, payoutId, payeeId, amountCents, category, reason);
  };
  /** A problem worth an ops line once a day per key, not a defect on every run. */
  const onceADay = (key: string, title: string, message: string) =>
    postSlackOpsAlert({ kind: "custom", severity: "warning", oncePerDayKey: key, title, message });
  /** A stale "payouts enabled" cache is corrected once per payee per run (the gate's one writer). */
  const resyncGate = async (stripe: Stripe, payeeId: string | null, account: Stripe.Account): Promise<"banned" | null> => {
    if (!payeeId || gateSynced.has(payeeId)) return null;
    gateSynced.add(payeeId);
    const { data: prof, error } = await admin.from("profiles")
      .select("stripe_account_id, stripe_identity_verified, stripe_charges_enabled, stripe_payouts_enabled")
      .eq("user_id", payeeId).maybeSingle();
    if (error) {
      defects.record(`payee ${payeeId}: profile read for the gate failed: ${error.message}`.slice(0, 200));
      return null;
    }
    const profile = prof as { stripe_account_id: string | null; stripe_identity_verified: boolean | null;
      stripe_charges_enabled: boolean | null; stripe_payouts_enabled: boolean | null } | null;
    if (!profile?.stripe_account_id || profile.stripe_account_id !== account.id) return null;
    // Only ever to CLOSE a stale open gate: never open it (or send "Payout account verified")
    // from here while Stripe will not take a transfer; stripe-connect's own sync opens it.
    if (transferReady(account) || !(profile.stripe_payouts_enabled === true && profile.stripe_charges_enabled === true)) return null;
    const synced = await syncConnectGate(stripe, admin, payeeId, { ...profile, stripe_account_id: profile.stripe_account_id }, account);
    if (synced.kind === "banned") {
      out.payee_banned++;
      return "banned";
    }
    if (synced.writeError) defects.record(`payee ${payeeId}: gate re-sync failed: ${synced.writeError}`.slice(0, 200));
    return null;
  };
  /** What a readiness answer means for this row. true = send the transfer; false = deferred (no try). */
  const actOnReadiness = async (
    r: ConnectReadiness, stripe: Stripe | null, kind: PayoutKind, payoutId: string, payeeId: string | null,
    mode: string, accountId: string, amountCents: number,
  ): Promise<boolean> => {
    if (r.kind === "ready") return true;
    if (r.kind === "error" && r.transient) {
      // A real Stripe connection error / 429 / 5xx: later, without using a try; one line a day per
      // account, and the 24-hour bound pages if it never clears.
      out.payout_account_unreadable++;
      await onceADay(`connect-read-transient-${mode}-${accountId}`, "Stripe account reads keep failing",
        `Reading payout account ${accountId} (${mode}) failed: ${r.message.slice(0, 200)}. Its payouts are retried without using tries.`);
      await skipRow(kind, payoutId, payeeId, amountCents, 15, "transient", r.message);
      return false;
    }
    if (r.kind === "error") {
      out.payout_account_unreadable++;
      if (!r.accountSpecific) {
        // Not about this account at all (401 invalid / expired key, a code bug): our key. One
        // critical line per mode per day; the row waits (no try is used).
        await postSlackOpsAlert({
          kind: "custom", severity: "critical", oncePerDayKey: `connect-read-refused-${mode}`,
          title: "Our Stripe key can't read Connect accounts",
          message: `Reading payout account ${accountId} on the ${mode} key failed with an error that names no account: ${r.message.slice(0, 200)}. Payouts wait until this is fixed.`,
          fields: { Mode: mode },
        });
        await skipRow(kind, payoutId, payeeId, amountCents, 60, "unreadable", r.message);
        return false;
      }
      // Stripe refused our read of THIS account: that payee's problem first (per-account line, a
      // bounded payee wait, no try). Our key only if 3+ accounts fail so in one run AND a read of
      // the platform's own balance fails too.
      const refused = refusedAccounts.get(mode) ?? new Set<string>();
      refused.add(accountId);
      refusedAccounts.set(mode, refused);
      await onceADay(`connect-read-refused-${mode}-${accountId}`, "A payout account could not be read",
        `Stripe refused reading payout account ${accountId} (${mode}): ${r.message.slice(0, 200)}. Its payouts wait (no try is used).`);
      if (refused.size >= 3 && stripe && !probedModes.has(mode)) {
        probedModes.add(mode);
        let keyBroken = false;
        try {
          await stripe.balance.retrieve();
        } catch {
          // The platform's own balance cannot be read either: the key, not the payees.
          keyBroken = true;
        }
        if (keyBroken) {
          await postSlackOpsAlert({
            kind: "custom", severity: "critical", oncePerDayKey: `connect-read-refused-${mode}`,
            title: "Our Stripe key can't read Connect accounts",
            message: `${refused.size} payout accounts on the ${mode} key could not be read this run and the platform balance read failed too (last: ${r.message.slice(0, 160)}). Payouts wait until this is fixed.`,
            fields: { Mode: mode },
          });
        }
      }
      await skipRow(kind, payoutId, payeeId, amountCents, 60, "unreadable", r.message);
      return false;
    }
    out.payout_account_not_ready++;
    if (r.kind === "not_ready" && stripe && (await resyncGate(stripe, payeeId, r.account)) === "banned") {
      // The re-sync matched a banned person's bank (ban evasion): held for review at once.
      await skipRow(kind, payoutId, payeeId, amountCents, 1440, "banned", "ban-evasion match on the payout account");
      return false;
    }
    await skipRow(kind, payoutId, payeeId, amountCents, 60, r.kind === "unusable" ? "unusable" : r.category, r.reason);
    return false;
  };
  /**
   * Before any (more) Stripe call: no payout account, or this account already found not payable
   * this run. true = handled (deferred, wait recorded); false = go on.
   */
  const unpayableNow = async (kind: PayoutKind, payoutId: string, payeeId: string | null, accountId: string | null,
    amountCents: number, mode: string | null): Promise<boolean> => {
    if (!accountId) {
      // Not a failed try (lh-money-escrow review 2.1): paid once the payee sets up payouts. A payee
      // who deleted their account never will: paged at once, retried only daily.
      out.no_payout_account++;
      if (payeeId) await skipRow(kind, payoutId, payeeId, amountCents, 60, "no_account", "no payout account");
      else await skipRow(kind, payoutId, null, amountCents, 1440, "payee_deleted", "payee account deleted: money held, decide by hand");
      return true;
    }
    const hit = mode ? peekConnectReadiness(readiness, mode, accountId) : undefined;
    if (!hit) return false;
    return !(await actOnReadiness(await hit, null, kind, payoutId, payeeId, mode as string, accountId, amountCents));
  };
  /** The live backstop before a transfer. true = send it; false = not this run (deferred, no try used). */
  const payeeReadyNow = async (stripe: Stripe, mode: string, kind: PayoutKind, payoutId: string, payeeId: string | null,
    accountId: string, amountCents: number) =>
    actOnReadiness(await readConnectReadiness(stripe, mode, accountId, readiness), stripe, kind, payoutId, payeeId, mode, accountId, amountCents);
  /** A passing failure BEFORE the transfer (Stripe connection / 429 / 5xx, or the test-account lookup): defer, no try. */
  const transientBeforeSend = (e: unknown) =>
    isTransientStripeError(e) || (e as { reason?: unknown } | null)?.reason === "lookup_failed";
  /** The payouts of this batch a send was already started for (a transfer may exist). */
  const sendMarks = async (kind: PayoutKind, ids: string[]): Promise<Set<string>> => {
    if (ids.length === 0) return new Set();
    const data = await waitRpc("payout_send_marks_for", { p_kind: kind, p_ids: ids });
    return new Set(((data ?? []) as Array<string | { payout_send_marks_for?: string }>)
      .map((x) => (typeof x === "string" ? x : x?.payout_send_marks_for ?? "")).filter(Boolean));
  };
  /**
   * Marked BEFORE the transfer call. false = do not send this run (the mark could not be
   * written); a missing migration (PGRST202) sends as before rather than stopping every payout.
   */
  /**
   * Right before the transfer: a payout hold or a ban placed since the queue was read stops it
   * (the row is deferred or held for review, never sent).
   */
  const stillPayableNow = async (kind: PayoutKind, payoutId: string, payeeId: string | null, amountCents: number): Promise<boolean> => {
    const hold = await checkPayoutHold(admin, payeeId);
    if (hold.kind === "error") {
      await skipRow(kind, payoutId, payeeId, amountCents, 15, "transient", `payout hold re-check failed: ${hold.message}`);
      return false;
    }
    if (hold.kind === "held") {
      out.held++;
      await skipRow(kind, payoutId, payeeId, amountCents, 60, "held", "an admin payout hold placed during the run");
      return false;
    }
    // No payout without a verified ID (owner 2026-10-30): a wait, no try used, the payee told.
    const idHold = await checkIdentityHold(admin, payeeId);
    if (idHold.kind === "error") {
      await skipRow(kind, payoutId, payeeId, amountCents, 15, "transient", `ID check read failed: ${idHold.message}`);
      return false;
    }
    if (idHold.kind === "waits") {
      out.held++;
      await skipRow(kind, payoutId, payeeId, amountCents, 60, "identity", "ID check not finished");
      return false;
    }
    const { data: prof, error } = await admin.from("profiles").select("ban_status, auto_suspended_until").eq("user_id", payeeId).maybeSingle();
    if (error) {
      await skipRow(kind, payoutId, payeeId, amountCents, 15, "transient", `ban re-check failed: ${error.message}`);
      return false;
    }
    const p = prof as { ban_status?: string | null; auto_suspended_until?: string | null } | null;
    // A permanent ban holds the payout for review; a temporary suspension (a strike) is a bounded
    // wait that resumes on its own when it ends (an open-ended temp ban is treated as permanent).
    const suspendedUntil = p?.ban_status === "temp_banned" && p.auto_suspended_until ? new Date(p.auto_suspended_until).getTime() : null;
    if (suspendedUntil !== null && suspendedUntil > Date.now()) {
      out.held++;
      const minutes = Math.min(1440, Math.max(15, Math.ceil((suspendedUntil - Date.now()) / 60000)));
      await skipRow(kind, payoutId, payeeId, amountCents, minutes, "suspended", `suspended until ${p?.auto_suspended_until}`);
      return false;
    }
    const banned = p?.ban_status === "banned" || p?.ban_status === "permanently_banned"
      || (p?.ban_status === "temp_banned" && !p.auto_suspended_until);
    if (banned) {
      out.payee_banned++;
      await skipRow(kind, payoutId, payeeId, amountCents, 1440, "banned", `payee ${p?.ban_status}`);
      return false;
    }
    return true;
  };
  const markSending = async (kind: PayoutKind, payoutId: string, payeeId: string | null, amountCents: number): Promise<boolean> => {
    const { error } = await admin.rpc("payout_mark_sending", { p_kind: kind, p_payout_id: payoutId });
    if (!error) return true;
    if ((error as { code?: string }).code === "PGRST202") {
      if (!waitRpcMissing) defects.record("payout_mark_sending: not deployed yet (PGRST202); sending without the mark");
      waitRpcMissing = true;
      return true;
    }
    defects.record(`${kind} payout ${payoutId}: send mark failed, not sent this run: ${error.message}`.slice(0, 200));
    await skipRow(kind, payoutId, payeeId, amountCents, 15, "transient", `send mark failed: ${error.message}`);
    return false;
  };

  // 5. SHOPS M1 (migration 20261018164442): the order clock, then every hold to
  //    cancel (an order that ended unpaid: nothing is kept, cancelling costs
  //    nothing) and every accepted order's capture that did not land on the tap
  //    (_shared/shopHolds.ts, one key per capture attempt). Its own try: a Shops failure
  //    is a defect of this run and never stops Declutter's refunds or payouts.
  try {
    const swept = await admin.rpc("shop_order_sweep", {});
    if (swept.error) defects.record(`shop_order_sweep failed: ${swept.error.message}`);
    else {
      const sw = (swept.data ?? {}) as { no_answer?: number; page_unpaid?: number };
      out.shop_expired = Number(sw.no_answer ?? 0) + Number(sw.page_unpaid ?? 0);
    }
    // A release gives the hold back ("refund", runs for anyone, Q4); a capture takes it ("new").
    const shopClient = async (r: ShopHoldRow, kind: "new" | "refund") => {
      const mode = shopOrderMode(r);
      return mode ? modes.clientFor(mode) : (await modes.clientForParties([r.buyer_id, r.seller_id], kind)).stripe;
    };
    const [releaseRes, captureRes] = await Promise.all([
      admin.rpc("shop_holds_to_release", { p_limit: BATCH }),
      admin.rpc("shop_captures_due", { p_limit: BATCH }),
    ]);
    if (releaseRes.error) defects.record(`shop_holds_to_release failed: ${releaseRes.error.message}`);
    for (const r of (releaseRes.data ?? []) as ShopHoldRow[]) {
      try {
        const done = await releaseShopHold(await shopClient(r, "refund"), admin, r);
        if (done === "captured_needs_refund") defects.record(`shop order ${r.order_id}: closed but its payment was captured; refund it by hand`);
        else out.shop_holds_released++;
      } catch (e) {
        defects.record(`shop hold ${r.order_id}: ${caughtMessage(e, "release failed")}`.slice(0, 200));
      }
    }
    if (captureRes.error) defects.record(`shop_captures_due failed: ${captureRes.error.message}`);
    for (const c of (captureRes.data ?? []) as Array<ShopHoldRow & { attempts: number }>) {
      if (!c.payment_intent_id) continue;
      try {
        const done = await captureShopHold(await shopClient(c, "new"), admin, c.order_id, c.payment_intent_id, Number(c.attempts ?? 0));
        if (done === "captured") out.shop_captures++;
        else if (done === "hold_lost") out.shop_holds_lost++;
        else out.shop_capture_retries++;
      } catch (e) {
        defects.record(`shop capture ${c.order_id}: ${caughtMessage(e, "capture failed")}`.slice(0, 200));
      }
    }
  } catch (e) {
    defects.record(`shops step: ${caughtMessage(e, "failed")}`.slice(0, 200));
  }

  // 5b. SHOP REFUNDS M3 (migration 20261019071055): the no-photo clock, then every
  //     refund row the member's tap did not send. The SQL decided each amount
  //     under the order's row lock (reason -> fee policy -> amount are table
  //     CHECKs); _shared/shopRefunds.ts reconciles, then sends with key
  //     shop-refund-<row id>. Its own try, like step 5.
  try {
    const noPhoto = await admin.rpc("shop_refund_sweep", {});
    if (noPhoto.error) defects.record(`shop_refund_sweep failed: ${noPhoto.error.message}`);
    else out.shop_no_photo_refunded = Number((noPhoto.data as { no_ready_photo_refunded?: number } | null)?.no_ready_photo_refunded ?? 0);
    const dueRefunds = await admin.rpc("shop_refunds_due", { p_limit: BATCH });
    if (dueRefunds.error) defects.record(`shop_refunds_due failed: ${dueRefunds.error.message}`);
    for (const r of (dueRefunds.data ?? []) as ShopRefundRow[]) {
      try {
        const mode = shopOrderMode({ livemode: r.livemode, checkout_session_id: r.checkout_session_id });
        const stripe = mode ? modes.clientFor(mode) : (await modes.clientForParties([r.buyer_id, r.seller_id], "refund")).stripe;
        const done = await sendShopRefund(stripe, admin, r);
        if (done === "sent") out.shop_refunds_sent++;
        else if (done === "reconciled") out.shop_refunds_reconciled++;
        else {
          out.shop_refunds_failed++;
          defects.record(`shop refund ${r.refund_id}: Stripe refused it (try ${Number(r.attempts ?? 0) + 1})`);
        }
      } catch (e) {
        defects.record(`shop refund ${r.refund_id}: ${caughtMessage(e, "refund failed")}`.slice(0, 200));
      }
    }
  } catch (e) {
    defects.record(`shop refunds step: ${caughtMessage(e, "failed")}`.slice(0, 200));
  }

  // 5c. The Louisiana marketplace-facilitator early warning (R.S. 47:340.1: the
  //     duty to register starts at $100,000 of facilitated retail sales delivered
  //     into Louisiana in a calendar year). The SQL counts completed Shops +
  //     Declutter item totals and writes one row per year at $80,000 (admins told
  //     in-app once); this posts the ops alert until it is marked sent.
  try {
    const fac = await admin.rpc("facilitator_threshold_check", {});
    if (fac.error) defects.record(`facilitator_threshold_check failed: ${fac.error.message}`);
    const f = (fac.data ?? null) as { year?: number; total_cents?: number; ops_alert_due?: boolean } | null;
    if (f?.ops_alert_due === true && typeof f.year === "number") {
      // Marked sent ONLY when the post was delivered (/code-review of shops-m3-v1 #3):
      // a post that failed stays due and is tried again on the next run.
      const delivered = await postSlackOpsAlert({
        kind: "money_at_risk", severity: "critical", oncePerDayKey: `la-facilitator-threshold-${f.year}`,
        title: "Louisiana marketplace-facilitator threshold: $80,000 passed",
        message: `Shops + Declutter sales delivered into Louisiana reached ${dollars(Number(f.total_cents ?? 0))} in ${f.year} (items only, no fees or tax). Registration with the Remote Sellers Commission is required within 30 days of passing $100,000 (R.S. 47:340.1). Start it now.`,
        fields: { Year: String(f.year), Total: dollars(Number(f.total_cents ?? 0)) },
      });
      if (delivered === true) {
        const { error: sentErr } = await admin.rpc("facilitator_alert_sent", { p_year: f.year });
        if (sentErr) defects.record(`facilitator_alert_sent failed: ${sentErr.message}`);
      } else {
        defects.record(`facilitator alert for ${f.year} not delivered; retried next run`);
      }
    }
  } catch (e) {
    defects.record(`facilitator step: ${caughtMessage(e, "failed")}`.slice(0, 200));
  }

  // 6. SHOP PAYOUTS (M2, migration 20261018211820): the automatic finish, then every
  //    shop owed for a handed-over order. Its own try, like step 5.
  try {
    const finished = await admin.rpc("shop_handover_sweep", {});
    if (finished.error) defects.record(`shop_handover_sweep failed: ${finished.error.message}`);
    else out.shop_handed_over = Number((finished.data as { auto_handed_over?: number } | null)?.auto_handed_over ?? 0);
    const due = await admin.rpc("shop_payouts_due", { p_limit: BATCH });
    if (due.error) defects.record(`shop_payouts_due failed: ${due.error.message}`);
    const shopPayouts = (due.data ?? []) as ShopPayoutDue[];
    const shopReview = shopPayouts.length === 0
      ? { ok: true as const, users: new Set<string>() }
      : await loadBanReviewUsers(admin, [...new Set(shopPayouts.flatMap((p) => [p.buyer_id, p.seller_id]).filter((x): x is string => !!x))]);
    // Fail closed: a ban-review read that failed moves no shop money this run.
    if (!shopReview.ok) defects.record(`shop payouts: ban review read failed: ${shopReview.message}`);
    const underReview: Set<string> = shopReview.ok ? shopReview.users : new Set();
    const shopMarked = await sendMarks("shop", shopPayouts.map((x) => x.payout_id));
    // A transfer may exist when a try was used or a send was started (marked before the call).
    const maybeSent_shop = (x: ShopPayoutDue) => Number(x.attempts ?? 0) > 0 || shopMarked.has(x.payout_id);
    for (const p of shopReview.ok ? shopPayouts : []) {
      groupOf.set(p.payout_id, `shop_order_${p.order_id}`);
      if (maybeSent_shop(p)) maybeSentRows.add(p.payout_id);
      if ((p.seller_id && underReview.has(p.seller_id)) || (p.buyer_id && underReview.has(p.buyer_id))) {
        out.ban_review++;
        await skipRow("shop", p.payout_id, p.seller_id, p.amount_cents, 60, "ban_review", "a party is under ban review");
        continue;
      }
      const shopHold = await checkPayoutHold(admin, p.seller_id);
      if (shopHold.kind === "error") {
        defects.record(`shop payout ${p.payout_id}: hold read failed: ${shopHold.message}`);
        await skipRow("shop", p.payout_id, p.seller_id, p.amount_cents, 15, "transient", "payout hold read failed");
        continue;
      }
      if (shopHold.kind === "held") {
        out.held++;
        await skipRow("shop", p.payout_id, p.seller_id, p.amount_cents, 60, "held", "the payee is on an admin payout hold");
        continue;
      }
      const group = `shop_order_${p.order_id}`;
      // No payout account and no try used yet: no transfer can exist, so no Stripe call at all.
      if (!p.stripe_account_id && !maybeSent_shop(p)) {
        await unpayableNow("shop", p.payout_id, p.seller_id, null, p.amount_cents, null);
        continue;
      }
      let beforeSend = true;
      try {
        const mode = shopOrderMode({ livemode: p.livemode, checkout_session_id: p.checkout_session_id });
        if (mode) {
          // The order's recorded mode must agree with its parties (a test order is never paid on the live key).
          // Only the payee must be a properly enrolled account: a buyer's never blocks a real seller's payout.
          const byParties = await modes.modeForParties([p.buyer_id, p.seller_id], "payout", [p.seller_id]);
          if (byParties !== mode) throw new Error(`shop order says ${mode} but its parties are ${byParties}`);
        }
        const resolved = mode ? { mode, stripe: modes.clientFor(mode) } : await modes.clientForParties([p.buyer_id, p.seller_id], "payout", [p.seller_id]);
        const stripe = resolved.stripe;
        // Already found not payable this run, and no try used (no transfer can exist): defer now.
        if (!maybeSent_shop(p) && (await unpayableNow("shop", p.payout_id, p.seller_id, p.stripe_account_id, p.amount_cents, resolved.mode))) continue;
        const listed = await stripe.transfers.list({ transfer_group: group, limit: 100 });
        const existing = listed.data.find((t) => {
          const meta = (t.metadata ?? {}) as Record<string, string>;
          return meta.kind === "shop_payout" && meta.payout_id === p.payout_id && !t.reversed;
        });
        let shopTransfer = existing;
        if (!shopTransfer) {
          if (await unpayableNow("shop", p.payout_id, p.seller_id, p.stripe_account_id, p.amount_cents, resolved.mode)) continue;
          // From the order's OWN charge, only while it is whole (paid, nothing refunded, not disputed).
          const charge = await wholeCharge(stripe, p.payment_intent_id, 0);
          // Readiness only after the reconcile and the charge check.
          if (!(await payeeReadyNow(stripe, resolved.mode, "shop", p.payout_id, p.seller_id, p.stripe_account_id as string, p.amount_cents))) continue;
          if (!(await stillPayableNow("shop", p.payout_id, p.seller_id, p.amount_cents))) continue;
          if (!(await markSending("shop", p.payout_id, p.seller_id, p.amount_cents))) continue;
          beforeSend = false;
          shopTransfer = await stripe.transfers.create(
            {
              amount: p.amount_cents,
              currency: "usd",
              destination: p.stripe_account_id as string,
              transfer_group: group,
              source_transaction: charge,
              metadata: { kind: "shop_payout", payout_id: p.payout_id, order_id: p.order_id },
            },
            { idempotencyKey: `shop-payout-${p.payout_id}` },
          );
        }
        const { error } = await admin.rpc("shop_payout_executed", {
          p_payout_id: p.payout_id, p_transfer_id: shopTransfer.id, p_succeeded: true, p_error: null,
        });
        if (error) {
          // The transfer exists; recording it failed. Not at the front of the queue, bounded, and
          // reconciled (never re-sent) next time.
          await onceADay(`payout-unrecorded-shop-${p.payout_id}`, "A sent payout could not be recorded",
            `shop payout ${p.payout_id}: transfer ${shopTransfer.id} not recorded: ${error.message}`.slice(0, 300));
          await skipRow("shop", p.payout_id, p.seller_id, p.amount_cents, 15, "record_failed", `transfer ${shopTransfer.id} not recorded`);
          continue;
        }
        if (existing) out.shop_payouts_reconciled++;
        else out.shop_payouts_sent++;
        await clearWait("shop", p.payout_id);
      } catch (e) {
        if (isPartyRefusal(e)) {
          out.mixed_parties++;
          defects.record(`shop payout ${p.payout_id}: ${partyWhy(e, "the order")}; settle it by hand`);
          // Settled by hand: out of the queue for a day, not at its front, and no payee wait.
          await skipRow("shop", p.payout_id, p.seller_id, p.amount_cents, 1440, "mixed_parties", partyWhy(e, "the order"));
          continue;
        }
        if (beforeSend && transientBeforeSend(e)) {
          // Nothing was sent: later, without using a try.
          out.payout_retry_later++;
          console.log(JSON.stringify({ event: "payout_deferred_transient", kind: "shop", payout: p.payout_id, detail: caughtMessage(e, "failed") }));
          await onceADay(`payout-transient-shop-${p.stripe_account_id ?? p.payout_id}`, "Payout steps keep failing",
            `shop payout ${p.payout_id}: ${caughtMessage(e, "failed")}`.slice(0, 300));
          await skipRow("shop", p.payout_id, p.seller_id, p.amount_cents, 15, "transient", caughtMessage(e, "failed"));
          continue;
        }
        const msg = caughtMessage(e, "transfer failed");
        defects.record(`shop payout ${p.payout_id}: ${msg}`.slice(0, 200));
        const { error } = await admin.rpc("shop_payout_executed", {
          p_payout_id: p.payout_id, p_transfer_id: null, p_succeeded: false, p_error: msg.slice(0, 500),
        });
        if (error) defects.record(`shop payout ${p.payout_id}: failure not recorded: ${error.message}`);
        out.shop_payouts_failed++;
        if (p.attempts + 1 >= 12) {
          await clearWait("shop", p.payout_id);
          await postSlackOpsAlert({
            kind: "payout_failed", severity: "critical",
            title: "Shops payout gave up",
            message: /charge is not whole/.test(msg)
              ? `Shop payout ${p.payout_id} (${dollars(p.amount_cents)}, order ${p.order_id}) gave up: the order's charge was refunded or disputed. Do NOT pay the shop by hand; decide the order first. Last reason: ${msg.slice(0, 200)}.`
              : `Shop payout ${p.payout_id} (${dollars(p.amount_cents)}, order ${p.order_id}) failed 12 times. Last reason: ${msg.slice(0, 200)}. Pay it by hand.`,
            fields: { Group: group },
          });
        }
      }
    }
  } catch (e) {
    defects.record(`shop payouts step: ${caughtMessage(e, "failed")}`.slice(0, 200));
  }

  const [refundsRes, payoutsRes, helprRes, deliveryRes] = await Promise.all([
    admin.rpc("declutter_refunds_due", { p_limit: BATCH }),
    admin.rpc("declutter_payouts_due", { p_limit: BATCH }),
    admin.rpc("helpr_task_payouts_due", { p_limit: BATCH }),
    admin.rpc("declutter_delivery_refunds_due", { p_limit: BATCH }),
  ]);
  if (refundsRes.error) return cronError(FN, `declutter_refunds_due failed: ${refundsRes.error.message}`);
  if (payoutsRes.error) return cronError(FN, `declutter_payouts_due failed: ${payoutsRes.error.message}`);
  if (helprRes.error) return cronError(FN, `helpr_task_payouts_due failed: ${helprRes.error.message}`);
  if (deliveryRes.error) return cronError(FN, `declutter_delivery_refunds_due failed: ${deliveryRes.error.message}`);
  const refunds = (refundsRes.data ?? []) as RefundDue[];
  const payouts = (payoutsRes.data ?? []) as PayoutDue[];
  const helprPayouts = (helprRes.data ?? []) as HelprPayoutDue[];
  const deliveryRefunds = (deliveryRes.data ?? []) as DeliveryRefundDue[];
  // Q1929: raises of a delivery's pay to give back (20261021185418). A function not deployed yet
  // (PGRST202: this edge shipped before its migration) is one defect, never a stop for the rest.
  const raiseRes = await admin.rpc("declutter_delivery_raise_refunds_due", { p_limit: BATCH });
  if (raiseRes.error && (raiseRes.error as { code?: string }).code !== "PGRST202") {
    return cronError(FN, `declutter_delivery_raise_refunds_due failed: ${raiseRes.error.message}`);
  }
  if (raiseRes.error) defects.record("declutter_delivery_raise_refunds_due: not deployed yet (PGRST202)");
  const raiseRefunds = (raiseRes.error ? [] : raiseRes.data ?? []) as RaiseRefundDue[];
  // Refunds that gave up (12 tries; the queue no longer offers them): the SQL raises one ops-ledger
  // alert per row per day and tells the buyer once that the refund is being sent by hand
  // (lh-money-escrow should-fix (a)). A failed check is a defect, never a reason to hold money.
  const gaveUp = await admin.rpc("declutter_refund_gave_up_check", {});
  if (gaveUp.error) defects.record(`declutter_refund_gave_up_check failed: ${gaveUp.error.message}`);
  else out.refunds_gave_up = Number(gaveUp.data ?? 0);
  // Held delivery tips nothing will send (owner #3706; lh-money-escrow review must-fix 1): the delivery
  //     payout went without them, gave up, or was settled by hand. Staff pay exactly the tip by hand.
  {
    const stranded = await admin.rpc("helpr_task_tips_stranded", {});
    if (stranded.error && (stranded.error as { code?: string }).code !== "PGRST202") {
      defects.record(`helpr_task_tips_stranded failed: ${stranded.error.message}`.slice(0, 200));
    }
    for (const x of ((stranded.data ?? []) as Array<{ tip_id: string; task_id: string; helpr_id: string | null; tip_cents: number; payment_intent_id: string | null; payout_status: string | null }>)) {
      out.held_tips_stranded++;
      await postSlackOpsAlert({
        kind: "money_at_risk", severity: "critical", oncePerDayKey: `delivery-tip-stranded-${x.tip_id}`,
        title: "A held delivery tip will not be sent automatically",
        message: `Held tip ${x.tip_id} (${dollars(x.tip_cents)}, task ${x.task_id}) is on the platform and its delivery payout is ${x.payout_status ?? "missing"}, so declutter-money will not send it. Pay the Helpr exactly the tip by hand from its own charge and record the transfer on the tip.`,
        fields: { "Payment intent": x.payment_intent_id ?? "?", Helpr: x.helpr_id ?? "deleted" },
      });
    }
  }
  // Manager mode phase 2b: the manager's share rows (20261101233256), paid in step 2b below.
  const managerRes = await admin.rpc("declutter_manager_payouts_due", { p_limit: BATCH });
  let managerPayouts: ManagerPayoutDue[] = [];
  if (managerRes.error) {
    // Not deployed yet (this edge shipped before its migration): one defect, never a stop for the rest.
    if ((managerRes.error as { code?: string }).code !== "PGRST202") defects.record(`declutter_manager_payouts_due failed: ${managerRes.error.message}`.slice(0, 200));
  } else {
    managerPayouts = (managerRes.data ?? []) as ManagerPayoutDue[];
  }
  if (refunds.length === 0 && payouts.length === 0 && helprPayouts.length === 0 && deliveryRefunds.length === 0 && raiseRefunds.length === 0
      && managerPayouts.length === 0) {
    return cronResult(FN, out, defects.defects);
  }

  // Q1415(c): no refund or payout moves for an account under ban review. Fail closed.
  const people = [...new Set([
    ...[...refunds, ...payouts, ...deliveryRefunds, ...raiseRefunds].flatMap((r) => [r.buyer_id, r.seller_id]),
    ...helprPayouts.flatMap((h) => [h.helpr_id, h.customer_id, h.pickup_contact_id]),
    ...managerPayouts.flatMap((m) => [m.buyer_id, m.seller_id, m.manager_id]),
  ].filter((x): x is string => !!x))];
  const review = await loadBanReviewUsers(admin, people);
  if (!review.ok) return cronError(FN, `ban review read failed: ${review.message}`);

  // 1. Refunds.
  for (const r of refunds) {
    groupOf.set(r.refund_id, r.payment_intent_id);
    if (Number(r.attempts ?? 0) > 0) maybeSentRows.add(r.refund_id);
    if ((r.buyer_id && review.users.has(r.buyer_id)) || (r.seller_id && review.users.has(r.seller_id))) {
      out.ban_review++;
      // Deferred like a skipped payout (never the front of its queue) and bounded.
      await skipRow("declutter_refund", r.refund_id, r.buyer_id, r.refund_cents, 60, "ban_review", "a party is under ban review");
      continue;
    }
    try {
      const client = await refundClient(r);
      if (!client) {
        defects.record(`refund ${r.refund_id}: no order and no recorded Stripe mode; refund it by hand`);
        // Cannot be refunded automatically: held for review once the page goes out.
        await skipRow("declutter_refund", r.refund_id, r.buyer_id, r.refund_cents, 1440, "data_defect", "no order and no recorded Stripe mode");
        continue;
      }
      const { stripe } = client;
      // Reconcile first: a refund Stripe already took for this row is recorded, not sent again
      // (Stripe's idempotency key lives 24 h; the back-off reaches a day). A refund Stripe failed or
      // cancelled is not adopted: the next try is a NEW refund under a new key.
      const listed = await stripe.refunds.list({ payment_intent: r.payment_intent_id, limit: 100 });
      const mine = listed.data.filter((x) => (x.metadata as Record<string, string> | null)?.refund_id === r.refund_id);
      const existing = mine.find((x) => tookIt(x.status));
      const retries = mine.length;
      const refund = existing ?? await stripe.refunds.create(
        {
          payment_intent: r.payment_intent_id,
          amount: r.refund_cents,
          // Same parameters as the webhook (stripe-webhook/handlers/declutterCheckout.ts) under the same key,
          // both built from the refund ROW (an order_missing row: order_id ""). Pinned by declutter-payments.test.ts.
          metadata: { kind: "declutter_refund", refund_id: r.refund_id, reason: r.reason, order_id: r.order_id ?? "" },
        },
        { idempotencyKey: retries === 0 ? `declutter-refund-${r.refund_id}` : `declutter-refund-${r.refund_id}-r${retries}` },
      );
      const ok = tookIt(refund.status);
      const { error } = await admin.rpc("declutter_refund_executed", {
        p_refund_id: r.refund_id,
        p_stripe_refund_id: refund.id,
        p_succeeded: ok,
      });
      if (error) {
        defects.record(`refund ${r.refund_id}: Stripe ${refund.id} not recorded: ${error.message}`);
        await skipRow("declutter_refund", r.refund_id, r.buyer_id, r.refund_cents, 15, "record_failed", `refund ${refund.id} not recorded`);
        continue;
      }
      if (!ok) {
        out.refunds_failed++;
        await postSlackOpsAlert({
          kind: "money_at_risk", severity: "critical",
          title: r.attempts + 1 >= 12 ? "Declutter refund gave up" : "Declutter refund did not go through",
          message: `Stripe answered ${refund.status} for refund row ${r.refund_id} (${dollars(r.refund_cents)}, order ${r.order_id ?? "none"}). ${r.attempts + 1 >= 12 ? "That was the last try: refund it by hand." : "It will be retried with back-off."}`,
          fields: { Refund: refund.id },
        });
        continue;
      }
      if (existing) out.refunds_reconciled++;
      else out.refunds_sent++;
      // The queue only offers rows not yet succeeded, so this run is the one that recorded the refund:
      // tell the buyer now, whether this run created it or adopted one the webhook did not record.
      await tellBuyerRefunded(admin, r.buyer_id, r.refund_cents);
    } catch (e) {
      if (isPartyRefusal(e)) {
        out.mixed_parties++;
        defects.record(`refund ${r.refund_id}: ${partyWhy(e, "the order")}; settle it by hand`);
        await skipRow("declutter_refund", r.refund_id, r.buyer_id, r.refund_cents, 1440, "mixed_parties", partyWhy(e, "the order"));
        continue;
      }
      const msg = caughtMessage(e, "refund failed");
      const { error } = await admin.rpc("declutter_refund_executed", { p_refund_id: r.refund_id, p_stripe_refund_id: null, p_succeeded: false });
      if (error) defects.record(`refund ${r.refund_id}: failure not recorded: ${error.message}`);
      out.refunds_failed++;
      defects.record(`refund ${r.refund_id}${r.attempts + 1 >= 12 ? " (LAST TRY: refund it by hand)" : ""}: ${msg}`.slice(0, 200));
    }
  }

  // 2. Payouts.
  const sellerMarked = await sendMarks("declutter", payouts.map((x) => x.payout_id));
  // A transfer may exist when a try was used or a send was started (marked before the call).
  const maybeSent_declutter = (x: PayoutDue) => Number(x.attempts ?? 0) > 0 || sellerMarked.has(x.payout_id);
  for (const p of payouts) {
    groupOf.set(p.payout_id, `declutter_order_${p.order_id}`);
    if (maybeSent_declutter(p)) maybeSentRows.add(p.payout_id);
    if ((p.seller_id && review.users.has(p.seller_id)) || (p.buyer_id && review.users.has(p.buyer_id))) {
      out.ban_review++;
      await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 60, "ban_review", "a party is under ban review");
      continue;
    }
    const hold = await checkPayoutHold(admin, p.seller_id);
    if (hold.kind === "error") {
      defects.record(`payout ${p.payout_id}: hold read failed: ${hold.message}`);
      await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 15, "transient", "payout hold read failed");
      continue;
    }
    if (hold.kind === "held") {
      out.held++;
      await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 60, "held", "the payee is on an admin payout hold");
      continue;
    }
    const group = `declutter_order_${p.order_id}`;
    // No payout account and no try used yet: no transfer can exist, so no Stripe call at all.
    if (!p.stripe_account_id && !maybeSent_declutter(p)) {
      await unpayableNow("declutter", p.payout_id, p.seller_id, null, p.amount_cents, null);
      continue;
    }
    let beforeSend = true;
    try {
      // Only the payee (the seller) must be a properly enrolled account.
      const { stripe, mode } = await modes.clientForParties([p.buyer_id, p.seller_id], "payout", [p.seller_id]);
      // Already found not payable this run, and no try used (no transfer can exist): defer now.
      if (!maybeSent_declutter(p) && (await unpayableNow("declutter", p.payout_id, p.seller_id, p.stripe_account_id, p.amount_cents, mode))) continue;
      // Reconcile: one payout per order, so any transfer in the group to this account is the one.
      const listed = await stripe.transfers.list({ transfer_group: group, limit: 100 });
      // Only a Declutter payout transfer that was not reversed (review 3.5).
      const existing = listed.data.find((t) => {
        const meta = (t.metadata ?? {}) as Record<string, string>;
        return meta.kind === "declutter_payout" && !t.reversed
          && (meta.payout_id === p.payout_id || (typeof t.destination === "string" ? t.destination : t.destination?.id) === p.stripe_account_id);
      });
      let transfer = existing;
      if (!transfer) {
        // Funded by the order's OWN charge (never the platform balance), and only while that charge is
        // whole: paid, no refund beyond what the order recorded, no dispute (lh-money-escrow review 3.4).
        // Otherwise nothing moves. Then, and only then, the payee's readiness.
        if (await unpayableNow("declutter", p.payout_id, p.seller_id, p.stripe_account_id, p.amount_cents, mode)) continue;
        const charge = await wholeCharge(stripe, p.payment_intent_id, p.refunds_recorded_cents);
        if (!(await payeeReadyNow(stripe, mode, "declutter", p.payout_id, p.seller_id, p.stripe_account_id as string, p.amount_cents))) continue;
        if (!(await stillPayableNow("declutter", p.payout_id, p.seller_id, p.amount_cents))) continue;
        // Owner 2026-10-30: the seller's one-time setup fee comes out here, once the sale is final and the send is
        // certain (0 while the identity_check switch is off). Never on a row a send may have started: its Stripe key
        // was sent with the old amount. Fails closed: an unreadable answer sends nothing this run, no try used.
        if (!maybeSent_declutter(p)) {
          const { data: toSend, error: feeErr } = await admin.rpc("declutter_payout_take_setup_fee", { p_payout_id: p.payout_id });
          if (feeErr) {
            if ((feeErr as { code?: string }).code !== "PGRST202") {
              defects.record(`payout ${p.payout_id}: setup fee read failed, not sent this run: ${feeErr.message}`.slice(0, 200));
              await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 15, "transient", `setup fee read failed: ${feeErr.message}`);
              continue;
            }
          } else if (typeof toSend === "number") {
            p.amount_cents = toSend;
          }
        }
        if (!(await markSending("declutter", p.payout_id, p.seller_id, p.amount_cents))) continue;
        beforeSend = false;
        transfer = await stripe.transfers.create(
          {
            amount: p.amount_cents,
            currency: "usd",
            destination: p.stripe_account_id as string,
            transfer_group: group,
            source_transaction: charge,
            metadata: { kind: "declutter_payout", payout_id: p.payout_id, order_id: p.order_id },
          },
          { idempotencyKey: `declutter-payout-${p.payout_id}` },
        );
      }
      const { error } = await admin.rpc("declutter_payout_executed", {
        p_payout_id: p.payout_id, p_transfer_id: transfer.id, p_succeeded: true, p_error: null,
      });
      if (error) {
        // The transfer exists; recording it failed. Not at the front of the queue, bounded, and
        // reconciled (never re-sent) next time.
        await onceADay(`payout-unrecorded-declutter-${p.payout_id}`, "A sent payout could not be recorded",
          `payout ${p.payout_id}: transfer ${transfer.id} not recorded: ${error.message}`.slice(0, 300));
        await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 15, "record_failed", `transfer ${transfer.id} not recorded`);
        continue;
      }
      if (existing) out.payouts_reconciled++;
      else out.payouts_sent++;
      await clearWait("declutter", p.payout_id);
      // Deep audit #57: "Your payout is on its way", once the transfer is RECORDED (a reconciled row was never
      // recorded, so never emailed; a recorded row is not offered again).
      await emailSeller(admin, p.seller_id, p.order_id, "payout_sent", p.amount_cents,
        (step, detail) => console.log(JSON.stringify({ event: "declutter_seller_email", step, ...detail })));
    } catch (e) {
      if (isPartyRefusal(e)) {
        out.mixed_parties++;
        defects.record(`payout ${p.payout_id}: ${partyWhy(e, "the order")}; settle it by hand`);
        // Settled by hand: out of the queue for a day, not at its front, and no payee wait.
        await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 1440, "mixed_parties", partyWhy(e, "the order"));
        continue;
      }
      if (beforeSend && transientBeforeSend(e)) {
        // Nothing was sent: later, without using a try.
        out.payout_retry_later++;
        console.log(JSON.stringify({ event: "payout_deferred_transient", kind: "declutter", payout: p.payout_id, detail: caughtMessage(e, "failed") }));
        await onceADay(`payout-transient-declutter-${p.stripe_account_id ?? p.payout_id}`, "Payout steps keep failing",
          `declutter payout ${p.payout_id}: ${caughtMessage(e, "failed")}`.slice(0, 300));
        await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 15, "transient", caughtMessage(e, "failed"));
        continue;
      }
      const msg = caughtMessage(e, "transfer failed");
      defects.record(`payout ${p.payout_id}: ${msg}`.slice(0, 200));
      const { error } = await admin.rpc("declutter_payout_executed", {
        p_payout_id: p.payout_id, p_transfer_id: null, p_succeeded: false, p_error: msg.slice(0, 500),
      });
      if (error) defects.record(`payout ${p.payout_id}: failure not recorded: ${error.message}`);
      out.payouts_failed++;
      // A failed transfer backs off in SQL and is retried; after the last try it pages.
      await pageIfLastTry(p, msg);
      if (p.attempts + 1 >= 12) await clearWait("declutter", p.payout_id);
    }
  }

  // 2b. Manager mode (phase 2b): the manager's share of a sale, a SEPARATE transfer from the platform to the MANAGER's
  // own Connect account, from the same charge and transfer group as the seller's. The seller's reconcile above matches
  // kind 'declutter_payout' only, so this transfer is never adopted as the seller's; this one reconciles by
  // metadata.payout_id ONLY (the seller's transfer is in the same group). The SQL queue already refuses a banned,
  // suspended or held manager (lead condition a); the same per-run checks run here too.
  const managerMarked = await sendMarks("declutter_manager", managerPayouts.map((x) => x.payout_id));
  const maybeSent_manager = (x: ManagerPayoutDue) => Number(x.attempts ?? 0) > 0 || managerMarked.has(x.payout_id);
  for (const p of managerPayouts) {
    groupOf.set(p.payout_id, `declutter_order_${p.order_id}`);
    if (maybeSent_manager(p)) maybeSentRows.add(p.payout_id);
    if ([p.manager_id, p.seller_id, p.buyer_id].some((u) => u && review.users.has(u))) {
      out.ban_review++;
      await skipRow("declutter_manager", p.payout_id, p.manager_id, p.amount_cents, 60, "ban_review", "a party is under ban review");
      continue;
    }
    const hold = await checkPayoutHold(admin, p.manager_id);
    if (hold.kind === "error") {
      defects.record(`manager payout ${p.payout_id}: hold read failed: ${hold.message}`);
      await skipRow("declutter_manager", p.payout_id, p.manager_id, p.amount_cents, 15, "transient", "payout hold read failed");
      continue;
    }
    if (hold.kind === "held") {
      out.held++;
      await skipRow("declutter_manager", p.payout_id, p.manager_id, p.amount_cents, 60, "held", "the manager is on an admin payout hold");
      continue;
    }
    const managerGroup = `declutter_order_${p.order_id}`;
    if (!p.stripe_account_id && !maybeSent_manager(p)) {
      await unpayableNow("declutter_manager", p.payout_id, p.manager_id, null, p.amount_cents, null);
      continue;
    }
    let beforeSend = true;
    try {
      // Only the payee (the manager) must be a properly enrolled account.
      const { stripe, mode } = await modes.clientForParties([p.buyer_id, p.seller_id, p.manager_id], "payout", [p.manager_id]);
      if (!maybeSent_manager(p) && (await unpayableNow("declutter_manager", p.payout_id, p.manager_id, p.stripe_account_id, p.amount_cents, mode))) continue;
      const listed = await stripe.transfers.list({ transfer_group: managerGroup, limit: 100 });
      // By payout_id ONLY: the seller's transfer shares this group (and could share nothing else with it).
      const existing = listed.data.find((t) => {
        const meta = (t.metadata ?? {}) as Record<string, string>;
        return meta.kind === "declutter_manager_payout" && meta.payout_id === p.payout_id && !t.reversed;
      });
      let managerTransfer = existing;
      if (!managerTransfer) {
        if (await unpayableNow("declutter_manager", p.payout_id, p.manager_id, p.stripe_account_id, p.amount_cents, mode)) continue;
        const charge = await wholeCharge(stripe, p.payment_intent_id, p.refunds_recorded_cents);
        if (!(await payeeReadyNow(stripe, mode, "declutter_manager", p.payout_id, p.manager_id, p.stripe_account_id as string, p.amount_cents))) continue;
        if (!(await stillPayableNow("declutter_manager", p.payout_id, p.manager_id, p.amount_cents))) continue;
        if (!(await markSending("declutter_manager", p.payout_id, p.manager_id, p.amount_cents))) continue;
        beforeSend = false;
        managerTransfer = await stripe.transfers.create(
          {
            amount: p.amount_cents,
            currency: "usd",
            destination: p.stripe_account_id as string,
            transfer_group: managerGroup,
            source_transaction: charge,
            metadata: { kind: "declutter_manager_payout", payout_id: p.payout_id, order_id: p.order_id },
          },
          { idempotencyKey: `declutter-manager-payout-${p.payout_id}` },
        );
      }
      const { error } = await admin.rpc("declutter_manager_payout_executed", {
        p_payout_id: p.payout_id, p_transfer_id: managerTransfer.id, p_succeeded: true, p_error: null,
      });
      if (error) {
        await onceADay(`payout-unrecorded-declutter_manager-${p.payout_id}`, "A sent payout could not be recorded",
          `manager payout ${p.payout_id}: transfer ${managerTransfer.id} not recorded: ${error.message}`.slice(0, 300));
        await skipRow("declutter_manager", p.payout_id, p.manager_id, p.amount_cents, 15, "record_failed", `transfer ${managerTransfer.id} not recorded`);
        continue;
      }
      if (existing) out.manager_payouts_reconciled++;
      else out.manager_payouts_sent++;
      await clearWait("declutter_manager", p.payout_id);
    } catch (e) {
      if (isPartyRefusal(e)) {
        out.mixed_parties++;
        defects.record(`manager payout ${p.payout_id}: ${partyWhy(e, "the order")}; settle it by hand`);
        await skipRow("declutter_manager", p.payout_id, p.manager_id, p.amount_cents, 1440, "mixed_parties", partyWhy(e, "the order"));
        continue;
      }
      if (beforeSend && transientBeforeSend(e)) {
        out.payout_retry_later++;
        console.log(JSON.stringify({ event: "payout_deferred_transient", kind: "declutter_manager", payout: p.payout_id, detail: caughtMessage(e, "failed") }));
        await skipRow("declutter_manager", p.payout_id, p.manager_id, p.amount_cents, 15, "transient", caughtMessage(e, "failed"));
        continue;
      }
      const msg = caughtMessage(e, "transfer failed");
      defects.record(`manager payout ${p.payout_id}: ${msg}`.slice(0, 200));
      const { error } = await admin.rpc("declutter_manager_payout_executed", {
        p_payout_id: p.payout_id, p_transfer_id: null, p_succeeded: false, p_error: msg.slice(0, 500),
      });
      if (error) defects.record(`manager payout ${p.payout_id}: failure not recorded: ${error.message}`);
      out.manager_payouts_failed++;
      if (p.attempts >= 11) {
        await postSlackOpsAlert({
          kind: "payout_failed", severity: "critical",
          title: "Declutter manager payout gave up",
          message: /charge is not whole/.test(msg)
            ? `Manager payout ${p.payout_id} (${dollars(p.amount_cents)}, order ${p.order_id}) gave up: the order's charge was refunded or disputed. Do NOT pay it by hand; decide the order first.`
            : `Manager payout ${p.payout_id} (${dollars(p.amount_cents)}, order ${p.order_id}) failed 12 times. Last reason: ${msg.slice(0, 200)}. Pay it by hand.`,
          fields: { Group: managerGroup },
        });
        await clearWait("declutter_manager", p.payout_id);
      }
    }
  }

  // 3. Helpr payouts (slice 5): the Helpr's pay for a confirmed delivery, from the order's own charge.
  const helprMarked = await sendMarks("helpr_task", helprPayouts.map((x) => x.payout_id));
  const maybeSent_helpr_task = (x: HelprPayoutDue) => Number(x.attempts ?? 0) > 0 || helprMarked.has(x.payout_id);
  for (const h of helprPayouts) {
    groupOf.set(h.payout_id, h.transfer_group ?? null);
    if (maybeSent_helpr_task(h)) maybeSentRows.add(h.payout_id);
    if ([h.helpr_id, h.customer_id, h.pickup_contact_id].some((u) => !!u && review.users.has(u))) {
      out.ban_review++;
      await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 60, "ban_review", "a party is under ban review");
      continue;
    }
    const hold = await checkPayoutHold(admin, h.helpr_id);
    if (hold.kind === "error") {
      defects.record(`helpr payout ${h.payout_id}: hold read failed: ${hold.message}`);
      await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 15, "transient", "payout hold read failed");
      continue;
    }
    const onHold = hold.kind === "held";
    if (onHold) {
      out.held++;
      await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 60, "held", "the payee is on an admin payout hold");
      continue;
    }
    if (h.source_kind !== "declutter_delivery" || !h.transfer_group || !h.payment_intent_id) {
      // A source this money step cannot pay from (not a Declutter delivery, or no charge / group):
      // a data defect, held for review at once; it never "pays itself".
      defects.record(`helpr payout ${h.payout_id}: source ${h.source_kind} names no payable charge or transfer group`);
      await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 1440, "data_defect", `source ${h.source_kind} has no payable charge / transfer group`);
      continue;
    }
    // No payout account and no try used yet: no transfer can exist, so no Stripe call at all.
    if (!h.stripe_account_id && !maybeSent_helpr_task(h)) {
      await unpayableNow("helpr_task", h.payout_id, h.helpr_id, null, h.amount_cents, null);
      continue;
    }
    // Q1929: a raised delivery's payout is funded part from the order's charge and part from each
    // raise's own charge (a transfer may not exceed its source charge). No raise = one part, as before.
    let parts: PayoutPart[];
    try {
      // Owner #3706: each held delivery tip is one more part, exactly the tip, from the tip's own charge.
      parts = [...helprPayoutParts(h.amount_cents, h.payment_intent_id, h.raised_cents, h.raise_parts), ...heldTipParts(h.tip_parts)];
    } catch (e) {
      defects.record(`helpr payout ${h.payout_id}: ${caughtMessage(e, "raise parts unreadable")}`.slice(0, 200));
      await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 1440, "data_defect", caughtMessage(e, "raise parts unreadable"));
      continue;
    }
    let beforeSend = true;
    try {
      // Only the payee (the Helpr) must be a properly enrolled account.
      const { stripe, mode } = await modes.clientForParties([h.customer_id, h.pickup_contact_id, h.helpr_id], "payout", [h.helpr_id]);
      // Already found not payable this run, and no try used (no transfer can exist): defer now.
      if (!maybeSent_helpr_task(h) && (await unpayableNow("helpr_task", h.payout_id, h.helpr_id, h.stripe_account_id, h.amount_cents, mode))) continue;
      // Reconcile: each part's one transfer for this row (the order part carries no raise_id), never sent twice.
      const listed = await stripe.transfers.list({ transfer_group: h.transfer_group, limit: 100 });
      const sent = parts.map((part) => listed.data.find((t) => {
        const meta = (t.metadata ?? {}) as Record<string, string>;
        return meta.kind === "helpr_task_payout" && meta.payout_id === h.payout_id && !t.reversed
          && (meta.raise_id ?? "") === (part.raiseId ?? "") && (meta.tip_id ?? "") === (part.tipId ?? "");
      }));
      const existing = sent.every((t) => !!t);
      if (!existing && sent.some((t) => !!t)) {
        // Part of a raised payout went and part did not (a failure between two transfers). Never re-run the
        // payee gates on it (a hold, then "pay it by hand" for the WHOLE amount, would pay the sent part twice):
        // held for a person, naming what went and what is left (lh-money-escrow review of Q1929, #4).
        const went = sent.flatMap((t) => (t ? [t.id] : []));
        const left = parts.filter((_, i) => !sent[i]).reduce((sum, p) => sum + p.amountCents, 0);
        defects.record(`helpr payout ${h.payout_id}: partly sent (${went.join(", ")}); ${left}c not sent`.slice(0, 200));
        await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 1440, "needs_reconcile",
          `partly sent: transfers ${went.join(", ")} went; ${dollars(left)} from raise or tip charges did not. Send only the rest.`);
        continue;
      }
      if (!existing) {
        // The charges first (a refunded or disputed one fails loudly), then the payee's readiness.
        if (await unpayableNow("helpr_task", h.payout_id, h.helpr_id, h.stripe_account_id, h.amount_cents, mode)) continue;
        const charges: (string | null)[] = [];
        const dropTip = new Set<number>();
        for (const [i, part] of parts.entries()) {
          if (sent[i]) {
            charges[i] = null;
            continue;
          }
          try {
            charges[i] = await wholeCharge(stripe, part.paymentIntentId, part.raiseId || part.tipId ? 0 : h.refunds_recorded_cents);
          } catch (e) {
            // A held tip whose own charge was refunded or disputed never holds up the delivery pay (lh-money-escrow
            // review, should-fix 2): it is left out of this send (unsent, so it pages as stranded) and staff are told.
            if (!part.tipId || isTransientStripeError(e)) throw e;
            dropTip.add(i);
            await postSlackOpsAlert({
              kind: "money_at_risk", severity: "critical", oncePerDayKey: `delivery-tip-charge-not-whole-${part.tipId}`,
              title: "A held delivery tip's charge is not whole",
              message: `Held tip ${part.tipId} (${dollars(part.amountCents)}) for payout ${h.payout_id} was not sent with the delivery pay: ${caughtMessage(e, "its charge was refunded or disputed").slice(0, 200)}. Decide it by hand; the delivery pay goes on.`,
              fields: { "Payment intent": part.paymentIntentId, Payout: h.payout_id },
            });
          }
        }
        if (dropTip.size > 0) {
          parts = parts.filter((_, i) => !dropTip.has(i));
          const keep = (_: unknown, i: number) => !dropTip.has(i);
          sent.splice(0, sent.length, ...sent.filter(keep));
          charges.splice(0, charges.length, ...charges.filter(keep));
        }
        if (!(await payeeReadyNow(stripe, mode, "helpr_task", h.payout_id, h.helpr_id, h.stripe_account_id as string, h.amount_cents))) continue;
        if (!(await stillPayableNow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents))) continue;
        // Owner 2026-10-30: the delivery Helpr's one-time setup fee comes out here, once the send is certain (0 while the
        // identity_check switch is off), from the order's part only: a raise and a held tip go whole from their own charge.
        // Never on a row a send may have started: its Stripe key was sent with the old amount. Fails closed: an unreadable
        // answer sends nothing this run, no try used.
        if (!maybeSent_helpr_task(h)) {
          const { data: toSend, error: feeErr } = await admin.rpc("helpr_task_payout_take_setup_fee", { p_payout_id: h.payout_id });
          if (feeErr) {
            if ((feeErr as { code?: string }).code !== "PGRST202") {
              defects.record(`helpr payout ${h.payout_id}: setup fee read failed, not sent this run: ${feeErr.message}`.slice(0, 200));
              await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 15, "transient", `setup fee read failed: ${feeErr.message}`);
              continue;
            }
          } else if (typeof toSend === "number" && toSend !== h.amount_cents) {
            const taken = h.amount_cents - toSend;
            parts = parts.map((part) => (!part.raiseId && !part.tipId ? { ...part, amountCents: part.amountCents - taken } : part));
            h.amount_cents = toSend;
          }
        }
        if (!(await markSending("helpr_task", h.payout_id, h.helpr_id, h.amount_cents))) continue;
        beforeSend = false;
        for (const [i, part] of parts.entries()) {
          if (sent[i]) continue;
          sent[i] = await stripe.transfers.create(
            {
              amount: part.amountCents,
              currency: "usd",
              destination: h.stripe_account_id as string,
              transfer_group: h.transfer_group,
              source_transaction: charges[i] as string,
              metadata: {
                kind: "helpr_task_payout", payout_id: h.payout_id, task_id: h.task_id, source_id: h.source_id,
                ...(part.raiseId ? { raise_id: part.raiseId } : {}),
                ...(part.tipId ? { tip_id: part.tipId } : {}),
              },
            },
            {
              idempotencyKey: part.raiseId ? `helpr-task-payout-${h.payout_id}-raise-${part.raiseId}`
                : part.tipId ? `helpr-task-payout-${h.payout_id}-tip-${part.tipId}` : `helpr-task-payout-${h.payout_id}`,
            },
          );
        }
      }
      // Each raise part's transfer is recorded on its raise (the restore check and a person see every part);
      // the row records its first part's transfer (the order's, when it funds any).
      let partsRecorded = true;
      for (const [i, part] of parts.entries()) {
        if (part.tipId) {
          // Owner #3706: the held tip's own transfer is recorded on the tip (and the Helpr told).
          const { data: tipRec, error: tipErr } = await admin.rpc("helpr_task_tip_payout_sent", {
            p_tip_id: part.tipId, p_transfer_id: (sent[i] as Stripe.Transfer).id,
          });
          if (tipErr || (tipRec !== "recorded" && tipRec !== "already")) {
            partsRecorded = false;
            defects.record(`helpr payout ${h.payout_id}: tip transfer ${(sent[i] as Stripe.Transfer).id} not recorded: ${tipErr?.message ?? String(tipRec)}`.slice(0, 200));
          }
          continue;
        }
        if (!part.raiseId) continue;
        const { error: partErr } = await admin.rpc("declutter_delivery_raise_payout_sent", {
          p_raise_id: part.raiseId, p_transfer_id: (sent[i] as Stripe.Transfer).id,
        });
        if (partErr) {
          partsRecorded = false;
          defects.record(`helpr payout ${h.payout_id}: raise transfer ${(sent[i] as Stripe.Transfer).id} not recorded: ${partErr.message}`.slice(0, 200));
        }
      }
      if (!partsRecorded) {
        // Every transfer exists; recording one failed. Reconciled (never re-sent) next time.
        await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 15, "record_failed", "a raise or tip transfer not recorded");
        continue;
      }
      const hTransfer = sent[0] as Stripe.Transfer;
      const { error } = await admin.rpc("helpr_task_payout_executed", {
        p_payout_id: h.payout_id, p_transfer_id: hTransfer.id, p_succeeded: true, p_error: null,
      });
      if (error) {
        await onceADay(`payout-unrecorded-helpr_task-${h.payout_id}`, "A sent payout could not be recorded",
          `helpr payout ${h.payout_id}: transfer ${hTransfer.id} not recorded: ${error.message}`.slice(0, 300));
        await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 15, "record_failed", `transfer ${hTransfer.id} not recorded`);
        continue;
      }
      if (existing) out.helpr_payouts_reconciled++;
      else out.helpr_payouts_sent++;
      await clearWait("helpr_task", h.payout_id);
    } catch (e) {
      if (isPartyRefusal(e)) {
        out.mixed_parties++;
        defects.record(`helpr payout ${h.payout_id}: ${partyWhy(e, "the delivery")}; settle it by hand`);
        // Settled by hand: out of the queue for a day, not at its front, and no payee wait.
        await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 1440, "mixed_parties", partyWhy(e, "the delivery"));
        continue;
      }
      if (beforeSend && transientBeforeSend(e)) {
        // Nothing was sent: later, without using a try.
        out.payout_retry_later++;
        console.log(JSON.stringify({ event: "payout_deferred_transient", kind: "helpr_task", payout: h.payout_id, detail: caughtMessage(e, "failed") }));
        await onceADay(`payout-transient-helpr_task-${h.stripe_account_id ?? h.payout_id}`, "Payout steps keep failing",
          `helpr_task payout ${h.payout_id}: ${caughtMessage(e, "failed")}`.slice(0, 300));
        await skipRow("helpr_task", h.payout_id, h.helpr_id, h.amount_cents, 15, "transient", caughtMessage(e, "failed"));
        continue;
      }
      const msg = caughtMessage(e, "transfer failed");
      defects.record(`helpr payout ${h.payout_id}: ${msg}`.slice(0, 200));
      const { error } = await admin.rpc("helpr_task_payout_executed", {
        p_payout_id: h.payout_id, p_transfer_id: null, p_succeeded: false, p_error: msg.slice(0, 500),
      });
      if (error) defects.record(`helpr payout ${h.payout_id}: failure not recorded: ${error.message}`);
      out.helpr_payouts_failed++;
      if (h.attempts + 1 >= 12) {
        await clearWait("helpr_task", h.payout_id);
        await postSlackOpsAlert({
          kind: "payout_failed", severity: "critical",
          title: "Helpr delivery payout gave up",
          message: /charge is not whole/.test(msg)
            ? `Helpr payout ${h.payout_id} (${dollars(h.amount_cents)}, task ${h.task_id}) gave up: the order's charge was refunded or disputed beyond what was recorded. Do NOT pay the Helpr by hand; decide the order first. Last reason: ${msg.slice(0, 200)}.`
            : `Helpr payout ${h.payout_id} (${dollars(h.amount_cents)}, task ${h.task_id}) failed 12 times. Last reason: ${msg.slice(0, 200)}. Pay it by hand.`,
          fields: { Group: h.transfer_group },
        });
      }
    }
  }

  // 4. Delivery-fee refunds (row 40): the delivery fee alone, back to the buyer.
  for (const d of deliveryRefunds) {
    groupOf.set(d.delivery_refund_id, d.payment_intent_id);
    if (Number(d.attempts ?? 0) > 0) maybeSentRows.add(d.delivery_refund_id);
    if ((d.buyer_id && review.users.has(d.buyer_id)) || (d.seller_id && review.users.has(d.seller_id))) {
      out.ban_review++;
      await skipRow("delivery_refund", d.delivery_refund_id, d.buyer_id, d.refund_cents, 60, "ban_review", "a party is under ban review");
      continue;
    }
    try {
      const client = await refundClient({
        refund_id: d.delivery_refund_id, reason: d.reason, order_id: d.order_id, buyer_id: d.buyer_id, seller_id: d.seller_id,
        payment_intent_id: d.payment_intent_id, refund_cents: d.refund_cents, attempts: d.attempts, livemode: null,
        checkout_session_id: d.checkout_session_id,
      });
      if (!client) {
        defects.record(`delivery refund ${d.delivery_refund_id}: no Stripe mode; refund it by hand`);
        await skipRow("delivery_refund", d.delivery_refund_id, d.buyer_id, d.refund_cents, 1440, "data_defect", "no Stripe mode");
        continue;
      }
      const { stripe } = client;
      const listed = await stripe.refunds.list({ payment_intent: d.payment_intent_id, limit: 100 });
      const mine = listed.data.filter((x) => (x.metadata as Record<string, string> | null)?.delivery_refund_id === d.delivery_refund_id);
      const adopted = mine.find((x) => tookIt(x.status));
      // own-mistake full refund (owner, 2026-10-14): row 40, the delivery we sold did not happen, so the
      // delivery fee goes back whole (the order's other money is untouched).
      const dRefund = adopted ?? await stripe.refunds.create(
        {
          payment_intent: d.payment_intent_id,
          amount: d.refund_cents,
          metadata: { kind: "declutter_refund", delivery_refund_id: d.delivery_refund_id, reason: d.reason, order_id: d.order_id },
        },
        { idempotencyKey: mine.length === 0 ? `declutter-delivery-refund-${d.delivery_refund_id}` : `declutter-delivery-refund-${d.delivery_refund_id}-r${mine.length}` },
      );
      const ok = tookIt(dRefund.status);
      const { error } = await admin.rpc("declutter_delivery_refund_executed", {
        p_id: d.delivery_refund_id, p_stripe_refund_id: dRefund.id, p_succeeded: ok, p_error: ok ? null : `Stripe answered ${dRefund.status}`,
      });
      if (error) {
        defects.record(`delivery refund ${d.delivery_refund_id}: Stripe ${dRefund.id} not recorded: ${error.message}`);
        await skipRow("delivery_refund", d.delivery_refund_id, d.buyer_id, d.refund_cents, 15, "record_failed", `refund ${dRefund.id} not recorded`);
        continue;
      }
      if (!ok) {
        out.delivery_refunds_failed++;
        await postSlackOpsAlert({
          kind: "money_at_risk", severity: "critical",
          title: d.attempts + 1 >= 12 ? "Declutter delivery-fee refund gave up" : "Declutter delivery-fee refund did not go through",
          message: `Stripe answered ${dRefund.status} for delivery refund ${d.delivery_refund_id} (${dollars(d.refund_cents)}, order ${d.order_id}). ${d.attempts + 1 >= 12 ? "That was the last try: refund it by hand." : "It will be retried with back-off."}`,
          fields: { Refund: dRefund.id },
        });
        continue;
      }
      if (adopted) out.delivery_refunds_reconciled++;
      else out.delivery_refunds_sent++;
      await tellBuyerRefunded(admin, d.buyer_id, d.refund_cents);
    } catch (e) {
      if (isPartyRefusal(e)) {
        out.mixed_parties++;
        defects.record(`delivery refund ${d.delivery_refund_id}: ${partyWhy(e, "the order")}; settle it by hand`);
        await skipRow("delivery_refund", d.delivery_refund_id, d.buyer_id, d.refund_cents, 1440, "mixed_parties", partyWhy(e, "the order"));
        continue;
      }
      const msg = caughtMessage(e, "refund failed");
      const { error } = await admin.rpc("declutter_delivery_refund_executed", {
        p_id: d.delivery_refund_id, p_stripe_refund_id: null, p_succeeded: false, p_error: msg.slice(0, 500),
      });
      if (error) defects.record(`delivery refund ${d.delivery_refund_id}: failure not recorded: ${error.message}`);
      out.delivery_refunds_failed++;
      defects.record(`delivery refund ${d.delivery_refund_id}${d.attempts + 1 >= 12 ? " (LAST TRY: refund it by hand)" : ""}: ${msg}`.slice(0, 200));
    }
  }

  // 4b. Delivery-pay raises (Q1929): each paid raise the task did not use goes back in full, on the
  // raise's OWN charge (never the order's), once: reconciled by metadata.raise_id, key
  // `declutter-raise-refund-<raise id>`, recorded with declutter_delivery_raise_refund_executed.
  // Deferred without a try. A reason that will not fix itself (no Stripe mode, mixed parties, a refund Stripe
  // took that could not be recorded) also pages ops once a day per raise, so no deferral is silent
  // (lh-money-escrow review of Q1929, #5). A refund made by hand settles it (declutter_delivery_raise_hand_refund).
  const deferRaise = async (x: RaiseRefundDue, minutes: number, stuck?: string) => {
    await waitRpc("declutter_delivery_raise_refund_defer", { p_raise_id: x.raise_id, p_minutes: minutes });
    if (stuck) {
      await onceADay(`raise-refund-stuck-${x.raise_id}`, "A delivery-raise refund is waiting on a person",
        `Raise ${x.raise_id} (${dollars(x.refund_cents)} to the buyer of order ${x.order_id}, payment ${x.payment_intent_id}) was not refunded: ${stuck}. Refund it by hand in Stripe; the refund settles the raise.`);
    }
  };
  for (const x of raiseRefunds) {
    if ((x.buyer_id && review.users.has(x.buyer_id)) || (x.seller_id && review.users.has(x.seller_id))) {
      out.ban_review++;
      await deferRaise(x, 60);
      continue;
    }
    try {
      const client = await refundClient({
        refund_id: x.raise_id, reason: x.reason, order_id: x.order_id, buyer_id: x.buyer_id, seller_id: x.seller_id,
        payment_intent_id: x.payment_intent_id, refund_cents: x.refund_cents, attempts: x.attempts, livemode: x.livemode,
        checkout_session_id: x.checkout_session_id,
      });
      if (!client) {
        defects.record(`raise refund ${x.raise_id}: no Stripe mode; refund it by hand`);
        await deferRaise(x, 1440, "no Stripe mode to run it on");
        continue;
      }
      const { stripe } = client;
      const listed = await stripe.refunds.list({ payment_intent: x.payment_intent_id, limit: 100 });
      const mine = listed.data.filter((r) => (r.metadata as Record<string, string> | null)?.raise_id === x.raise_id);
      const adopted = mine.find((r) => tookIt(r.status));
      // own-mistake full refund (owner, 2026-10-14): the raise bought a Helpr the delivery never got, or our
      // system took a payment it could not use, so everything the buyer paid for it goes back (card fee
      // included). The one exception is decided in SQL, not here: a sale cancelled for the buyer's own
      // reason keeps the raise's card fee (reason delivery_cancelled_buyer; refund_cents = paid - card fee,
      // CHECK declutter_delivery_raises_refund_amount). This sends exactly the row's refund_cents, on the
      // raise's OWN charge; the order's charge is untouched.
      const xRefund = adopted ?? await stripe.refunds.create(
        {
          payment_intent: x.payment_intent_id,
          amount: x.refund_cents,
          metadata: { kind: "declutter_refund", raise_id: x.raise_id, reason: x.reason, order_id: x.order_id },
        },
        { idempotencyKey: mine.length === 0 ? `declutter-raise-refund-${x.raise_id}` : `declutter-raise-refund-${x.raise_id}-r${mine.length}` },
      );
      const ok = tookIt(xRefund.status);
      const { error } = await admin.rpc("declutter_delivery_raise_refund_executed", {
        p_raise_id: x.raise_id, p_stripe_refund_id: xRefund.id, p_succeeded: ok, p_error: ok ? null : `Stripe answered ${xRefund.status}`,
      });
      if (error) {
        defects.record(`raise refund ${x.raise_id}: Stripe ${xRefund.id} not recorded: ${error.message}`);
        await deferRaise(x, 15, `Stripe refund ${xRefund.id} could not be recorded`);
        continue;
      }
      if (!ok) {
        out.raise_refunds_failed++;
        await postSlackOpsAlert({
          kind: "money_at_risk", severity: "critical",
          title: x.attempts + 1 >= 12 ? "Declutter delivery-raise refund gave up" : "Declutter delivery-raise refund did not go through",
          message: `Stripe answered ${xRefund.status} for raise refund ${x.raise_id} (${dollars(x.refund_cents)}, order ${x.order_id}). ${x.attempts + 1 >= 12 ? "That was the last try: refund it by hand." : "It will be retried with back-off."}`,
          fields: { Refund: xRefund.id },
        });
        continue;
      }
      if (adopted) out.raise_refunds_reconciled++;
      else out.raise_refunds_sent++;
      await tellBuyerRefunded(admin, x.buyer_id, x.refund_cents);
    } catch (e) {
      if (isPartyRefusal(e)) {
        out.mixed_parties++;
        defects.record(`raise refund ${x.raise_id}: ${partyWhy(e, "the order")}; settle it by hand`);
        await deferRaise(x, 1440, partyWhy(e, "the order"));
        continue;
      }
      const msg = caughtMessage(e, "refund failed");
      const { error } = await admin.rpc("declutter_delivery_raise_refund_executed", {
        p_raise_id: x.raise_id, p_stripe_refund_id: null, p_succeeded: false, p_error: msg.slice(0, 500),
      });
      if (error) defects.record(`raise refund ${x.raise_id}: failure not recorded: ${error.message}`);
      out.raise_refunds_failed++;
      defects.record(`raise refund ${x.raise_id}${x.attempts + 1 >= 12 ? " (LAST TRY: refund it by hand)" : ""}: ${msg}`.slice(0, 200));
    }
  }

  return cronResult(FN, out, defects.defects);
});
