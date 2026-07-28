import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { BUSINESS_SEAT_TIER_TO_PRICE, BUSINESS_SEAT_TIER_TO_PRICE_ANNUAL } from "../_shared/businessSeatTiers.ts";

// tier -> Stripe Price ID (monthly recurring USD), derived from the single
// source of truth so the checkout can never drift from the displayed tiers.
// ⚠️ The referenced Stripe Price objects still charge the OLD amounts until a
// human updates them in the Stripe dashboard — see _shared/businessSeatTiers.ts.
const TIER_TO_PRICE: Record<string, string> = BUSINESS_SEAT_TIER_TO_PRICE;
const TIER_TO_PRICE_ANNUAL: Record<string, string | undefined> = BUSINESS_SEAT_TIER_TO_PRICE_ANNUAL;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError) throw new Error(userError.message);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");

    // `interval` is optional and defaults to monthly, so existing callers that
    // send only { tier } are unchanged.
    const { tier, interval = "month" } = await req.json();
    if (interval !== "month" && interval !== "year") {
      throw new Error('Invalid interval. Use: "month" or "year"');
    }

    // Resolved SEPARATELY per interval, and an unresolved annual Price is a
    // hard error — never a fall back to the monthly ID. Falling back would
    // charge $20 for what the UI just offered as a $200/yr plan and hand the
    // customer a monthly subscription they didn't choose. The annual Prices do
    // not exist yet (see stripePriceIdAnnual in _shared/businessSeatTiers.ts):
    // create three yearly Prices against the same products, then either paste
    // the IDs there or set STRIPE_PRICE_SEAT_<TIER>_ANNUAL.
    const priceId =
      interval === "year" ? TIER_TO_PRICE_ANNUAL[tier] : TIER_TO_PRICE[tier];

    if (!priceId) {
      if (interval === "year" && TIER_TO_PRICE[tier]) {
        throw new Error(
          `Annual billing isn't set up for the ${tier} seat plan yet. Choose monthly, or set STRIPE_PRICE_SEAT_${String(tier).toUpperCase()}_ANNUAL.`,
        );
      }
      throw new Error("Invalid tier. Use: crew, team, or enterprise");
    }

    // Verify user owns a business
    const { data: biz, error: bizErr } = await supabaseAdmin
      .from("businesses")
      .select("id, name, owner_id, seat_subscription_id")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (bizErr) throw new Error(bizErr.message);
    if (!biz) throw new Error("You do not own a business team");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Reuse existing customer if one exists for this email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${getAppUrl()}/business-team?seats=success`,
      cancel_url: `${getAppUrl()}/business-team?seats=cancel`,
      metadata: {
        kind: "business_seats",
        business_id: biz.id,
        tier,
        interval,
      },
      subscription_data: {
        metadata: {
          kind: "business_seats",
          business_id: biz.id,
          tier,
        },
      },
    }, {
      idempotencyKey: `bizseat:${user.id}:${tier}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-business-seat-checkout] error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
