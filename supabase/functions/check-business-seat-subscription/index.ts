import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRODUCT_TO_TIER: Record<string, string> = {
  prod_UP8XCpifCuHO1y: "crew",
  prod_UP8Xdu0Z55uyyZ: "team",
  prod_UP8XIjp23K25YG: "enterprise",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError) throw new Error(userError.message);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");

    // Find the business this user owns (or has any active membership in)
    const { data: ownedBiz } = await supabaseAdmin
      .from("businesses")
      .select("id, owner_id, seat_tier")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!ownedBiz) {
      return new Response(
        JSON.stringify({ subscribed: false, tier: "starter", seat_limit: 2 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    let activeTier: "starter" | "crew" | "team" | "enterprise" = "starter";
    let subscriptionId: string | null = null;
    let subscriptionStatus: string | null = null;
    let periodEnd: string | null = null;

    if (customers.data.length > 0) {
      const customerId = customers.data[0].id;
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 20,
      });

      // Pick the highest-tier seat sub if multiple (shouldn't happen, but safe)
      const tierRank: Record<string, number> = { starter: 0, crew: 1, team: 2, enterprise: 3 };
      for (const sub of subscriptions.data) {
        // Only look at subs flagged as business_seats AND for this business
        const meta = (sub.metadata || {}) as Record<string, string>;
        if (meta.kind !== "business_seats" || meta.business_id !== ownedBiz.id) continue;

        const productId = sub.items.data[0]?.price.product as string;
        const t = PRODUCT_TO_TIER[productId];
        if (!t) continue;

        if (tierRank[t] > tierRank[activeTier]) {
          activeTier = t as typeof activeTier;
          subscriptionId = sub.id;
          subscriptionStatus = sub.status;
          periodEnd = new Date(sub.current_period_end * 1000).toISOString();
        }
      }
    }

    // Sync to DB
    await supabaseAdmin
      .from("businesses")
      .update({
        seat_tier: activeTier,
        seat_subscription_id: subscriptionId,
        seat_subscription_status: subscriptionStatus,
        seat_subscription_current_period_end: periodEnd,
      })
      .eq("id", ownedBiz.id);

    const seatLimit =
      activeTier === "enterprise" ? 15 :
      activeTier === "team" ? 10 :
      activeTier === "crew" ? 5 : 2;

    return new Response(
      JSON.stringify({
        subscribed: activeTier !== "starter",
        tier: activeTier,
        seat_limit: seatLimit,
        subscription_end: periodEnd,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
