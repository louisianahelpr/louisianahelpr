// seed-policy: pages for seed/test Declutter orders too, on purpose: every alert
// here is money that moved (or a refund that did not) while the database says
// otherwise, whoever owns the order.
//
// DECLUTTER (docs/specs/declutter-auctions.md, slice 3b, B39-B41): the two
// Checkout Sessions Declutter creates, told apart by metadata.kind.
//
//   declutter_card  (declutter-card, mode=setup)    the buyer saved a card
//                   (row 36). The card is read off the SetupIntent and stored
//                   with declutter_save_card. Nothing is charged. The card
//                   then becomes the wallet's default card (one wallet card
//                   everywhere: the most recently saved card, any section;
//                   _walletDefaultCard.ts, Q2139).
//   declutter_order (declutter-checkout, mode=payment) the buyer paid an
//                   order. declutter_mark_order_paid decides, from the order's
//                   own state and the payment's OWN Stripe time (event.created,
//                   B41), whether the payment stands ('paid') or goes back
//                   ('refund', with a reason that fixes who bears the card fee,
//                   B40). A refund answer is executed here with Stripe, keyed
//                   on the refund row (a retry never refunds twice), and
//                   reported back with declutter_refund_executed.
//   declutter_raise (declutter-checkout raise_pay, mode=payment) the buyer
//                   paid a raise of a delivery's Helpr pay (Q1929, row 40):
//                   settleRaise below; only a PAID page changes anything.
//   declutter_delivery_tip (declutter-checkout delivery_tip, mode=payment) the
//                   buyer tipped the delivery Helpr (Q2453): settleDeliveryTip
//                   below records it; Stripe already paid the Helpr.
//
// Idempotent: a replayed event finds 'already_paid' or the same refund row,
// and a refund already 'succeeded' is not sent again. Any failure THROWS, so
// stripe-webhook rolls back its dedupe row and Stripe redelivers.
//
// Emails only for money events (row 44): the paid receipt and the refund
// notice, and the seller's "You sold" email (_shared/declutterSellerEmail.ts),
// best-effort (a failed email never fails the payment).
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { queueEmail } from "../../_shared/resend.ts";
import { declutterEmailParts, emailSeller } from "../../_shared/declutterSellerEmail.ts";
import { recordDeclutterCardAsWalletDefault } from "./_walletDefaultCard.ts";
import { tipChargeBreakdown } from "../../_shared/tipFees.ts";
import { checkPayoutHold } from "../../_shared/payoutHold.ts";

const DECLUTTER_KINDS = new Set(["declutter_card", "declutter_order", "declutter_raise", "declutter_delivery_tip"]);

/** True for a Checkout Session Declutter created. */
export function isDeclutterSession(session: { metadata?: unknown } | null | undefined): boolean {
  const kind = (session?.metadata as Record<string, unknown> | null | undefined)?.kind;
  return typeof kind === "string" && DECLUTTER_KINDS.has(kind);
}

type MarkPaidAnswer =
  | { result: "paid" }
  | { result: "already_paid" }
  | {
    result: "refund"; refund_id: string; reason: string; fee_policy: string; refund_cents: number; refund_status: string;
    /** The refund ROW's order (null for order_missing): the refund's metadata is built from the row, like declutter-money. */
    order_id?: string | null;
  };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function settleDeclutterSession(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  ctx: WebhookContext,
): Promise<void> {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  if (meta.kind === "declutter_card") return saveCard(event, session, meta, ctx);
  if (meta.kind === "declutter_order") return settleOrder(event, session, meta, ctx);
  if (meta.kind === "declutter_raise") return settleRaise(event, session, meta, ctx);
  if (meta.kind === "declutter_delivery_tip") return settleDeliveryTip(session, meta, ctx);
}

type TipPaidAnswer = { result: "paid" | "already" | "unknown" | "session_mismatch"; tip_id?: string; helpr_id?: string; tip_cents?: number; held?: boolean; attached?: boolean };

/**
 * Q2453: the buyer paid a tip for a delivery Helpr (declutter-checkout delivery_tip). A tip is a
 * DESTINATION charge, as a job tip: Stripe has already moved the whole tip to the Helpr's account
 * and kept only the card fee (application_fee_amount, _shared/tipFees.ts). helpr_task_tip_paid
 * marks the row paid ONCE (a replay answers 'already') and tells the Helpr once. Tips are final
 * (Q781). What is never quiet: a page we cannot tie to its row, a charge that is not the tip's
 * own total, and a tip that reached a Helpr placed on a payout hold after the page opened (a job
 * tip is pulled back then, Q1222; a delivery tip is paged to staff, critical, to reverse by hand:
 * tip_hold_redrives only knows job tips). The hold is read on EVERY delivery, the paid one and any
 * replay ('already'), so a failed read that makes Stripe redeliver still pages (lh-money-escrow
 * review #1). Any failure THROWS, so Stripe redelivers.
 */
async function settleDeliveryTip(
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  ctx: WebhookContext,
): Promise<void> {
  const { supabase, logStep } = ctx;
  if (session.mode !== "payment" || !meta.tip_id) {
    logStep("Declutter delivery tip session ignored (shape)", { id: session.id, mode: session.mode });
    return;
  }
  if (session.payment_status !== "paid") {
    logStep("Declutter delivery tip session completed unpaid", { id: session.id, payment_status: session.payment_status });
    return;
  }
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const amount = session.amount_total;
  if (!paymentIntentId || typeof amount !== "number") {
    throw new Error(`declutter delivery tip session ${session.id} paid without a PaymentIntent or amount`);
  }
  const { data, error } = await supabase.rpc("helpr_task_tip_paid", {
    p_tip_id: meta.tip_id,
    p_session_id: session.id,
    p_payment_intent_id: paymentIntentId,
    p_charged_cents: amount,
  });
  if (error) throw new Error(`helpr_task_tip_paid failed: ${error.message}`);
  const answer = data as TipPaidAnswer | null;
  if (!answer || typeof answer !== "object" || !("result" in answer)) {
    throw new Error(`helpr_task_tip_paid gave no answer for tip ${meta.tip_id}`);
  }
  logStep("Declutter delivery tip settled", { tip: meta.tip_id, result: answer.result });
  if (answer.result === "unknown" || answer.result === "session_mismatch") {
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Declutter delivery tip paid but not recorded",
      message: `Session ${session.id} was paid (${dollars(amount)}) as a tip, but ${answer.result === "unknown" ? "no tip row has its id" : "its tip row belongs to another page"}. Stripe already sent the tip to the Helpr; check and record it by hand.`,
      fields: { "Payment intent": paymentIntentId, Tip: meta.tip_id },
    });
    return;
  }
  // The charge is the tip's own total (tipChargeBreakdown, the number the page was made with).
  const expected = tipChargeBreakdown(Number(meta.tip_cents)).chargeCents;
  if (answer.result === "paid" && (!(expected > 0) || amount !== expected || Number(answer.tip_cents) !== Number(meta.tip_cents))) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Declutter delivery tip charged a different amount than its tip",
      message: `Session ${session.id} charged ${dollars(amount)} for a ${dollars(Number(answer.tip_cents ?? 0))} tip; the tip's own total is ${dollars(expected)}. Check the application fee and the Helpr's transfer.`,
      fields: { "Payment intent": paymentIntentId, Tip: meta.tip_id },
    });
  }
  // Owner #3706: a HELD tip stays on the platform and is paid with the delivery pay (declutter-money runs
  // every payout gate before that transfer). One whose delivery pay no longer waits is staff's to pay.
  if (answer.held === true && answer.attached === false) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      oncePerDayKey: `delivery-tip-unattached-${meta.tip_id}`,
      title: "A held delivery tip has no delivery pay to go with",
      message: `A ${dollars(Number(answer.tip_cents ?? 0))} delivery tip (session ${session.id}) was charged on the platform for a Helpr with no payout account, but that delivery's pay is no longer waiting, so nothing will send it. Pay the Helpr exactly the tip by hand from this charge, then record the transfer on the tip.`,
      fields: { "Payment intent": paymentIntentId, Tip: meta.tip_id, Helpr: answer.helpr_id ?? "?" },
    });
  }
  if (answer.helpr_id && answer.held !== true) {
    const hold = await checkPayoutHold(supabase, answer.helpr_id);
    if (hold.kind === "error") throw new Error(`payout hold read failed for ${answer.helpr_id}: ${hold.message}`);
    if (hold.kind === "held") {
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        // One page per tip, however often Stripe redelivers.
        oncePerDayKey: `delivery-tip-held-${meta.tip_id}`,
        title: "A delivery tip reached a Helpr on a payout hold",
        message: `A ${dollars(Number(answer.tip_cents ?? 0))} delivery tip (session ${session.id}) was paid while its Helpr is on a payout hold. Stripe already sent it to their account. A job tip is pulled back here automatically (Q1222); this one is not: reverse the transfer by hand and pay it again when the hold lifts.`,
        fields: { "Payment intent": paymentIntentId, Tip: meta.tip_id, Helpr: answer.helpr_id },
      });
    }
  }
}

type RaisePaidAnswer = {
  result: "applied" | "refund" | "already" | "unknown" | "order_mismatch" | "session_mismatch" | "other_payment";
  raise_id?: string; reason?: string; status?: string;
};

/**
 * Q1929 (spec row 40): the buyer paid a raise of a delivery's Helpr pay
 * (declutter-checkout raise_pay). ONLY a paid page changes anything:
 * declutter_delivery_raise_paid, under the order and task locks, raises the
 * task's pay if it is still waiting for a Helpr, or marks the payment to go
 * back in full (declutter-money sends that refund, keyed on the raise id).
 * An unpaid completion changes nothing. A replay answers 'already'. A page we
 * cannot tie to its raise is never applied: ops are paged to refund it by hand.
 * Any failure THROWS, so Stripe redelivers.
 */
async function settleRaise(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  ctx: WebhookContext,
): Promise<void> {
  const { supabase, logStep } = ctx;
  if (session.mode !== "payment" || !meta.raise_id || !meta.order_id) {
    logStep("Declutter raise session ignored (shape)", { id: session.id, mode: session.mode });
    return;
  }
  if (session.payment_status !== "paid") {
    // Card only: an unpaid completion is logged and changes nothing.
    logStep("Declutter raise session completed unpaid", { id: session.id, payment_status: session.payment_status });
    return;
  }
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const amount = session.amount_total;
  if (!paymentIntentId || typeof amount !== "number") {
    throw new Error(`declutter raise session ${session.id} paid without a PaymentIntent or amount`);
  }
  const { data: orderRow, error: orderErr } = await supabase
    .from("declutter_orders").select("buyer_id").eq("id", meta.order_id).maybeSingle();
  if (orderErr) throw new Error(`declutter order read failed: ${orderErr.message}`);
  const buyer = (orderRow as { buyer_id?: string | null } | null)?.buyer_id ?? null;
  const pageOps = (why: string) => postSlackOpsAlert({
    kind: "stripe_webhook_error",
    severity: "critical",
    title: "Declutter delivery raise paid but not applied: refund it by hand",
    message: `Session ${session.id} was paid (${dollars(amount)}) to raise the delivery pay of order ${meta.order_id}, but ${why}. Nothing was changed; refund it by hand after checking.`,
    fields: { "Payment intent": paymentIntentId, Raise: meta.raise_id },
  });
  if (!buyer || buyer !== meta.buyer_id) {
    await pageOps("its buyer does not match the order");
    return;
  }
  const { data, error } = await supabase.rpc("declutter_delivery_raise_paid", {
    p_raise_id: meta.raise_id,
    p_order_id: meta.order_id,
    p_session_id: session.id,
    p_payment_intent_id: paymentIntentId,
    p_amount_cents: amount,
    p_livemode: event.livemode ? true : false,
  });
  if (error) throw new Error(`declutter_delivery_raise_paid failed: ${error.message}`);
  const answer = data as RaisePaidAnswer | null;
  if (!answer || typeof answer !== "object" || !("result" in answer)) {
    throw new Error(`declutter_delivery_raise_paid gave no answer for raise ${meta.raise_id}`);
  }
  logStep("Declutter raise settled", { raise: meta.raise_id, result: answer.result, reason: answer.reason ?? null });
  if (answer.result === "unknown" || answer.result === "order_mismatch" || answer.result === "session_mismatch" || answer.result === "other_payment") {
    await pageOps(answer.result === "unknown" ? "no raise row has that id"
      : answer.result === "order_mismatch" ? "the raise row belongs to another order"
      : answer.result === "session_mismatch" ? "the raise row names another Stripe page" : "the raise row already holds another payment");
    return;
  }
  if (answer.result === "applied") {
    await sendMoneyEmail(ctx, buyer, "declutter_receipt", "Your Declutter receipt",
      `You paid ${dollars(amount)} to raise your delivery's Helpr pay. Helprs now see the higher pay. If no Helpr takes it in time, the raise comes back with what you paid for delivery.`);
  }
}

async function saveCard(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  ctx: WebhookContext,
): Promise<void> {
  const { stripe, supabase, logStep } = ctx;
  const userId = meta.user_id;
  if (session.mode !== "setup" || !userId || session.client_reference_id !== userId) {
    // Our own function always sets all three; anything else is not ours to apply.
    logStep("Declutter card session ignored (shape)", { id: session.id, mode: session.mode });
    return;
  }
  const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) throw new Error(`declutter card session ${session.id} has no setup_intent`);
  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  if (si.status !== "succeeded") {
    logStep("Declutter card setup not succeeded", { id: si.id, status: si.status });
    return;
  }
  const pm = si.payment_method as Stripe.PaymentMethod | string | null;
  const pmId = typeof pm === "string" ? pm : pm?.id;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id
    ?? (typeof si.customer === "string" ? si.customer : si.customer?.id);
  if (!pmId || !customer) throw new Error(`declutter card setup ${si.id} is missing its payment method`);
  const card = typeof pm === "object" && pm ? pm.card : null;
  const { error } = await supabase.rpc("declutter_save_card", {
    p_user: userId,
    p_customer: customer,
    p_payment_method: pmId,
    p_brand: card?.brand ?? null,
    p_last4: card?.last4 ?? null,
    p_mode: event.livemode ? "live" : "test",
  });
  if (error) throw new Error(`declutter_save_card failed: ${error.message}`);
  logStep("Declutter card saved", { user: userId });
  // One wallet card everywhere (owner 2026-10-18, Q2139): the card saved most
  // recently in ANY section becomes the wallet's default card. After the save,
  // never throws (a failure pages; the card stays saved).
  await recordDeclutterCardAsWalletDefault(event, session.id, userId, customer, si, ctx);
}

/**
 * The card fee Stripe kept on this payment (null: the SQL then estimates
 * 2.9% + 30c) and the charge's own time (null: the event's time is used).
 */
async function chargeFacts(
  stripe: Stripe,
  paymentIntentId: string,
  logStep: WebhookContext["logStep"],
): Promise<{ fee: number | null; chargedAt: number | null }> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    const charge = pi.latest_charge as Stripe.Charge | string | null;
    const bt = typeof charge === "object" && charge ? charge.balance_transaction : null;
    const fee = typeof bt === "object" && bt ? bt.fee : null;
    const created = typeof charge === "object" && charge ? charge.created : null;
    return {
      fee: typeof fee === "number" && Number.isInteger(fee) && fee >= 0 ? fee : null,
      chargedAt: typeof created === "number" && created > 0 ? created : null,
    };
  } catch (e) {
    // Not fatal: the fee only matters if this payment is ever refunded (the SQL
    // estimates it), and the event's own time stands in for the charge's.
    logStep("Declutter charge facts unreadable (estimated instead)", { pi: paymentIntentId, error: String(e) });
    return { fee: null, chargedAt: null };
  }
}

async function settleOrder(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  ctx: WebhookContext,
): Promise<void> {
  const { stripe, supabase, logStep } = ctx;
  const orderId = meta.order_id;
  if (session.mode !== "payment" || !orderId) {
    logStep("Declutter order session ignored (shape)", { id: session.id, mode: session.mode });
    return;
  }
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  // Shipping S3 (Q2259, money review fix 2): a shipped order's page is a card HOLD (capture_method manual), so its
  // session completes 'unpaid' with the PaymentIntent in requires_capture. The hold is recorded like a payment
  // (declutter_mark_order_paid; the same transaction writes the one label claim); the label worker captures only
  // after the label is bought. Read from the PaymentIntent itself, as Shops does (shopCheckout.ts).
  let shipHeld = false;
  if (meta.ship === "1" && session.payment_status !== "paid") {
    if (!paymentIntentId) throw new Error(`declutter ship session ${session.id} has no payment_intent`);
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === "canceled") {
      logStep("Declutter ship hold already released", { id: session.id, pi: paymentIntentId });
      return;
    }
    if (pi.status !== "requires_capture" && pi.status !== "succeeded") {
      throw new Error(`declutter ship session ${session.id}: payment ${paymentIntentId} is ${pi.status}, not a hold`);
    }
    shipHeld = pi.status === "requires_capture";
  } else if (session.payment_status !== "paid") {
    // Card only (declutter-checkout sets payment_method_types ['card']), so
    // completion is payment; anything else is logged and left alone.
    logStep("Declutter order session completed unpaid", { id: session.id, payment_status: session.payment_status });
    return;
  }
  const amount = session.amount_total;
  if (!paymentIntentId || typeof amount !== "number") {
    throw new Error(`declutter order session ${session.id} paid without a PaymentIntent or amount`);
  }
  // The page names its order and its two parties; the order must agree, or
  // this payment is not applied to it (lh-authz-rls review 3b #2: a session
  // made outside our function, e.g. with the test key, naming a real order).
  const { data: orderRow, error: orderErr } = await supabase
    .from("declutter_orders").select("buyer_id, seller_id, handover, items_cents, delivery_cents").eq("id", orderId).maybeSingle();
  if (orderErr) throw new Error(`declutter order read failed: ${orderErr.message}`);
  const parties = orderRow as {
    buyer_id?: string | null; seller_id?: string | null; handover?: string; items_cents?: number | null; delivery_cents?: number | null;
  } | null;
  // Q2307: a party deleted their account after this page opened (the order outlives them with the column NULL). The
  // payment is refunded automatically and never applied (lh-money-escrow review 2026-10-21 #3).
  const partyGone = !!parties && (parties.buyer_id == null || parties.seller_id == null);
  if (parties && !partyGone && (parties.buyer_id !== meta.buyer_id || parties.seller_id !== meta.seller_id)) {
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Declutter payment names the wrong people for its order: not applied",
      message: `Session ${session.id} was paid (${dollars(amount)}) for order ${orderId}, but its buyer/seller do not match the order. It was NOT marked paid; refund it by hand after checking.`,
      fields: { "Payment intent": paymentIntentId },
    });
    return;
  }
  const facts = await chargeFacts(stripe, paymentIntentId, logStep);
  const fee = facts.fee;
  // B41: the payment's own time, signed by Stripe: the charge's time when
  // readable, else the event's (a redelivery keeps both).
  const paidAt = new Date((facts.chargedAt ?? event.created) * 1000).toISOString();
  const { data, error } = partyGone
    ? await supabase.rpc("declutter_refund_party_gone", {
      p_order_id: orderId,
      p_payment_intent_id: paymentIntentId,
      p_amount_cents: amount,
      p_card_fee_cents: fee,
    })
    : await supabase.rpc("declutter_mark_order_paid", {
      p_order_id: orderId,
      p_payment_intent_id: paymentIntentId,
      p_amount_cents: amount,
      p_paid_at: paidAt,
      p_card_fee_cents: fee,
    });
  if (error) throw new Error(`${partyGone ? "declutter_refund_party_gone" : "declutter_mark_order_paid"} failed: ${error.message}`);
  const answer = data as MarkPaidAnswer | null;
  if (!answer || typeof answer !== "object" || !("result" in answer)) {
    throw new Error(`${partyGone ? "declutter_refund_party_gone" : "declutter_mark_order_paid"} gave no answer for order ${orderId}`);
  }
  logStep("Declutter order settled", { order: orderId, result: answer.result, shipHeld });
  if (shipHeld && answer.result !== "paid" && answer.result !== "already_paid") {
    // A hold the order does not take (closed, wrong amount, a second page): release it, which costs nobody
    // anything; never a refund of money that was never taken. The refund row the answer recorded is left for ops
    // (Shipping S6 teaches declutter-money to close a released hold's row).
    await stripe.paymentIntents.cancel(paymentIntentId).catch((e: unknown) => {
      throw new Error(`declutter ship hold ${paymentIntentId} release failed: ${String(e).slice(0, 200)}`);
    });
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "warning",
      title: "Declutter shipped order: hold released, refund row to close",
      message: `Order ${orderId}'s card hold (${dollars(amount)}) was not taken (${answer.result}) and was released at no cost. Its refund row records money that was never captured: close it by hand until Shipping S6.`,
      fields: { "Payment intent": paymentIntentId, Order: orderId },
      oncePerDayKey: `declutter-ship-hold-released:${paymentIntentId}`,
    });
    return;
  }
  // A held payment cannot be partly refunded (nothing was taken): a setup fee owed back is settled at capture (S5).
  if (answer.result === "already_paid" && shipHeld) return;
  if (answer.result === "paid" && shipHeld) {
    await sendMoneyEmail(ctx, meta.buyer_id, "declutter_receipt", "Your Declutter order",
      `We're holding ${dollars(amount)} on your card for your Declutter order. You're charged once the shipping label is made; if it can't be made, the hold is released and you pay nothing. You'll get tracking in the app.`);
    await emailSeller(supabase, parties?.seller_id, orderId, "sold", parties?.items_cents, logStep, 0);
    return;
  }
  if (answer.result === "paid") {
    // lh-money-escrow review of the Q2352 rebase #4: the receipt names the setup fee only when this order's claim
    // WON ('claimed'); a lost claim (refund_due: "Setup fee coming back" follows) or a page without it (not_charged)
    // never says the payment included it. A failed read names no fee rather than guess.
    const { data: feeState, error: feeStateErr } = await supabase.from("declutter_orders").select("setup_fee_state").eq("id", orderId).maybeSingle();
    if (feeStateErr) logStep("Declutter receipt: setup fee state unreadable, fee left out", { orderId, error: feeStateErr.message });
    const feeClaimed = (feeState as { setup_fee_state?: string | null } | null)?.setup_fee_state === "claimed";
    const setupFeeCents = feeClaimed ? Number.parseInt(meta.setup_fee_cents ?? "0", 10) : 0;
    await sendMoneyEmail(ctx, meta.buyer_id, "declutter_receipt", "Your Declutter receipt",
      `You paid ${dollars(amount)} for your Declutter order${
        setupFeeCents > 0 ? `, including the one-time ${dollars(setupFeeCents)} account setup fee (charged once per account)` : ""
      }. The money is held until you have your items; then the seller is paid. ${
        parties?.handover === "delivery"
          // Slice 5 (lh-money-escrow #8): a delivery order has no pickup to make.
          ? "Next: a Helpr picks your items up from the seller and leaves them at your door with a photo. Tap \"I got it\" in the app when you have them."
          : parties?.handover === "seller_delivery"
          // 20261027153244: the seller brings them at the time the buyer picked.
          ? "Next: the seller delivers your items at the time you picked. Tap \"I got it\" in the app when you have them."
          : parties?.handover === "meetup"
          // Q2425 (20261027204500): a public meeting spot, never the seller's home; the spot is in the app.
          ? "Next: book a time in the app and meet the seller at the safe spot you picked. Tap \"I'm here\" when you arrive."
          : "Next: pick up your items at the time you chose."}`);
    // Deep audit #57 / audit 2 SH2-3: the seller is emailed too ("You sold ..."), once, on the same 'paid' answer
    // (a redelivery answers already_paid and sends nothing).
    // AUD31-35: a seller who delivers is told the delivery money too (their payout is items + delivery).
    await emailSeller(supabase, parties?.seller_id, orderId, "sold", parties?.items_cents, logStep,
      parties?.handover === "seller_delivery" ? parties?.delivery_cents : 0);
  }
  if (answer.result === "paid" || answer.result === "already_paid") {
    // Q2352: a sale that stands may owe its buyer the setup fee back, after the receipt (a failed refund throws
    // for a redelivery, which answers already_paid and lands here again).
    await settleSetupFee(ctx, paymentIntentId, orderId);
    return;
  }
  // The payment's Stripe mode goes on the refund row (money review 3.6), so a
  // retry by declutter-money refunds on the key that took it, even when the
  // row has no order (order_missing) and so no parties to decide the mode by.
  const { error: modeErr } = await supabase.rpc("declutter_refund_set_mode", {
    p_refund_id: answer.refund_id,
    p_livemode: event.livemode === true,
  });
  if (modeErr) throw new Error(`declutter_refund_set_mode failed: ${modeErr.message}`);
  const refunded = await executeRefund(ctx, paymentIntentId, answer, orderId);
  // Only a refund Stripe took is announced (lh-money-escrow review 3b #4).
  if (refunded === "sent") {
    await sendMoneyEmail(ctx, meta.buyer_id, "declutter_refund", "Your Declutter refund",
      `${dollars(answer.refund_cents)} is on its way back to your card. Card refunds usually show up in 5 to 10 business days.`);
  }
}

/**
 * Q2352: the order's sale stood, but its account had already paid the one-time
 * setup fee somewhere else first (declutter_claim_setup_fee marked the order
 * refund_due), so exactly that fee goes back, once. List-and-adopt like
 * executeRefund (Stripe keeps an idempotency key 24 h; it redelivers for 3
 * days), then declutter_setup_fee_refunded records it, which also makes it a
 * known refund for declutter-money's "is the charge whole" check and tells the
 * buyer. kind declutter_refund keeps charge.refunded from treating it as a hand
 * refund. Any failure THROWS, so Stripe redelivers and a replay (already_paid)
 * comes back here.
 */
async function settleSetupFee(
  { stripe, supabase, logStep }: WebhookContext,
  paymentIntentId: string,
  orderId: string,
): Promise<void> {
  const { data, error } = await supabase.from("declutter_orders")
    .select("setup_fee_cents, setup_fee_state, stripe_payment_intent_id").eq("id", orderId).maybeSingle();
  if (error) {
    // 42703: the migration is still deploying, so no order carries a setup fee yet.
    if ((error as { code?: string }).code === "42703") return;
    throw new Error(`declutter order setup fee read failed: ${error.message}`);
  }
  const row = data as { setup_fee_cents?: number | null; setup_fee_state?: string | null; stripe_payment_intent_id?: string | null } | null;
  // lh-silent-failure review of the Q2352 rebase #1: a page that charged the sale WITHOUT the fee the order froze is
  // accepted (deploy order: the migration lands before declutter-checkout), and the fee is marked not_charged. That
  // is meant only for pages opened in that deploy window; any later one is an undercharge, so it is never silent.
  if (row && row.setup_fee_state === "not_charged" && Number(row.setup_fee_cents ?? 0) > 0) {
    logStep("Declutter order paid without its setup fee", { orderId, paymentIntentId, setupFeeCents: row.setup_fee_cents });
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "warning",
      title: "Declutter setup fee not charged",
      message: `Order ${orderId} was paid without the one-time setup fee it froze (${String(row.setup_fee_cents)} cents). Expected only for a checkout page opened before declutter-checkout learned the fee; any other case means the page undercharged. The account still owes the fee at its next first-time step.`,
      fields: { "Payment intent": paymentIntentId, Order: orderId },
      oncePerDayKey: `declutter-setup-fee-not-charged:${orderId}`,
    });
    return;
  }
  if (!row || row.setup_fee_state !== "refund_due") return;
  const cents = Number(row.setup_fee_cents ?? 0);
  const page = (title: string, message: string) => postSlackOpsAlert({
    kind: "stripe_webhook_error",
    severity: "critical",
    title,
    message,
    fields: { "Payment intent": paymentIntentId, Order: orderId },
  });
  if (!Number.isInteger(cents) || cents <= 0 || row.stripe_payment_intent_id !== paymentIntentId) {
    await page("Declutter setup fee owed back but not sent: check it",
      `Order ${orderId} owes its buyer the one-time setup fee back (they had paid it elsewhere), but its amount (${String(row.setup_fee_cents)}) or payment (${String(row.stripe_payment_intent_id)}) does not match this charge. Nothing was sent; refund exactly the fee by hand in the Stripe Dashboard (a hand refund of exactly the fee is recorded on the order, so the seller is still paid).`);
    return;
  }
  let feeRefund: Stripe.Refund;
  const feeIntentId = paymentIntentId;
  try {
    const listed = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
    if (listed?.has_more) throw new Error(`more than 100 refunds on ${paymentIntentId}; refusing to read a partial list`);
    const mine = (listed?.data ?? []).filter((x) => (x.metadata as Record<string, string> | null)?.setup_fee_order_id === orderId);
    const existing = mine.find((x) => x.status !== "failed" && x.status !== "canceled");
    // own-mistake full refund (owner, 2026-10-14): the account had already paid the
    // one-time setup fee, so this order charged it a second time; exactly that fee goes
    // back in full (never charged twice, Q2352). The sale itself stands.
    feeRefund = existing ?? await stripe.refunds.create(
      {
        payment_intent: feeIntentId,
        amount: cents,
        metadata: { kind: "declutter_refund", reason: "setup_fee_already_paid", order_id: orderId, setup_fee_order_id: orderId },
      },
      { idempotencyKey: mine.length === 0 ? `declutter-setup-fee-${orderId}` : `declutter-setup-fee-${orderId}-r${mine.length}` },
    );
  } catch (e) {
    await page("Declutter setup fee refund failed at Stripe (will retry)",
      `The ${dollars(cents)} setup fee owed back on order ${orderId} could not be refunded; the webhook asks Stripe to redeliver. ${String(e).slice(0, 200)}`);
    throw e;
  }
  if (feeRefund.status === "failed" || feeRefund.status === "canceled") {
    await page("Declutter setup fee refund did not go through (will retry)",
      `Stripe answered ${feeRefund.status} for the ${dollars(cents)} setup fee owed back on order ${orderId}; the webhook asks Stripe to redeliver.`);
    throw new Error(`setup fee refund ${feeRefund.id} ${feeRefund.status}`);
  }
  const { data: recorded, error: recErr } = await supabase.rpc("declutter_setup_fee_refunded", {
    p_order_id: orderId,
    p_stripe_refund_id: feeRefund.id,
  });
  if (recErr) throw new Error(`declutter_setup_fee_refunded failed: ${recErr.message}`);
  if (recorded !== "recorded" && recorded !== "already") {
    await page("Declutter setup fee refunded twice? Check it",
      `Refund ${feeRefund.id} (${dollars(cents)}) sent the setup fee back on order ${orderId}, but the order answered ${String(recorded)}. Check the payment's refunds in Stripe.`);
  }
  logStep("Declutter setup fee sent back (paid elsewhere first)", { order: orderId, refund: feeRefund.id, result: recorded });
}

async function executeRefund(
  { stripe, supabase, logStep }: WebhookContext,
  paymentIntentId: string,
  refund: Extract<MarkPaidAnswer, { result: "refund" }>,
  orderId: string,
): Promise<"sent" | "already" | "failed"> {
  // Already handled: sent, or taken out of the automatic path by an admin (held for review /
  // settled by hand, 20261019070737), so a webhook redelivery never sends a second refund.
  if (refund.refund_status === "succeeded" || refund.refund_status === "held_for_review" || refund.refund_status === "settled_by_hand") return "already";
  let stripeRefund: Stripe.Refund;
  try {
    // List-and-adopt first, exactly like declutter-money: Stripe keeps an
    // idempotency key for 24 hours, and it redelivers a failed event for 3
    // days. A redelivery more than 24 h after a refund Stripe TOOK (the row
    // was not recorded: declutter_refund_executed failed) would otherwise be a
    // second refund whenever the refund is at most half the charge
    // (lh-money-escrow should-fix (c)). A refund Stripe failed or cancelled
    // is not adopted; the next one goes under a new key (`-r<n>`, the cron's).
    const listed = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
    if (listed?.has_more) throw new Error(`more than 100 refunds on ${paymentIntentId}; refusing to read a partial list`);
    const mine = (listed?.data ?? []).filter((x) => (x.metadata as Record<string, string> | null)?.refund_id === refund.refund_id);
    const existing = mine.find((x) => x.status !== "failed" && x.status !== "canceled");
    stripeRefund = existing ?? await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: refund.refund_cents,
        // Built from the refund ROW exactly as declutter-money builds it (same key, so the same parameters:
        // Stripe refuses a reused key with others). An order_missing row has no order: "", whatever the page named.
        metadata: { kind: "declutter_refund", refund_id: refund.refund_id, reason: refund.reason, order_id: refund.order_id ?? "" },
      },
      // One Stripe refund per refund row, whatever the retries.
      { idempotencyKey: mine.length === 0 ? `declutter-refund-${refund.refund_id}` : `declutter-refund-${refund.refund_id}-r${mine.length}` },
    );
  } catch (e) {
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Declutter refund failed at Stripe (will retry)",
      message: `Refund ${refund.refund_id} (${refund.reason}, ${dollars(refund.refund_cents)}) for order ${orderId} could not be created; the webhook asks Stripe to redeliver.`,
      fields: { "Payment intent": paymentIntentId, Error: String(e).slice(0, 200) },
    });
    throw e;
  }
  const succeeded = stripeRefund.status !== "failed" && stripeRefund.status !== "canceled";
  const { error } = await supabase.rpc("declutter_refund_executed", {
    p_refund_id: refund.refund_id,
    p_stripe_refund_id: stripeRefund.id,
    p_succeeded: succeeded,
  });
  if (error) throw new Error(`declutter_refund_executed failed: ${error.message}`);
  if (!succeeded) {
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Declutter refund did not go through",
      message: `Stripe answered ${stripeRefund.status} for refund ${refund.refund_id} (${refund.reason}) on order ${orderId}. Settle it by hand.`,
      fields: { "Refund": stripeRefund.id },
    });
  }
  logStep("Declutter refund executed", { refund: refund.refund_id, reason: refund.reason, status: stripeRefund.status });
  return succeeded ? "sent" : "failed";
}

/** Best-effort money email (row 44). Never throws: the payment is already recorded. */
async function sendMoneyEmail(
  { supabase, logStep }: WebhookContext,
  userId: string | undefined,
  templateName: string,
  subject: string,
  body: string,
): Promise<void> {
  if (!userId) return;
  try {
    const { data: profile, error } = await supabase.from("profiles").select("email, full_name").eq("user_id", userId).maybeSingle();
    const to = (profile as { email?: string | null } | null)?.email;
    if (error || !to) {
      logStep("Declutter email skipped (no address)", { template: templateName, error: error?.message });
      return;
    }
    // AUD31-35: the branded notice email (greeting, sign-off, settings footer), not one raw paragraph.
    const { html, text } = await declutterEmailParts({
      title: subject, message: body, path: "/declutter?tab=buying", actionLabel: "Open Buying",
      fullName: (profile as { full_name?: string | null } | null)?.full_name,
    });
    const result = await queueEmail(supabase, { to, subject, templateName, html, text });
    if (!result.ok) {
      logStep("Declutter email not queued", { template: templateName, error: String(result.error) });
    }
  } catch (e) {
    logStep("Declutter email threw", { template: templateName, error: String(e) });
  }
}

/**
 * True for a charge Declutter's own Checkout took (declutter-checkout sets
 * kind=declutter_order and transfer_group declutter_order_<id> on the
 * PaymentIntent, which Stripe copies to its charge), or one already carrying a
 * Declutter refund.
 */
export function isDeclutterCharge(charge: Stripe.Charge, refunds: Stripe.Refund[]): boolean {
  const meta = (charge.metadata ?? {}) as Record<string, string>;
  return meta.kind === "declutter_order"
    || (typeof charge.transfer_group === "string" && charge.transfer_group.startsWith("declutter_order_"))
    || refunds.some((r) => (r?.metadata as Record<string, string> | null)?.kind === "declutter_refund");
}

/** What a person must check after a hand refund that settled nothing (declutter_record_hand_refund's answer). */
const HAND_REFUND_PAGES: Record<string, string> = {
  recorded_short: "It is recorded, but the hand refunds on this payment do not yet cover what its refund row owes, so the row is not settled.",
  recorded_no_row: "It is recorded against the order, which had no refund row: Declutter did not decide a refund here.",
  recorded_row_already_settled: "Its refund row was ALREADY settled: the buyer may have been refunded twice.",
  not_declutter: "No Declutter order or refund row knows this payment; nothing was recorded.",
};

/**
 * charge.refunded on a Declutter charge (lh-money-escrow should-fix (b)): a
 * refund Declutter did not create (no metadata kind, e.g. "refund it by hand"
 * in the Stripe Dashboard) is recorded against the order with
 * declutter_record_hand_refund, once per Stripe refund id. When it covers the
 * payment's unsettled refund row, the row is settled; anything else is
 * recorded and a person is paged to check it. Nothing here moves money.
 * A failed record THROWS, so Stripe redelivers.
 */
export async function recordDeclutterHandRefunds(
  event: Stripe.Event,
  charge: Stripe.Charge,
  paymentIntentId: string | undefined,
  refunds: Stripe.Refund[],
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const hand = refunds.filter((r) => !!r?.id && r.status !== "failed" && r.status !== "canceled"
    && (r.metadata as Record<string, string> | null)?.kind !== "declutter_refund");
  if (hand.length === 0) {
    logStep("Declutter refund: recorded and announced by its own path", { chargeId: charge.id });
    return;
  }
  if (!paymentIntentId) throw new Error(`Declutter charge ${charge.id} was refunded but names no PaymentIntent`);
  for (const r of hand) {
    // Q1929: a hand refund on a delivery-pay RAISE's own charge settles that raise (never the order's rows).
    const { data: raiseAnswer, error: raiseErr } = await supabase.rpc("declutter_delivery_raise_hand_refund", {
      p_payment_intent_id: paymentIntentId,
      p_stripe_refund_id: r.id,
      p_amount_cents: Number(r.amount ?? 0),
    });
    if (raiseErr && (raiseErr as { code?: string }).code !== "PGRST202") {
      throw new Error(`declutter_delivery_raise_hand_refund failed for ${r.id}: ${raiseErr.message}`);
    }
    // Only a known answer decides the path: a missing or unknown one is a defect, never "not a raise"
    // (it used to skip the order's own hand-refund record). Throw, so Stripe redelivers.
    if (!raiseErr && !["not_raise", "settled", "already", "recorded_other"].includes(String(raiseAnswer))) {
      throw new Error(`declutter_delivery_raise_hand_refund gave no known answer for ${r.id}: ${JSON.stringify(raiseAnswer)}`);
    }
    if (!raiseErr && raiseAnswer !== "not_raise") {
      logStep("Declutter raise refunded outside Declutter", { refund: r.id, result: raiseAnswer });
      if (raiseAnswer === "recorded_other") {
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Delivery-pay raise refunded outside Declutter: check it",
          message: `Refund ${r.id} (${dollars(Number(r.amount ?? 0))}) on raise payment ${paymentIntentId} was made by hand, but that raise was not waiting for a refund of at least that much. Nothing was moved. If the raise was already in the Helpr's pay, the Helpr's payout will not send (its raise charge is refunded): decide it by hand.`,
          fields: { Charge: charge.id },
        });
      }
      continue;
    }
    // Q2352 (lh-money-escrow review of the rebase #1): a setup fee owed back (refund_due) that ops sent by hand, as
    // the pages ask, is exactly the fee: it is recorded as the fee's refund (declutter_setup_fee_refunded), never as
    // a hand refund of the sale, so declutter-money's whole-charge check counts it and the seller is still paid.
    const { data: feeOrder, error: feeOrderErr } = await supabase.from("declutter_orders")
      .select("id, setup_fee_cents").eq("stripe_payment_intent_id", paymentIntentId).eq("setup_fee_state", "refund_due").maybeSingle();
    if (feeOrderErr && (feeOrderErr as { code?: string }).code !== "42703") {
      throw new Error(`declutter setup fee read failed for ${r.id}: ${feeOrderErr.message}`);
    }
    const owed = feeOrder as { id?: string; setup_fee_cents?: number | null } | null;
    if (owed?.id && Number(owed.setup_fee_cents ?? 0) > 0 && Number(r.amount ?? 0) === Number(owed.setup_fee_cents)) {
      const { data: feeAnswer, error: feeErr } = await supabase.rpc("declutter_setup_fee_refunded", { p_order_id: owed.id, p_stripe_refund_id: r.id });
      if (feeErr) throw new Error(`declutter_setup_fee_refunded failed for hand refund ${r.id}: ${feeErr.message}`);
      if (feeAnswer !== "recorded" && feeAnswer !== "already") {
        throw new Error(`declutter_setup_fee_refunded gave ${JSON.stringify(feeAnswer)} for hand refund ${r.id}`);
      }
      logStep("Declutter setup fee refunded by hand: recorded as the fee's refund", { refund: r.id, order: owed.id, result: feeAnswer });
      continue;
    }
    const { data, error } = await supabase.rpc("declutter_record_hand_refund", {
      p_payment_intent_id: paymentIntentId,
      p_stripe_refund_id: r.id,
      p_amount_cents: Number(r.amount ?? 0),
      p_livemode: event.livemode ? true : false,
    });
    if (error) throw new Error(`declutter_record_hand_refund failed for ${r.id}: ${error.message}`);
    logStep("Declutter refund made outside Declutter", { refund: r.id, result: data });
    const why = HAND_REFUND_PAGES[String(data)];
    if (why) {
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Declutter refund made outside Declutter: check the order",
        message: `Refund ${r.id} (${dollars(Number(r.amount ?? 0))}) on ${paymentIntentId} was made outside Declutter. ${why} Nothing was moved. Check the order's seller payout: declutter-money never pays from a refunded charge, but a payout already sent before this refund is not taken back.`,
        fields: { Charge: charge.id },
      });
    }
  }
}

/**
 * charge.refund.updated for a refund with no Declutter kind (lh-money-escrow
 * review of lane J, should-fix 1): when it is a hand refund we recorded and
 * Stripe moved it to failed / canceled, the row it settled reopens
 * (declutter_hand_refund_failed) and a person is paged. Answers true when the
 * refund was Declutter's (the caller then stops); false lets the jobs path run.
 * A function not deployed yet (PGRST202) is "not Declutter": the jobs path
 * must never stop on it. Any other failure THROWS, so Stripe redelivers.
 */
export async function handleDeclutterHandRefundFailed(
  refund: Stripe.Refund,
  { supabase }: Pick<WebhookContext, "supabase">,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("declutter_hand_refund_failed", {
    p_stripe_refund_id: refund.id,
    p_why: `${refund.status}: ${refund.failure_reason ?? "no reason given"}`,
  });
  if (error) {
    if ((error as { code?: string }).code === "PGRST202") return false;
    throw new Error(`declutter_hand_refund_failed failed for ${refund.id}: ${error.message}`);
  }
  // Only the function's own Declutter answers stop the jobs path; anything else (not_declutter) lets it run.
  if (data === "already") return true;
  if (data !== "reopened" && data !== "recorded_failed") return false;
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title: "Declutter refund made by hand FAILED",
    message: `Stripe moved hand refund ${refund.id} (${dollars(Number(refund.amount ?? 0))}) to ${refund.status} (${refund.failure_reason ?? "no reason given"}). The buyer has NOT been repaid. ${data === "reopened" ? "Its refund row is open again (the buyer was told)." : "It did not reopen a refund row (it settled none, or the other hand refunds on the payment still cover it)."} Refund it again by hand.`,
    fields: { Refund: refund.id },
  });
  return true;
}
