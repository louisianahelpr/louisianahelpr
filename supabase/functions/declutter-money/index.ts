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
import { checkPayoutHold } from "../_shared/payoutHold.ts";
import { loadBanReviewUsers } from "../_shared/banReview.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { queueEmail } from "../_shared/resend.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { createStripeModeResolver, sessionIdMode, StripeModeRefused } from "../_shared/stripeMode.ts";

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
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const tookIt = (status: string | null | undefined) => status !== "failed" && status !== "canceled";

/** Best-effort money email (row 44). Never throws: the money already moved. */
async function tellBuyerRefunded(admin: Db, buyerId: string | null, cents: number): Promise<void> {
  if (!buyerId) return;
  try {
    const { data: profile, error } = await admin.from("profiles").select("email").eq("user_id", buyerId).maybeSingle();
    const to = (profile as { email?: string | null } | null)?.email;
    if (error || !to) return;
    const link = `${getAppUrl()}/declutter?view=cart`;
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
        const byParties = await modes.modeForParties([r.buyer_id, r.seller_id]);
        if (byParties !== mode) throw new Error(`refund row says ${mode} but its parties are ${byParties}`);
      }
      return { stripe: modes.clientFor(mode) };
    }
    if (!hasParties) return null;
    return await modes.clientForParties([r.buyer_id, r.seller_id]);
  };
  const out = {
    refunds_sent: 0, refunds_reconciled: 0, refunds_failed: 0, refunds_gave_up: 0,
    payouts_sent: 0, payouts_reconciled: 0, payouts_failed: 0,
    held: 0, ban_review: 0, no_payout_account: 0, mixed_parties: 0,
  };

  const [refundsRes, payoutsRes] = await Promise.all([
    admin.rpc("declutter_refunds_due", { p_limit: BATCH }),
    admin.rpc("declutter_payouts_due", { p_limit: BATCH }),
  ]);
  if (refundsRes.error) return cronError(FN, `declutter_refunds_due failed: ${refundsRes.error.message}`);
  if (payoutsRes.error) return cronError(FN, `declutter_payouts_due failed: ${payoutsRes.error.message}`);
  const refunds = (refundsRes.data ?? []) as RefundDue[];
  const payouts = (payoutsRes.data ?? []) as PayoutDue[];
  // Refunds that gave up (12 tries; the queue no longer offers them): the SQL raises one ops-ledger
  // alert per row per day and tells the buyer once that the refund is being sent by hand
  // (lh-money-escrow should-fix (a)). A failed check is a defect, never a reason to hold money.
  const gaveUp = await admin.rpc("declutter_refund_gave_up_check", {});
  if (gaveUp.error) defects.record(`declutter_refund_gave_up_check failed: ${gaveUp.error.message}`);
  else out.refunds_gave_up = Number(gaveUp.data ?? 0);
  if (refunds.length === 0 && payouts.length === 0) return cronResult(FN, out, defects.defects);

  // Q1415(c): no refund or payout moves for an account under ban review. Fail closed.
  const people = [...new Set([...refunds, ...payouts].flatMap((r) => [r.buyer_id, r.seller_id]).filter((x): x is string => !!x))];
  const review = await loadBanReviewUsers(admin, people);
  if (!review.ok) return cronError(FN, `ban review read failed: ${review.message}`);

  // 1. Refunds.
  for (const r of refunds) {
    if ((r.buyer_id && review.users.has(r.buyer_id)) || (r.seller_id && review.users.has(r.seller_id))) {
      out.ban_review++;
      continue;
    }
    try {
      const client = await refundClient(r);
      if (!client) {
        defects.record(`refund ${r.refund_id}: no order and no recorded Stripe mode; refund it by hand`);
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
      if (e instanceof StripeModeRefused && e.reason === "mixed_parties") {
        out.mixed_parties++;
        defects.record(`refund ${r.refund_id}: the order mixes a test account and a real one; settle it by hand`);
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
  for (const p of payouts) {
    if ((p.seller_id && review.users.has(p.seller_id)) || (p.buyer_id && review.users.has(p.buyer_id))) {
      out.ban_review++;
      continue;
    }
    const hold = await checkPayoutHold(admin, p.seller_id);
    if (hold.kind === "error") {
      defects.record(`payout ${p.payout_id}: hold read failed: ${hold.message}`);
      continue;
    }
    if (hold.kind === "held") {
      out.held++;
      continue;
    }
    if (!p.stripe_account_id) {
      // Not a failed try (lh-money-escrow review 2.1): the row stays due, and is paid the run after the
      // seller sets up payouts, however late. The handover notice told them to.
      out.no_payout_account++;
      continue;
    }
    const group = `declutter_order_${p.order_id}`;
    try {
      const { stripe } = await modes.clientForParties([p.buyer_id, p.seller_id]);
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
        // whole: paid, nothing refunded, no dispute (lh-money-escrow review 3.4). Otherwise nothing moves.
        if (!p.payment_intent_id) throw new Error("the order has no payment to pay the seller from");
        const pi = await stripe.paymentIntents.retrieve(p.payment_intent_id, { expand: ["latest_charge"] });
        const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
        if (pi.status !== "succeeded" || !ch || ch.amount_refunded > 0 || ch.disputed) {
          throw new Error(`the order's charge is not whole (status ${pi.status}, refunded ${ch?.amount_refunded ?? "?"}, disputed ${ch?.disputed ?? "?"})`);
        }
        const charge = ch.id;
        transfer = await stripe.transfers.create(
          {
            amount: p.amount_cents,
            currency: "usd",
            destination: p.stripe_account_id,
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
        defects.record(`payout ${p.payout_id}: transfer ${transfer.id} not recorded: ${error.message}`);
        continue;
      }
      if (existing) out.payouts_reconciled++;
      else out.payouts_sent++;
    } catch (e) {
      if (e instanceof StripeModeRefused && e.reason === "mixed_parties") {
        out.mixed_parties++;
        defects.record(`payout ${p.payout_id}: the order mixes a test account and a real one; settle it by hand`);
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
    }
  }

  return cronResult(FN, out, defects.defects);
});
