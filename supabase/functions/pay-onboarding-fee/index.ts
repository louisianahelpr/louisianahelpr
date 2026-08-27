import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";

/**
 * Settle the one-time account setup fee EARLY, on its own.
 *
 * This is not a new charge and not a price change. It is the SAME $2 the
 * account already owes, which is otherwise collected at whichever of these
 * comes first:
 *
 *   - create-payment      adds it as a line item on the first job post
 *   - release-payout      deducts it from the first payout
 *   - process-scheduled-payouts   ditto, on the cron path
 *
 * Why a third door: the fee is normally taken out of a helper's first payout,
 * but identity verification — which the fee pays for — is what a helper needs
 * BEFORE anyone will hire them. So a helper with no earnings yet had no way to
 * settle it. This lets them, once, deliberately.
 *
 * THE "NEVER CHARGED TWICE" GUARANTEE IS LOAD-BEARING, and it is enforced the
 * same way the other three paths enforce it: the flag flip is a conditional
 * UPDATE (`.eq("onboarding_fee_paid", false)`) that exactly one writer can win,
 * and the loser's money is refunded. This function does NOT flip the flag —
 * checkoutSessionCompleted does, after capture, through that same claim. So:
 *
 *   - already paid       → refused here, before Stripe is ever called
 *   - paid concurrently  → the webhook's claim loses and auto-refunds the $2
 *
 * The Stripe idempotency key is per-user, so a double tap reuses one Checkout
 * Session rather than opening a second.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const fail = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 5,
    keyPrefix: "pay-onboarding-fee",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Please sign in first.");
    const { data: userData } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    const user = userData.user;
    if (!user?.email) return fail(401, "Your session expired — sign in again.");

    const rawBody = await req.json().catch(() => ({}));
    const isNative = isNativeRequest(rawBody);

    // Fail CLOSED on a read fault. A dropped error here would let someone who
    // has already paid be sent to Stripe to pay again — recoverable (the
    // webhook refunds it) but exactly the experience the guarantee promises
    // they will never have.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("onboarding_fee_paid")
      .eq("user_id", user.id)
      .single();
    if (profileErr) {
      console.error("[pay-onboarding-fee] profile read failed:", profileErr.message);
      return fail(503, "We couldn't check your account just now. Please try again.");
    }
    if (profile?.onboarding_fee_paid) {
      // Not an error state to the user — it is the good news.
      return new Response(JSON.stringify({ alreadyPaid: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // The amount is read from platform_settings, never from a client-side
    // constant, so all four collection paths quote the same number.
    const { data: settings, error: settingsErr } = await supabaseAdmin
      .from("platform_settings")
      .select("onboarding_fee_cents")
      .limit(1)
      .maybeSingle();
    if (settingsErr) {
      console.error("[pay-onboarding-fee] settings read failed:", settingsErr.message);
      return fail(503, "We couldn't load the fee amount just now. Please try again.");
    }
    const feeCents = Number(settings?.onboarding_fee_cents ?? 0);
    if (!Number.isFinite(feeCents) || feeCents <= 0) {
      // A zero fee means the platform isn't charging one; nothing to settle.
      return fail(409, "There's no setup fee to pay on your account.");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const metadata = {
      kind: "onboarding_fee",
      customer_id: user.id,
      // Reuses the SAME two keys the first-job-post path stamps, so the
      // webhook's existing claim-or-refund branch handles this session with no
      // second implementation of the guarantee.
      onboarding_fee_charged: "true",
      onboarding_fee_cents: String(feeCents),
    };

    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        customer_email: customerId ? undefined : user.email,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "One-time account setup",
                description:
                  "One-time identity verification & account setup fee. Charged once per account.",
                tax_code: "txcd_00000000",
              },
              unit_amount: feeCents,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        payment_intent_data: { metadata },
        success_url: buildRedirectUrl("/profile?tab=payment&setup_fee=paid", isNative),
        cancel_url: buildRedirectUrl("/profile?tab=payment", isNative),
        metadata,
      },
      // Per user, not per attempt: a double tap reopens the same session
      // instead of creating a second chargeable one.
      { idempotencyKey: `onboarding-fee:${user.id}` },
    );

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[pay-onboarding-fee] error:", error);
    return fail(500, "Something went wrong starting that payment. Please try again.");
  }
});
