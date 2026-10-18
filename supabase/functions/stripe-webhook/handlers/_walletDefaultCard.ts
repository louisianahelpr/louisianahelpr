// seed-policy: pages for seed/E2E checkouts too. A saved card that did not
// become the wallet's default is a platform failure whoever paid.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";
import { storedStripeCustomer } from "../../_shared/stripeCustomer.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One wallet (Q2139; owner 2026-10-18: ONE WALLET CARD EVERYWHERE). The card a
 * member saved MOST RECENTLY, in any section, becomes their wallet's DEFAULT
 * card (invoice_settings.default_payment_method), the off-session consent
 * auto-tip charges (auto-tip-charge reads only it). The two save paths:
 *   - Jobs: "Save card for next time" on a job checkout (create-payment sets
 *     setup_future_usage=off_session): recordWalletDefaultCard.
 *   - Declutter: the card page (declutter-card, mode=setup), after
 *     declutter_save_card stored it: recordDeclutterCardAsWalletDefault.
 * Both go through setWalletDefaultCard, the ONE place our code sets a default.
 *
 * Set ONLY when every fact agrees: a member's uuid, a customer that IS that
 * member's stored wallet customer in the event's mode, and a card attached to
 * that same customer. Anything else is skipped (logged), never guessed.
 *
 * Runs AFTER the money/card is recorded and never throws: a failure pages ops;
 * the cost of a missed default is auto-tip asking the poster to tip by hand.
 */
async function setWalletDefaultCard(
  { stripe, supabase, logStep }: WebhookContext,
  facts: {
    sessionId: string;
    member: string;
    mode: "live" | "test";
    customer: string | null;
    paymentMethod: Stripe.PaymentMethod | string | null;
    section: "jobs" | "declutter";
  },
): Promise<void> {
  const { sessionId, member, mode, customer, paymentMethod, section } = facts;
  let stored: string | null;
  try {
    stored = await storedStripeCustomer(supabase, member, mode);
  } catch (err) {
    await page(sessionId, member, section, `could not read the wallet: ${caughtMessage(err)}`);
    return;
  }
  if (!stored || customer !== stored) {
    logStep("Wallet default card skipped: the card is not on the member's wallet customer", { sessionId, section });
    return;
  }
  const card = paymentMethod && typeof paymentMethod === "object" && paymentMethod.type === "card" ? paymentMethod : null;
  const cardOwner = card ? (typeof card.customer === "string" ? card.customer : card.customer?.id ?? null) : null;
  if (!card?.id || cardOwner !== stored) {
    logStep("Wallet default card skipped: no card saved on the wallet customer", { sessionId, section });
    return;
  }

  // "Most recently saved" is the CARD's own time, never the order events
  // arrive in: Stripe delivers out of order and retries a failed event hours
  // later, and an older save must not replace a newer one (lh-money-escrow
  // review of 05df69882 #1).
  try {
    const current = await stripe.customers.retrieve(stored, { expand: ["invoice_settings.default_payment_method"] });
    const def = (current as Stripe.Customer).invoice_settings?.default_payment_method;
    const defCard = def && typeof def === "object" ? def : null;
    const defOwner = defCard ? (typeof defCard.customer === "string" ? defCard.customer : defCard.customer?.id ?? null) : null;
    if (defCard && defCard.id !== card.id && defOwner === stored && (defCard.created ?? 0) > (card.created ?? 0)) {
      logStep("Wallet default card kept: the current default was saved more recently", { sessionId, section });
      return;
    }
  } catch (err) {
    await page(sessionId, member, section, `could not read the wallet's current default card: ${caughtMessage(err)}`);
    return;
  }

  try {
    await stripe.customers.update(stored, { invoice_settings: { default_payment_method: card.id } });
    logStep("Wallet default card set", { sessionId, member, section });
  } catch (err) {
    await page(sessionId, member, section, `could not set the wallet's default card: ${caughtMessage(err)}`);
  }
}

/** Jobs: a job checkout's "Save card for next time" (checkout.session.completed, mode=payment). */
export async function recordWalletDefaultCard(event: Stripe.Event, ctx: WebhookContext): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "payment" || typeof session.payment_intent !== "string" || !session.payment_intent) return;
  // Only a checkout that asked to save the card (create-payment marks it);
  // every other paid session (orders, tips, gift cards) is never read here.
  if ((session.metadata as Record<string, string> | null)?.wallet_save !== "1") return;

  let pi: Stripe.PaymentIntent;
  try {
    pi = await ctx.stripe.paymentIntents.retrieve(session.payment_intent, { expand: ["payment_method"] });
  } catch (err) {
    await page(session.id, null, "jobs", `could not read the PaymentIntent: ${caughtMessage(err)}`);
    return;
  }
  if (pi?.setup_future_usage !== "off_session") return;
  const meta = (pi.metadata ?? {}) as Record<string, string>;
  const member = meta.customer_id;
  if (!member || !UUID_RE.test(member) || !meta.job_id) {
    ctx.logStep("Wallet default card skipped: not a member's job payment", { sessionId: session.id });
    return;
  }
  const piCustomer = typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null;
  await setWalletDefaultCard(ctx, {
    sessionId: session.id,
    member,
    mode: event.livemode ? "live" : "test",
    customer: piCustomer,
    paymentMethod: pi.payment_method as Stripe.PaymentMethod | string | null,
    section: "jobs",
  });
}

/**
 * Declutter: the card page's SetupIntent succeeded and declutter_save_card
 * stored the card (and the wallet customer, if the member had none yet).
 * `customer` is the one saveCard stored; the SetupIntent was read with
 * expand payment_method.
 */
export async function recordDeclutterCardAsWalletDefault(
  event: Stripe.Event,
  sessionId: string,
  member: string,
  customer: string,
  si: Stripe.SetupIntent,
  ctx: WebhookContext,
): Promise<void> {
  if (!UUID_RE.test(member)) {
    ctx.logStep("Wallet default card skipped: not a member's card", { sessionId });
    return;
  }
  await setWalletDefaultCard(ctx, {
    sessionId,
    member,
    mode: event.livemode === true ? "live" : "test",
    customer,
    paymentMethod: si.payment_method as Stripe.PaymentMethod | string | null,
    section: "declutter",
  });
}

async function page(sessionId: string, member: string | null, section: "jobs" | "declutter", why: string): Promise<void> {
  try {
    await postSlackOpsAlert({
      kind: "custom",
      severity: "warning",
      title: "Saved card did not become the wallet's default card",
      message: `A member saved a card (${section === "jobs" ? "job checkout" : "Declutter card page"}), but ${why}. Nothing was charged; auto-tip will ask them to tip by hand until a card is saved again.`,
      fields: { session_id: sessionId, user_id: member ?? "(unknown)", section },
    });
  } catch (err) {
    // The page itself failed: the log line is the last record (never throws, see above).
    console.error(`[STRIPE-WEBHOOK] wallet default card alert failed for ${sessionId}: ${why}; ${caughtMessage(err)}`);
  }
}
