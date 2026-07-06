import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { logStep, type WebhookContext } from "./context.ts";
import { handleCheckoutSessionCompleted } from "./handlers/checkoutSessionCompleted.ts";
import { handleCheckoutSessionExpired } from "./handlers/checkoutSessionExpired.ts";
import { handleCustomerSubscriptionUpdated } from "./handlers/customerSubscriptionUpdated.ts";
import { handleCustomerSubscriptionDeleted } from "./handlers/customerSubscriptionDeleted.ts";
import { handlePaymentIntentPaymentFailed } from "./handlers/paymentIntentPaymentFailed.ts";
import { handleChargeRefunded } from "./handlers/chargeRefunded.ts";
import { handleChargeDisputeCreated } from "./handlers/chargeDisputeCreated.ts";
import { handleChargeDisputeClosed } from "./handlers/chargeDisputeClosed.ts";
import { handleAccountUpdated } from "./handlers/accountUpdated.ts";
import { handlePaymentIntentSucceeded } from "./handlers/paymentIntentSucceeded.ts";
import { handleTransferCreated } from "./handlers/transferCreated.ts";
import { handleTransferFailed } from "./handlers/transferFailed.ts";
import { handleTransferReversed } from "./handlers/transferReversed.ts";
import { handleTaxSettingsUpdated } from "./handlers/taxSettingsUpdated.ts";

// Dispatch map: one handler per Stripe event type. Adding support for a new
// event = add a handler file + one entry here. Anything not listed falls
// through to the "Unhandled event type" log below (same as the old default).
const EVENT_HANDLERS: Record<
  string,
  (event: Stripe.Event, ctx: WebhookContext) => void | Promise<void>
> = {
  "checkout.session.completed": handleCheckoutSessionCompleted,
  "checkout.session.expired": handleCheckoutSessionExpired,
  "customer.subscription.updated": handleCustomerSubscriptionUpdated,
  "customer.subscription.deleted": handleCustomerSubscriptionDeleted,
  "payment_intent.payment_failed": handlePaymentIntentPaymentFailed,
  "charge.refunded": handleChargeRefunded,
  "charge.dispute.created": handleChargeDisputeCreated,
  "charge.dispute.closed": handleChargeDisputeClosed,
  "account.updated": handleAccountUpdated,
  "payment_intent.succeeded": handlePaymentIntentSucceeded,
  "transfer.created": handleTransferCreated,
  "transfer.failed": handleTransferFailed,
  "transfer.reversed": handleTransferReversed,
  "tax.settings.updated": handleTaxSettingsUpdated,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  // Log key mode (live vs test) so you can verify the correct key is loaded
  if (stripeKey) {
    const keyMode = stripeKey.startsWith("sk_live_") || stripeKey.startsWith("rk_live_")
      ? "LIVE"
      : stripeKey.startsWith("sk_test_") || stripeKey.startsWith("rk_test_")
      ? "TEST"
      : "UNKNOWN";
    console.log(`[STRIPE-WEBHOOK] 🔑 Stripe key mode: ${keyMode} (prefix: ${stripeKey.slice(0, 8)}...)`);
  }
  if (webhookSecret) {
    console.log(`[STRIPE-WEBHOOK] 🔐 Webhook secret loaded (prefix: ${webhookSecret.slice(0, 8)}..., length: ${webhookSecret.length})`);
  }

  if (!stripeKey) {
    console.error("🚨 [STRIPE-WEBHOOK] ALERT: STRIPE_SECRET_KEY not set — acknowledging to stop retries");
    return new Response(JSON.stringify({ received: true, error: "stripe_key_not_configured" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
  );

  const body = await req.text();
  let event: Stripe.Event;

  if (!webhookSecret) {
    console.error("🚨 [STRIPE-WEBHOOK] ALERT: STRIPE_WEBHOOK_SECRET is not configured — acknowledging 200 to stop retries");
    return new Response(JSON.stringify({ received: true, error: "webhook_secret_not_configured" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    console.error("🚨 [STRIPE-WEBHOOK] ALERT: No stripe-signature header on request — acknowledging 200 to stop retries");
    return new Response(JSON.stringify({ received: true, error: "missing_signature_header" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    // Loud, easy-to-find log line so you can spot signature mismatches in Supabase logs
    console.error("🚨 [STRIPE-WEBHOOK] SIGNATURE VERIFICATION FAILED 🚨");
    console.error(`[STRIPE-WEBHOOK] Error: ${String(err)}`);
    console.error(`[STRIPE-WEBHOOK] Signature header (first 40 chars): ${sig.slice(0, 40)}...`);
    console.error(`[STRIPE-WEBHOOK] Webhook secret prefix: ${webhookSecret.slice(0, 8)}... (length: ${webhookSecret.length})`);
    console.error(`[STRIPE-WEBHOOK] Body length: ${body.length} bytes`);
    console.error("[STRIPE-WEBHOOK] → Returning 200 OK to stop Stripe retries. Fix the STRIPE_WEBHOOK_SECRET to match the endpoint that sent this event.");
    postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe webhook signature failed",
      message: "Stripe webhook signature verification failed — events are being acknowledged but not processed. Check `STRIPE_WEBHOOK_SECRET`.",
      fields: { Error: String(err).slice(0, 200), "Body bytes": body.length },
    });
    return new Response(JSON.stringify({ received: true, error: "signature_verification_failed" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  logStep("Event received", { type: event.type, id: event.id });

  // ---- Idempotency guard ----
  // Stripe retries webhooks on any non-2xx or timeout. Without this guard a
  // single checkout could grant a subscription twice or send duplicate emails.
  // We record whether WE were the one to insert the dedupe row, so that if the
  // handler later fails we can roll it back (below) and let Stripe's retry
  // re-process — without the rollback, the retry would hit this same dedupe
  // wall and 200-skip, permanently stranding a paid event.
  let idempotencyRecorded = false;
  try {
    const { error: idemErr } = await supabase
      .from("stripe_webhook_events")
      .insert({ event_id: event.id, event_type: event.type });
    if (idemErr) {
      // 23505 = unique_violation → we've seen this event before. Ack and exit.
      if ((idemErr as any).code === "23505") {
        logStep("Duplicate event — already processed, skipping", { id: event.id });
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      // Any other DB error: log but continue. Better to risk a duplicate than drop the event.
      console.error("[STRIPE-WEBHOOK] Idempotency insert failed (non-fatal):", idemErr);
    } else {
      idempotencyRecorded = true;
    }
  } catch (e) {
    console.error("[STRIPE-WEBHOOK] Idempotency check threw (non-fatal):", e);
  }

  // Roll back the idempotency row we inserted above so Stripe's retry
  // re-processes this event instead of hitting the dedupe wall and 200-skipping
  // (which would strand a paid event — subscription grant, escrow funding,
  // credit mint — un-applied forever). Mirrors verification-webhook's
  // rollbackIdempotency(). No-op when we didn't insert the row ourselves.
  const rollbackIdempotency = async () => {
    if (!idempotencyRecorded) return;
    const { error: delErr } = await supabase
      .from("stripe_webhook_events")
      .delete()
      .eq("event_id", event.id);
    if (delErr) {
      // If the rollback delete itself fails, the dedupe row survives — so
      // Stripe's 500-triggered retry will hit the wall and 200-skip, silently
      // re-stranding the paid event (the exact failure this whole guard exists
      // to prevent). A console line alone is invisible, so page ops.
      console.error("[STRIPE-WEBHOOK] Failed to roll back idempotency row:", delErr);
      postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Stripe webhook idempotency rollback FAILED — event may be stranded",
        message: `Could not delete stripe_webhook_events row for \`${event?.type || "unknown"}\`; the retry will dedupe-skip and drop this paid event. Manual replay needed.`,
        fields: { "Event ID": event?.id || "—", Error: String(delErr).slice(0, 200) },
      });
    }
  };

  try {
    const ctx: WebhookContext = { stripe, supabase, logStep };
    const handler = EVENT_HANDLERS[event.type];
    if (handler) {
      await handler(event, ctx);
    } else {
      logStep("Unhandled event type", { type: event.type });
    }
  } catch (err) {
    logStep("ERROR processing event", { error: String(err) });
    // Roll back the dedupe row and return a non-2xx so Stripe REDELIVERS this
    // event. A transient DB/handler failure must not permanently lose a paid
    // event — the retry re-runs the (idempotent) handler once the fault clears.
    await rollbackIdempotency();
    postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe webhook processing error",
      message: `Failed to process Stripe event \`${event?.type || "unknown"}\` — asking Stripe to retry.`,
      fields: { "Event ID": event?.id || "—", Error: String(err).slice(0, 200) },
    });
    return new Response(JSON.stringify({ received: false, error: "processing_error" }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});
