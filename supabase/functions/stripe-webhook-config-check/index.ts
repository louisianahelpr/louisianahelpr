// stripe-webhook-config-check — reads the LIVE Stripe webhook endpoint config
// for .github/workflows/stripe-webhook-guard.yml (issue #1586 class check, Q853).
//
// Service-role / cron callers only (verifyCronSecret, the same gate as
// marketing-token-health). Two GETs to Stripe (webhook_endpoints, and events
// with delivery_success=false for Q854), no writes of any kind. Returns per
// endpoint only {id, url, status, livemode, enabled_events}, `keyIsLive`, and
// `undelivered` {since, until, count, truncated, events: [{id, type}]}; never
// the key, a signing secret or an event payload (see ./shape.ts).
// Any Stripe or env error is a non-200, never an empty list or a zero count.

import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { serve } from "../_shared/buildStamp.ts";
import { readWebhookConfig } from "./shape.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const result = await readWebhookConfig(Deno.env.get("STRIPE_SECRET_KEY"), (i, n) => fetch(i, n));
  if (!result.ok) {
    console.error(`stripe-webhook-config-check: ${result.error}`);
    return errorResponse(result.error, result.status, corsHeaders);
  }
  return jsonResponse(result.body, 200, corsHeaders);
});
