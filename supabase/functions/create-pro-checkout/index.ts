import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// billing_cycle: "monthly" | "annual" | "one_time"
const PRICE_MAP: Record<string, Record<string, string>> = {
  monthly: {
    basic: "price_1T9wfJKp2H4b7tEC4w8zbfui",
    pro: "price_1T9vO7Kp2H4b7tECC6KCaygf",
    elite: "price_1T9wg7Kp2H4b7tECOdwba00D",
  },
  annual: {
    basic: "price_1T9xGzKp2H4b7tECCRjdEzLr",
    pro: "price_1T9xHSKp2H4b7tECv7EytnsS",
    elite: "price_1T9xHqKp2H4b7tECqBGeuvUW",
  },
  one_time: {
    basic: "price_1T9xIIKp2H4b7tECUav5CUEm",
    pro: "price_1T9xIjKp2H4b7tEC8jRz0yIi",
    elite: "price_1T9xJAKp2H4b7tEC04B2AFBg",
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
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
      success_url: `${req.headers.get("origin")}/profile?pro=success`,
      cancel_url: `${req.headers.get("origin")}/profile?pro=cancel`,
      metadata: { tier, billing_cycle },
    };

    if (!isOneTime && Object.keys(subscriptionData).length > 0) {
      sessionParams.subscription_data = subscriptionData;
    }

    // For one-time, store tier info in payment metadata so webhook can update profile
    if (isOneTime) {
      sessionParams.payment_intent_data = { metadata: { tier, billing_cycle: "one_time" } };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
