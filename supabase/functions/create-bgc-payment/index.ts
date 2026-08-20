import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { BGC_FEE_CENTS } from "../_shared/productPrices.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * The purchase is OFF while the screening provider has no accounts.
 *
 * This function charges LIVE MONEY. Its counterpart, `verification-webhook`,
 * 401s without CHECKR_WEBHOOK_SECRET / CERTIFICIAL_WEBHOOK_SECRET — so a
 * helper can be charged for a check whose RESULT can never be recorded, and
 * they sit at "in progress" forever with no badge and no refund path.
 *
 * This is the ENFORCEMENT point, not the card in the app. The card hides the
 * button (BackgroundCheckCard), but an edge function is callable directly with
 * any signed-in token, so hiding a button stops nobody who has already seen
 * the endpoint. Flip both to `true` together when the provider accounts exist.
 *
 * The rest of the function is untouched: pricing, Stripe session, metadata and
 * the success path all stay, so this is a switch, not a removal.
 *
 * NOTE: `verification-webhook` ALSO serves Stripe Identity via
 * STRIPE_IDV_WEBHOOK_SECRET, which works and is unaffected. Nothing here
 * touches the IDV path.
 */
const BGC_PURCHASE_ENABLED = false;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!BGC_PURCHASE_ENABLED) {
    // 503, not 403: this is "temporarily unavailable", which is exactly what
    // it is, and it is the status a client should never treat as the user's
    // fault. The message is the one the helper reads.
    return new Response(
      JSON.stringify({
        error: "Background checks are paused right now — we're switching screening providers. Nothing has been charged.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
    );
  }

  // Same Stripe-cost + abuse logic as create-boost-payment.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 5,
    keyPrefix: "create-bgc-payment",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
  );

  // Expected, user-facing failures must return their own status + message so
  // the client can show the real reason instead of a generic non-2xx error.
  const fail = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Please sign in to start a background check.");
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) return fail(401, "Your session expired — sign in again to continue.");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    // Don't let a helper pay twice. Block if a check is already in progress or
    // already passed.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("background_check_status")
      .eq("user_id", user.id)
      .maybeSingle();

    // A dropped error here defaults bgcStatus to "none" and lets the checkout
    // proceed even when the user may be "pending" or "verified" — bypassing the
    // duplicate-payment guards below on a transient DB read failure.
    if (profileErr) {
      return fail(500, "Could not verify your account status. Please try again in a moment.");
    }
    const bgcStatus = (profile?.background_check_status ?? "none") as string;
    if (bgcStatus === "pending") {
      return fail(409, "Your background check is already in progress.");
    }
    if (bgcStatus === "verified") {
      return fail(409, "You're already background-checked.");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "Background check verification",
            description:
              "One-time background screening to earn your Background-Checked badge on Helpr.",
            // Platform service — not subject to LA sales tax.
            tax_code: "txcd_00000000",
          },
          unit_amount: BGC_FEE_CENTS,
        },
        quantity: 1,
      }],
      mode: "payment",
      automatic_tax: { enabled: true },
      payment_intent_data: {
        metadata: {
          kind: "background_check",
          user_id: user.id,
        },
      },
      success_url: `${getAppUrl()}/profile?bgc=success`,
      cancel_url: `${getAppUrl()}/profile?bgc=cancelled`,
      metadata: {
        kind: "background_check",
        user_id: user.id,
      },
    }, {
      idempotencyKey: `bgc:${user.id}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-bgc-payment] error:", error);
    return fail(500, "Something went wrong starting your background check. Please try again.");
  }
});
