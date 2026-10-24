/**
 * paypal-webhook: PayPal's event deliveries (PayPal Plan A, phase 1).
 *
 * PHASE 1 STORES, IT DOES NOT MOVE MONEY. A delivery is verified (fail closed,
 * _shared/payments/paypalWebhookVerify.ts) and only then written to
 * public.paypal_webhook_events (event id = primary key, so PayPal's
 * redeliveries are no-ops). Acting on events (capture completed, payout
 * unclaimed, dispute opened) arrives with the phases that own those flows, and
 * will re-read each resource from PayPal rather than trust the event body.
 *
 * Answers:
 *   200  verified and stored (or already stored)
 *   400  not from PayPal: missing headers, foreign cert URL, signature refused.
 *        Nothing is stored.
 *   503  we cannot decide now (not configured, PayPal unreachable, DB write
 *        failed): PayPal redelivers, up to 25 times over 3 days (DOCS).
 *
 * No user calls this (verify_jwt = false in config.toml), so there is no
 * feature-switch check here: PayPal only sends events for objects we created,
 * and those can only be created for members the paypal_payments switch is on
 * for (the database refuses the rest: paypal_entry_requires_switch).
 *
 * Secrets: PAYPAL_ENV (sandbox only in this build), PAYPAL_CLIENT_ID,
 * PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID. The secret is never logged.
 */
import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { PayPalClient } from "../_shared/payments/paypalClient.ts";
import { parseProviderEnv } from "../_shared/payments/registry.ts";
import { isAllowedCertUrl, verifyPayPalWebhook } from "../_shared/payments/paypalWebhookVerify.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const MAX_BODY_BYTES = 256 * 1024;

async function notConfigured(reason: string): Promise<Response> {
  console.error(`[paypal-webhook] not configured: ${reason} — refusing (503) so PayPal redelivers`);
  await postSlackOpsAlert({
    kind: "custom",
    severity: "warning",
    title: "PayPal webhook not configured",
    message: `paypal-webhook refused a delivery (503, PayPal will retry): ${reason}. Set the PAYPAL_* edge function secrets.`,
    oncePerDayKey: `paypal-webhook-not-configured:${reason.slice(0, 40)}`,
  });
  return json(503, { error: "not_configured" });
}

serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let env: "sandbox" | "live";
  let client: PayPalClient;
  const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID") ?? "";
  try {
    env = parseProviderEnv(Deno.env.get("PAYPAL_ENV"));
    client = new PayPalClient({
      env,
      clientId: Deno.env.get("PAYPAL_CLIENT_ID") ?? "",
      clientSecret: Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "",
    });
  } catch (e) {
    return await notConfigured(caughtMessage(e));
  }
  if (!webhookId) return await notConfigured("PAYPAL_WEBHOOK_ID unset");

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) return json(413, { error: "too_large" });
  let rawBody: string;
  try {
    // ignoreBOM keeps a leading byte-order mark, so the string re-encodes to exactly the bytes
    // PayPal signed (crc32) and is posted back byte for byte.
    rawBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    // Not UTF-8: PayPal sends JSON, so this sender is not PayPal.
    return json(400, { error: "body_not_utf8" });
  }

  const outcome = await verifyPayPalWebhook(req.headers, rawBody, {
    client,
    env,
    webhookId,
    fetchCert: async (url) => {
      if (!isAllowedCertUrl(url, env)) throw new Error("cert url not allowed");
      const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`cert fetch ${r.status}`);
      return await r.text();
    },
  });
  if (!outcome.ok) {
    if (outcome.final) {
      // A forgery, or OUR misconfiguration (wrong PAYPAL_WEBHOOK_ID makes every real event FAILURE).
      // Either needs a human; once a day per reason so a flood cannot spam the channel.
      console.warn(`[paypal-webhook] refused (400): ${outcome.reason}`);
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "PayPal webhook refused a delivery",
        message: `paypal-webhook answered 400 (${outcome.reason}). If real PayPal events are being refused, check PAYPAL_WEBHOOK_ID and PAYPAL_ENV; PayPal stops retrying after 3 days.`,
        oncePerDayKey: `paypal-webhook-refused:${outcome.reason.slice(0, 40)}`,
      });
      return json(400, { error: "signature_refused" });
    }
    console.error(`[paypal-webhook] could not verify (503): ${outcome.reason}`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "PayPal webhook cannot verify deliveries",
      message: `paypal-webhook answered 503 (${outcome.reason.slice(0, 300)}). PayPal redelivers for 3 days, then the events are lost.`,
      oncePerDayKey: `paypal-webhook-verify-unavailable:${outcome.reason.slice(0, 24)}`,
    });
    return json(503, { error: "verification_unavailable" });
  }

  // Verified: only now is the body trusted enough to read and store.
  const event = JSON.parse(rawBody) as {
    id?: unknown; event_type?: unknown; resource_type?: unknown; resource?: { id?: unknown };
  };
  if (typeof event.id !== "string" || typeof event.event_type !== "string") {
    console.error("[paypal-webhook] verified body has no id/event_type; refusing (400)");
    return json(400, { error: "event_shape" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return await notConfigured("SUPABASE_URL or service key unset");
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: stored, error } = await supabase.from("paypal_webhook_events").upsert(
    {
      event_id: event.id,
      event_type: event.event_type,
      resource_type: typeof event.resource_type === "string" ? event.resource_type : null,
      resource_id: typeof event.resource?.id === "string" ? event.resource.id : null,
      env,
      payload: event,
    },
    { onConflict: "event_id", ignoreDuplicates: true },
  ).select("event_id");
  if (error) {
    // Not stored: answer 503 so PayPal redelivers instead of losing the event.
    console.error(`[paypal-webhook] store failed for ${event.id}: ${error.message}`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "PayPal webhook event not stored",
      message: `paypal_webhook_events insert failed for ${event.event_type} ${event.id}: ${error.message}. PayPal will redeliver (503).`,
      // Per event type and error code: PayPal redelivers each event, so one alert a day per kind of failure is enough.
      oncePerDayKey: `paypal-webhook-store:${event.event_type}:${error.code ?? "x"}`,
    });
    return json(503, { error: "store_failed" });
  }
  // Zero rows back = the event id was already stored (a redelivery): a no-op, said as such. The
  // stored copy must be from the same environment: a sandbox event id reappearing under live (or
  // the reverse) means crossed configuration, and the live event would otherwise be dropped.
  const fresh = Array.isArray(stored) && stored.length > 0;
  if (!fresh) {
    const { data: prior, error: readErr } = await supabase.from("paypal_webhook_events").select("env").eq("event_id", event.id).maybeSingle();
    if (readErr || !prior || prior.env !== env) {
      const why = readErr ? readErr.message : !prior ? "row not found after a conflict" : `stored as ${prior.env}, received as ${env}`;
      console.error(`[paypal-webhook] duplicate ${event.id} does not match the stored copy: ${why}`);
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "PayPal webhook event id clash",
        message: `paypal-webhook received ${event.event_type} ${event.id} that is already stored but does not match (${why}). Check PAYPAL_ENV and the webhook subscriptions, then resend the event from the PayPal developer dashboard (PayPal stops retrying after 3 days).`,
        oncePerDayKey: `paypal-webhook-clash:${event.event_type}`,
      });
      return json(503, { error: "event_clash" });
    }
  }
  console.log(`[paypal-webhook] ${fresh ? "stored" : "already stored"} ${event.event_type} ${event.id} (verified via ${outcome.via})`);
  return json(200, { received: true });
});
