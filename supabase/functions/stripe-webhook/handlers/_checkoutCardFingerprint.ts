// seed-policy: pages for seed/E2E checkouts too. A check that did not run is a
// platform failure whoever paid, and a seed account banned by a card match is
// exactly the signal the nightly journeys exist to surface.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";
import {
  cardFingerprintOf,
  checkoutPayerId,
  enforcePaymentFingerprint,
} from "../../_shared/paymentFingerprint.ts";

/**
 * Q1324: the card that paid a Checkout session is checked against the cards of
 * banned people (owner, 2026-10-05: a match AUTO-BANS the paying account).
 *
 * Runs AFTER the session is settled (checkoutSessionCompleted.ts), never
 * before and never instead: the money has already moved, and recording it must
 * not depend on this check. So this never throws. Every way it can fail to run
 * pages ops instead; "could not check" is never read as "not banned".
 *
 * The card comes from the PaymentIntent (payment mode) or the subscription's
 * default payment method (subscription mode), expanded so Stripe returns its
 * `card.fingerprint`. A session paid with no card (a gift balance that covered
 * it all, a bank debit) has no card fingerprint and is skipped.
 */
export async function checkCheckoutCardFingerprint(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const payer = checkoutPayerId(session as unknown as { metadata?: Record<string, string> | null; client_reference_id?: string | null });
  if (!payer) {
    logStep("Q1324 card check skipped: no payer id on the session", { sessionId: session.id });
    return;
  }

  let paymentMethod: unknown = null;
  try {
    if (typeof session.payment_intent === "string" && session.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ["payment_method"] });
      paymentMethod = (pi as { payment_method?: unknown } | undefined)?.payment_method ?? null;
    } else if (typeof session.subscription === "string" && session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription, { expand: ["default_payment_method"] });
      paymentMethod = (sub as { default_payment_method?: unknown } | undefined)?.default_payment_method ?? null;
    }
  } catch (err) {
    // The ids are the event session's own, and stripe-webhook refuses an event
    // whose mode differs from the key's, so a test-object-under-live-key
    // answer cannot happen here (stripeStoredIdRetrieveClassified: EVENT).
    await reportNotChecked(session.id, payer, `could not read the payment method: ${caughtMessage(err)}`);
    return;
  }

  const fingerprint = cardFingerprintOf(paymentMethod);
  if (!fingerprint) {
    logStep("Q1324 card check skipped: no card fingerprint on this payment", { sessionId: session.id });
    return;
  }

  const check = await enforcePaymentFingerprint(supabase, payer, "card", fingerprint);
  if (check.kind === "not_deployed") {
    console.warn(`[STRIPE-WEBHOOK] Q1324 card check not deployed yet (${check.message}); session ${session.id}`);
    return;
  }
  if (check.kind === "failed") {
    await reportNotChecked(session.id, payer, check.message);
    return;
  }
  if (check.verdict.banned) {
    logStep("Q1324 card matched a retained ban", { sessionId: session.id, payer, alreadyBanned: check.verdict.already_banned });
    await postSlackOpsAlert({
      kind: "fraud_flag",
      severity: "warning",
      title: "Ban evasion: a banned person's card paid a checkout",
      message: check.verdict.already_banned
        ? "The paying account was already banned; its ban was left as it was. The fraud console has the details."
        : "The paying account was banned automatically (owner rule Q1324). Review its open jobs and this payment in the fraud console.",
      fields: { session_id: session.id, user_id: payer },
    });
  }
}

async function reportNotChecked(sessionId: string, userId: string, reason: string): Promise<void> {
  console.error(`[STRIPE-WEBHOOK] Q1324 card check did not run for session ${sessionId}: ${reason}`);
  await postSlackOpsAlert({
    kind: "security",
    severity: "critical",
    title: "Ban-evasion card check did not run",
    message: "A paid checkout's card was NOT checked against banned people's cards. The payment itself was recorded. Re-check this account by hand.",
    fields: { session_id: sessionId, user_id: userId, reason },
  });
}
