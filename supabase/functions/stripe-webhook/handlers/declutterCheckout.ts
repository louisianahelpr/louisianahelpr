// seed-policy: pages for seed/test Declutter orders too, on purpose: every alert
// here is money that moved (or a refund that did not) while the database says
// otherwise, whoever owns the order.
//
// DECLUTTER (docs/specs/declutter-auctions.md, slice 3b, B39-B41): the two
// Checkout Sessions Declutter creates, told apart by metadata.kind.
//
//   declutter_card  (declutter-card, mode=setup)    the buyer saved a card
//                   (row 36). The card is read off the SetupIntent and stored
//                   with declutter_save_card. Nothing is charged.
//   declutter_order (declutter-checkout, mode=payment) the buyer paid an
//                   order. declutter_mark_order_paid decides, from the order's
//                   own state and the payment's OWN Stripe time (event.created,
//                   B41), whether the payment stands ('paid') or goes back
//                   ('refund', with a reason that fixes who bears the card fee,
//                   B40). A refund answer is executed here with Stripe, keyed
//                   on the refund row (a retry never refunds twice), and
//                   reported back with declutter_refund_executed.
//
// Idempotent: a replayed event finds 'already_paid' or the same refund row,
// and a refund already 'succeeded' is not sent again. Any failure THROWS, so
// stripe-webhook rolls back its dedupe row and Stripe redelivers.
//
// Emails only for money events (row 44): the paid receipt and the refund
// notice, best-effort (a failed email never fails the payment).
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { queueEmail } from "../../_shared/resend.ts";
import { getAppUrl } from "../../_shared/appUrl.ts";

const DECLUTTER_KINDS = new Set(["declutter_card", "declutter_order"]);

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
}

async function saveCard(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
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
  if (session.payment_status !== "paid") {
    // Card only (declutter-checkout sets payment_method_types ['card']), so
    // completion is payment; anything else is logged and left alone.
    logStep("Declutter order session completed unpaid", { id: session.id, payment_status: session.payment_status });
    return;
  }
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const amount = session.amount_total;
  if (!paymentIntentId || typeof amount !== "number") {
    throw new Error(`declutter order session ${session.id} paid without a PaymentIntent or amount`);
  }
  // The page names its order and its two parties; the order must agree, or
  // this payment is not applied to it (lh-authz-rls review 3b #2: a session
  // made outside our function, e.g. with the test key, naming a real order).
  const { data: orderRow, error: orderErr } = await supabase
    .from("declutter_orders").select("buyer_id, seller_id").eq("id", orderId).maybeSingle();
  if (orderErr) throw new Error(`declutter order read failed: ${orderErr.message}`);
  const parties = orderRow as { buyer_id?: string; seller_id?: string } | null;
  if (parties && (parties.buyer_id !== meta.buyer_id || parties.seller_id !== meta.seller_id)) {
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
  const { data, error } = await supabase.rpc("declutter_mark_order_paid", {
    p_order_id: orderId,
    p_payment_intent_id: paymentIntentId,
    p_amount_cents: amount,
    p_paid_at: paidAt,
    p_card_fee_cents: fee,
  });
  if (error) throw new Error(`declutter_mark_order_paid failed: ${error.message}`);
  const answer = data as MarkPaidAnswer | null;
  if (!answer || typeof answer !== "object" || !("result" in answer)) {
    throw new Error(`declutter_mark_order_paid gave no answer for order ${orderId}`);
  }
  logStep("Declutter order settled", { order: orderId, result: answer.result });
  if (answer.result === "paid") {
    await sendMoneyEmail(ctx, meta.buyer_id, "declutter_receipt", "Your Declutter receipt",
      `You paid ${dollars(amount)} for your Declutter order. The money is held until you have your items; then the seller is paid. Next: pick up your items at the time you chose.`);
    return;
  }
  if (answer.result === "already_paid") return;
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

async function executeRefund(
  { stripe, supabase, logStep }: WebhookContext,
  paymentIntentId: string,
  refund: Extract<MarkPaidAnswer, { result: "refund" }>,
  orderId: string,
): Promise<"sent" | "already" | "failed"> {
  if (refund.refund_status === "succeeded") return "already";
  let stripeRefund: Stripe.Refund;
  try {
    stripeRefund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: refund.refund_cents,
        // Built from the refund ROW exactly as declutter-money builds it (same key, so the same parameters:
        // Stripe refuses a reused key with others). An order_missing row has no order: "", whatever the page named.
        metadata: { kind: "declutter_refund", refund_id: refund.refund_id, reason: refund.reason, order_id: refund.order_id ?? "" },
      },
      // One Stripe refund per refund row, whatever the retries.
      { idempotencyKey: `declutter-refund-${refund.refund_id}` },
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
    const { data: profile, error } = await supabase.from("profiles").select("email").eq("user_id", userId).maybeSingle();
    const to = (profile as { email?: string | null } | null)?.email;
    if (error || !to) {
      logStep("Declutter email skipped (no address)", { template: templateName, error: error?.message });
      return;
    }
    const link = `${getAppUrl()}/declutter?view=cart`;
    const result = await queueEmail(supabase, {
      to,
      subject,
      templateName,
      html: `<p>${body}</p><p><a href="${link}">Open your Declutter cart</a></p>`,
      text: `${body}\n\nOpen your Declutter cart: ${link}`,
    });
    if (!result.ok) {
      logStep("Declutter email not queued", { template: templateName, error: String(result.error) });
    }
  } catch (e) {
    logStep("Declutter email threw", { template: templateName, error: String(e) });
  }
}
