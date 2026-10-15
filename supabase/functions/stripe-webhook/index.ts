import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import {
  describeUnverifiedDelivery,
  signatureFailureAlert,
  stripeKeyMode,
  webhookRejectResponse,
} from "../_shared/stripeWebhookReject.ts";
import { logStep, type WebhookContext } from "./context.ts";
import {
  StripeModeRefused,
  stripeSecretKeyFor,
  isRoutedTestCheckout,
  testEventScope,
  testGiftIsTestToTest,
  TEST_WEBHOOK_SECRET_ENV,
} from "../_shared/stripeMode.ts";
import { handleCheckoutSessionCompleted } from "./handlers/checkoutSessionCompleted.ts";
import { handleCheckoutSessionExpired } from "./handlers/checkoutSessionExpired.ts";
import { handleCustomerSubscriptionUpdated } from "./handlers/customerSubscriptionUpdated.ts";
import { handleCustomerSubscriptionDeleted } from "./handlers/customerSubscriptionDeleted.ts";
import { handlePaymentIntentPaymentFailed } from "./handlers/paymentIntentPaymentFailed.ts";
import { handleChargeRefunded } from "./handlers/chargeRefunded.ts";
import { handleChargeRefundUpdated } from "./handlers/chargeRefundUpdated.ts";
import { handleChargeDisputeCreated, handleChargeDisputeFundsWithdrawn } from "./handlers/chargeDisputeCreated.ts";
import { handleChargeDisputeClosed } from "./handlers/chargeDisputeClosed.ts";
import { handleAccountUpdated } from "./handlers/accountUpdated.ts";
import { handlePaymentIntentSucceeded } from "./handlers/paymentIntentSucceeded.ts";
import { handleTransferCreated } from "./handlers/transferCreated.ts";
import { handleTransferFailed } from "./handlers/transferFailed.ts";
import { handleTransferReversed } from "./handlers/transferReversed.ts";
import { handleTransferCanceled } from "./handlers/transferCanceled.ts";

// The event types a TEST-mode endpoint event may run (owner 2026-10-12, test
// mode for test accounts): what the routed checkout, payout, refund, dispute
// and Connect flows produce. Anything else from the test endpoint is
// acknowledged and not applied.
const TEST_MODE_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.refund.updated",
  "charge.dispute.created",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.closed",
  "transfer.created",
  "transfer.failed",
  "transfer.reversed",
  "transfer.canceled",
  "account.updated",
]);

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
  // Q1325 (a): a booked refund that later fails or is canceled.
  "charge.refund.updated": handleChargeRefundUpdated,
  "charge.dispute.created": handleChargeDisputeCreated,
  // Q202: an inquiry the bank escalates into a chargeback withdraws the money
  // here, after charge.dispute.created has already been and gone.
  "charge.dispute.funds_withdrawn": handleChargeDisputeFundsWithdrawn,
  "charge.dispute.closed": handleChargeDisputeClosed,
  "account.updated": handleAccountUpdated,
  "payment_intent.succeeded": handlePaymentIntentSucceeded,
  "transfer.created": handleTransferCreated,
  "transfer.failed": handleTransferFailed,
  "transfer.reversed": handleTransferReversed,
  "transfer.canceled": handleTransferCanceled,
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
    console.log(`[STRIPE-WEBHOOK] 🔐 Webhook secret loaded (length: ${webhookSecret.length})`);
  }

  if (!stripeKey) {
    // Refused, not acknowledged: see _shared/stripeWebhookReject.ts (Q156). A
    // 500 keeps every event alive in Stripe's retry queue until the key is set.
    console.error("🚨 [STRIPE-WEBHOOK] ALERT: STRIPE_SECRET_KEY not set — refusing (500) so Stripe retries");
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe webhook misconfigured — STRIPE_SECRET_KEY not set",
      message: "STRIPE_SECRET_KEY is missing from edge function secrets. Every Stripe webhook event is refused (500) and retried by Stripe, NOT processed. Payments, subscriptions, and payouts are broken until this is fixed.",
    });
    return webhookRejectResponse("stripe_key_not_configured");
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
  );

  const body = await req.text();
  let event: Stripe.Event;

  if (!webhookSecret) {
    console.error("🚨 [STRIPE-WEBHOOK] ALERT: STRIPE_WEBHOOK_SECRET is not configured — refusing (500) so Stripe retries");
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe webhook misconfigured — STRIPE_WEBHOOK_SECRET not set",
      message: "STRIPE_WEBHOOK_SECRET is missing from edge function secrets. Every Stripe webhook event is refused (500) and retried by Stripe, NOT processed. Payments, subscriptions, and payouts are broken until this is fixed.",
    });
    return webhookRejectResponse("webhook_secret_not_configured");
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    // Stripe signs every delivery, so this caller is not Stripe: refuse it.
    console.error("🚨 [STRIPE-WEBHOOK] No stripe-signature header on request — refusing (400)");
    return webhookRejectResponse("missing_signature_header");
  }

  // Stripe issues a SEPARATE signing secret per endpoint object, and this
  // project has more than one endpoint pointed at this same function URL
  // (the account endpoint and the Connect endpoint). Verifying against a
  // single secret therefore cannot work: whichever endpoint's secret is not
  // in the env fails signature verification 100% of the time. (That used to
  // be silent as well: the failure answered 200, so Stripe never complained.
  // It now answers 400 and alerts; see the catch below.)
  //
  // So STRIPE_WEBHOOK_SECRET accepts a COMMA-SEPARATED list and each secret
  // is tried in turn. One secret is still perfectly valid input — a list of
  // one is the degenerate case, so existing single-endpoint setups are
  // unaffected.
  const webhookSecrets = webhookSecret
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // TEST-mode endpoint (owner 2026-10-12, test mode for test accounts): its
  // own signing secret(s), tried only after every live secret has missed. An
  // event verified by one of these is a TEST-mode event, whatever it claims.
  const testWebhookSecrets = (Deno.env.get(TEST_WEBHOOK_SECRET_ENV) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let verifiedByTestSecret = false;

  // Returns the event or throws — keeping the single-expression `try` below
  // means `event` stays definitely-assigned for the compiler, which a bare
  // for-loop assignment would not.
  const verifyAgainstAny = async (): Promise<Stripe.Event> => {
    let lastErr: unknown = new Error("STRIPE_WEBHOOK_SECRET contained no usable secret");
    for (const secret of webhookSecrets) {
      try {
        return await stripe.webhooks.constructEventAsync(body, sig, secret);
      } catch (e) {
        // Expected when this event came from the OTHER endpoint. Only the
        // last failure is surfaced; a miss here is not itself an error.
        lastErr = e;
      }
    }
    for (const secret of testWebhookSecrets) {
      try {
        const testEvent = await stripe.webhooks.constructEventAsync(body, sig, secret);
        verifiedByTestSecret = true;
        return testEvent;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };

  try {
    event = await verifyAgainstAny();
  } catch (err) {
    // REFUSED, never acknowledged (docs/OPEN.md Q156). This used to answer 200
    // "to stop Stripe retries", which told Stripe the event was delivered: on
    // 2026-09-23 12:43:27Z one real Stripe delivery was dropped that way, with
    // no retry and a success in Stripe's dashboard. A 400 makes Stripe retry on
    // its bounded schedule (one retry sequence per event, so no storm), shows
    // the failure in its dashboard, and lets a fixed secret recover the event.
    // Policy and trade-offs: _shared/stripeWebhookReject.ts.
    const delivery = describeUnverifiedDelivery(body, sig);
    console.error("🚨 [STRIPE-WEBHOOK] SIGNATURE VERIFICATION FAILED 🚨");
    console.error(`[STRIPE-WEBHOOK] Error: ${String(err)}`);
    console.error(`[STRIPE-WEBHOOK] Signature schemes: ${delivery.schemes.join(",") || "none"} (Stripe adds v0 only to TEST-mode events)`);
    console.error(`[STRIPE-WEBHOOK] Claimed (UNVERIFIED) event: ${delivery.claimedId ?? "none"} type=${delivery.claimedType ?? "none"} livemode=${delivery.claimedLivemode}`);
    console.error(`[STRIPE-WEBHOOK] Tried ${webhookSecrets.length} live secret(s), lengths: ${webhookSecrets.map((s) => s.length).join(", ")}; ${testWebhookSecrets.length} test secret(s)`);
    console.error(`[STRIPE-WEBHOOK] Body length: ${delivery.bodyBytes} bytes`);
    console.error("[STRIPE-WEBHOOK] → Refusing (400) so Stripe retries. Add the sending endpoint's signing secret to STRIPE_WEBHOOK_SECRET (comma-separate multiple endpoints).");
    await postSlackOpsAlert(
      signatureFailureAlert({
        fn: "stripe-webhook",
        title: "Stripe webhook signature failed",
        secretEnv: "STRIPE_WEBHOOK_SECRET",
        keyMode: stripeKeyMode(stripeKey),
        err,
        delivery,
      }),
    );
    return webhookRejectResponse("signature_verification_failed");
  }

  logStep("Event received", { type: event.type, id: event.id, via: verifiedByTestSecret ? "test_endpoint" : "live_endpoint" });

  // ---- TEST-mode events (owner 2026-10-12, test mode for test accounts) ----
  // Signed by the TEST endpoint's secret, so it can only be a sandbox event:
  //   - it must say livemode=false (a live event signed by the test secret is
  //     impossible; refuse it rather than guess);
  //   - it runs on the TEST key, never the live one (a missing or non-test
  //     STRIPE_TEST_SECRET_KEY refuses 500, so Stripe retries once it is set);
  //   - it may only touch test accounts: an event whose metadata names a real
  //     person or a real person's job is acknowledged and NOT processed, with
  //     an alert (a retry would never change the answer).
  // A live-verified event takes the unchanged path below.
  let handlerStripe: Stripe = stripe;
  if (verifiedByTestSecret) {
    if (event.livemode !== false) {
      console.error(`[STRIPE-WEBHOOK] event ${event.id} verified by the TEST endpoint secret but livemode=${String(event.livemode)}; refusing`);
      return webhookRejectResponse("livemode_mismatch");
    }
    try {
      handlerStripe = new Stripe(stripeSecretKeyFor("test"), { apiVersion: "2025-08-27.basil" });
      // Only the event types the test-mode flows produce. Pro subscriptions
      // (customer.subscription.*) stay live-only (Q1751), and their handlers
      // fall back to matching a person by EMAIL, so a sandbox renewal could
      // otherwise grant or revoke a real person's Pro (lh-money-escrow review
      // 2026-10-12, finding 4).
      if (!TEST_MODE_EVENT_TYPES.has(event.type)) {
        console.log(JSON.stringify({ event: "stripe_test_event_type_not_routed", event_id: event.id, event_type: event.type }));
        return new Response(JSON.stringify({ received: true, ignored: "test_event_type_not_routed" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      const eventObject = (event.data as { object?: unknown } | undefined)?.object;
      // A test-mode checkout is applied only when a mode-routed function
      // created it. Pro checkout stays live-only: its branch grants by email,
      // so a sandbox session must never reach it (lh-authz-rls review of the
      // rebuild, finding 1). A gift card is routed (Q1750) but credits a
      // recipient EMAIL, so it also needs testGiftIsTestToTest below.
      if (event.type.startsWith("checkout.session.") && !isRoutedTestCheckout(eventObject)) {
        console.error(JSON.stringify({ event: "stripe_test_checkout_not_routed", event_id: event.id, event_type: event.type }));
        return new Response(JSON.stringify({ received: true, ignored: "test_checkout_not_routed" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      const scope = await testEventScope(supabase, eventObject);
      // A Connect account update for an account no profile holds names nobody
      // and changes nothing; one held by a real profile is refused below.
      if (!scope.ok) {
        console.error(JSON.stringify({ event: "stripe_test_event_names_real_account", event_id: event.id, event_type: event.type, people: scope.people, real: scope.real }));
        await postSlackOpsAlert({
          kind: "stripe_webhook_error",
          severity: "warning",
          title: "Stripe TEST-mode event names a real account: not processed",
          message: `\`${event.type}\` (${event.id}) came from the test-mode endpoint but names ${scope.real} real account(s). Test mode is for test accounts only, so it was acknowledged and NOT applied.`,
          fields: { "Event ID": event.id },
          oncePerDayKey: `stripe-test-event-real-account-${event.type}`,
        });
        return new Response(JSON.stringify({ received: true, ignored: "test_event_names_real_account" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      // Q1750: sandbox gift credit goes from a test account to a test account
      // only; a recipient email with no account, or a real one, is not applied.
      if (event.type.startsWith("checkout.session.") && !(await testGiftIsTestToTest(supabase, eventObject))) {
        console.error(JSON.stringify({ event: "stripe_test_gift_not_test_to_test", event_id: event.id, event_type: event.type }));
        await postSlackOpsAlert({
          kind: "stripe_webhook_error",
          severity: "warning",
          title: "Stripe TEST-mode gift card is not test-to-test: not processed",
          message: `\`${event.type}\` (${event.id}) is a test-mode gift card whose donor or recipient is not a test account. It was acknowledged and NOT applied.`,
          fields: { "Event ID": event.id },
          oncePerDayKey: `stripe-test-gift-not-test-to-test-${event.type}`,
        });
        return new Response(JSON.stringify({ received: true, ignored: "test_gift_not_test_to_test" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    } catch (modeErr) {
      if (!(modeErr instanceof StripeModeRefused)) throw modeErr;
      console.error(JSON.stringify({ event: "stripe_mode_refused", fn: "stripe-webhook", reason: modeErr.reason, detail: modeErr.message, event_id: event.id }));
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Stripe TEST-mode event refused (500) — test mode misconfigured",
        message: `\`${event.type}\` (${event.id}) from the test-mode endpoint could not run: ${modeErr.reason}. Stripe retries it once this is fixed.`,
        fields: { "Event ID": event.id },
        oncePerDayKey: `stripe-webhook-test-mode-${modeErr.reason}`,
      });
      return new Response(JSON.stringify({ received: false, error: "stripe_test_mode_unavailable" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }
  }

  // ---- Key mode vs event mode (Q891 item 4) ----
  // A correctly signed event can still belong to the other Stripe mode: a
  // test-mode endpoint left pointed at this function, or a live endpoint
  // reaching a function whose key is a test key. Nothing below tells the two
  // apart (every handler reads the same tables), so a mismatch is decided HERE,
  // before the dedupe row is written or any handler runs. ONE direction each:
  //   LIVE key, TEST event: sandbox data with no real money behind it. Ack 200
  //     (a retry can never change the answer), process nothing, no alert.
  //   TEST key, LIVE event: a REAL payment this deploy cannot read. Refuse 400
  //     so Stripe retries once the key is fixed, and page (once a day).
  // An event with no boolean livemode, or a key with an unknown prefix, is not
  // judged: it takes the old path.
  const keyMode = stripeKeyMode(stripeKey);
  const eventMode = typeof event.livemode === "boolean" ? (event.livemode ? "LIVE" : "TEST") : "UNKNOWN";
  if (!verifiedByTestSecret && keyMode !== "UNKNOWN" && eventMode !== "UNKNOWN" && keyMode !== eventMode) {
    console.log(JSON.stringify({
      event: "stripe_webhook_livemode_mismatch", fn: "stripe-webhook",
      key_mode: keyMode, event_mode: eventMode, event_id: event.id, event_type: event.type,
    }));
    if (keyMode === "LIVE") {
      return new Response(JSON.stringify({ received: true, ignored: "livemode_mismatch" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe webhook got a LIVE event but runs a TEST key",
      message: `\`${event.type}\` (${event.id}) is a live-mode event and STRIPE_SECRET_KEY is a test key. It was refused (400), NOT processed; Stripe retries it. Set the live key.`,
      fields: { "Event ID": event.id },
      oncePerDayKey: "stripe-webhook-live-event-test-key",
    });
    return webhookRejectResponse("livemode_mismatch");
  }

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
      // Any other DB error (not a duplicate): the dedupe table is unhealthy.
      // Processing now WITHOUT a dedupe record means a later Stripe retry can't
      // be recognized as a duplicate and would re-apply the event. Fail closed
      // instead — 500 so Stripe retries once the DB recovers, at which point the
      // insert succeeds and we get a real dedupe record. A transient DB blip is
      // safer to retry than to process un-deduped.
      console.error("[STRIPE-WEBHOOK] Idempotency insert failed — asking Stripe to retry:", idemErr);
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Stripe webhook idempotency insert failed",
        message: `Could not record dedupe row for \`${event.type}\` (DB error, not a duplicate) — returning 500 so Stripe retries rather than processing un-deduped.`,
        fields: { "Event ID": event.id, Error: String((idemErr as any)?.message ?? idemErr).slice(0, 200) },
      });
      return new Response(JSON.stringify({ received: false, error: "idempotency_insert_failed" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    } else {
      idempotencyRecorded = true;
    }
  } catch (e) {
    // The insert threw (network/client error, not a returned DB error). Same
    // reasoning as above: without a dedupe record we can't safely process, so
    // fail closed and let Stripe retry.
    console.error("[STRIPE-WEBHOOK] Idempotency check threw — asking Stripe to retry:", e);
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Stripe webhook idempotency check threw",
      message: `Dedupe insert threw for \`${event.type}\` — returning 500 so Stripe retries rather than processing un-deduped.`,
      fields: { "Event ID": event.id, Error: String(e).slice(0, 200) },
    });
    return new Response(JSON.stringify({ received: false, error: "idempotency_check_threw" }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }

  // Roll back the idempotency row we inserted above so Stripe's retry
  // re-processes this event instead of hitting the dedupe wall and 200-skipping
  // (which would strand a paid event — subscription grant, escrow funding,
  // credit mint — un-applied forever). Mirrors verification-webhook's
  // rollbackIdempotency(). No-op when we didn't insert the row ourselves.
  const rollbackIdempotency = async () => {
    if (!idempotencyRecorded) return;
    // `.select("event_id")` — NOT `.select("id")`. A DELETE matching zero rows
    // returns `{ data: [], error: null }`, so without a returning projection a
    // no-op rollback reads exactly like a successful one. `event_id` is this
    // table's primary key and there is no `id` column (verified against prod:
    // `?select=id` → 400), so asking for `id` would turn every rollback into a
    // hard 400 and a false critical page.
    const { data: rolledBack, error: delErr } = await supabase
      .from("stripe_webhook_events")
      .delete()
      .eq("event_id", event.id)
      .select("event_id");
    if (delErr) {
      // If the rollback delete itself fails, the dedupe row survives — so
      // Stripe's 500-triggered retry will hit the wall and 200-skip, silently
      // re-stranding the paid event (the exact failure this whole guard exists
      // to prevent). A console line alone is invisible, so page ops.
      console.error("[STRIPE-WEBHOOK] Failed to roll back idempotency row:", delErr);
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Stripe webhook idempotency rollback FAILED — event may be stranded",
        message: `Could not delete stripe_webhook_events row for \`${event?.type || "unknown"}\`; the retry will dedupe-skip and drop this paid event. Manual replay needed.`,
        fields: { "Event ID": event?.id || "—", Error: String(delErr).slice(0, 200) },
      });
      return;
    }

    // Zero rows deleted — not a benign race. `idempotencyRecorded` is only true
    // because THIS request inserted the row seconds ago; a concurrent delivery
    // of the same event.id would have hit 23505 and 200-skipped without ever
    // reaching this rollback; the only call site returns immediately after
    // awaiting; and `cleanup_stripe_webhook_events()` prunes at 30 days. So no
    // rows matched means the row is still there, Stripe's retry will
    // dedupe-skip, and a PAID event — subscription grant, escrow funding,
    // credit mint — is stranded un-applied. Same consequence as the delete
    // erroring, so the same page.
    if (!rolledBack || (rolledBack as unknown[]).length === 0) {
      console.error("[STRIPE-WEBHOOK] Idempotency rollback matched ZERO rows — dedupe row may survive:", event?.id);
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Stripe webhook idempotency rollback matched 0 rows — paid event may be stranded",
        message: `The rollback DELETE for \`${event?.type || "unknown"}\` reported no error but removed no row, even though this request inserted it moments ago. If the row survives, Stripe's retry will dedupe-skip and this paid event is dropped. Check \`stripe_webhook_events\` for this event id and delete it manually to allow redelivery.`,
        fields: { "Event ID": event?.id || "—" },
      });
    }
  };

  try {
    const ctx: WebhookContext = { stripe: handlerStripe, supabase, logStep };
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
    await postSlackOpsAlert({
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
