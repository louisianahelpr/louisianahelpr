import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { PRO_PRICE_MAP } from "../_shared/proTiers.ts";

// billing_cycle: "monthly" | "annual" | "one_time". Price IDs derive from the
// single source of truth so the checkout can never drift from the displayed
// subscription tiers (guarded by src/lib/proTiers.parity.test.ts).
const PRICE_MAP = PRO_PRICE_MAP;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const { tier, billing_cycle = "monthly", billing_day } = await req.json();
    const cycle = PRICE_MAP[billing_cycle];
    if (!cycle) throw new Error("Invalid billing_cycle. Use: monthly, annual, or one_time");
    const priceId = cycle[tier];
    if (!priceId) throw new Error("Invalid tier. Use: basic, pro, or elite");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      if (billing_cycle !== "one_time") {
        const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 10 });
        if (subs.data.length > 0) {
          return new Response(JSON.stringify({ error: "You already have an active subscription. Manage it from the portal to switch tiers." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          });
        }
      }
    }

    const isOneTime = billing_cycle === "one_time";

    // Build subscription data with optional billing anchor day (only for recurring)
    const subscriptionData: Record<string, any> = {};
    if (!isOneTime && billing_day && billing_day >= 1 && billing_day <= 28) {
      subscriptionData.billing_cycle_anchor_config = { day_of_month: billing_day };
    }

    const sessionParams: any = {
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isOneTime ? "payment" : "subscription",
      success_url: `${getAppUrl()}/profile?pro=success`,
      cancel_url: `${getAppUrl()}/profile?pro=cancel`,
      metadata: { tier, billing_cycle },
      automatic_tax: { enabled: true },
    };

    if (!isOneTime && Object.keys(subscriptionData).length > 0) {
      sessionParams.subscription_data = subscriptionData;
    }

    // For one-time, store tier info in payment metadata so webhook can update profile
    if (isOneTime) {
      sessionParams.payment_intent_data = { metadata: { tier, billing_cycle: "one_time" } };
    }

    const session = await stripe.checkout.sessions.create(sessionParams, {
      // Include billing_cycle: the same user+tier at a different cycle
      // (monthly ↔ annual ↔ one_time) is a DIFFERENT priced checkout, so it must
      // not collide with a prior cycle's cached session inside Stripe's 24h key
      // window and replay the wrong amount.
      idempotencyKey: `pro:${user.id}:${tier}:${billing_cycle}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-pro-checkout] error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
