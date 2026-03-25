import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRODUCT_TO_TIER: Record<string, string> = {
  // Monthly recurring
  "prod_U8rS2fR6KvQoRk": "basic",
  "prod_U8rTRJZSUyzaha": "pro",
  "prod_U8rTUX4EhN5wG3": "elite",
  // Annual recurring
  "prod_U8rTux09RGNWWd": "basic",
  "prod_U8rTiOIcITvnIT": "pro",
  "prod_U8rT5zWKWe29By": "elite",
  // One-time month pass
  "prod_U8rTPMHf6IQnGE": "basic",
  "prod_U8rThLQr2jThoM": "pro",
  "prod_U8rT0f4UtNPrrs": "elite",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError) throw new Error(userError.message);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Get current profile to check for one-time pass
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier, subscription_expires_at")
      .eq("user_id", user.id)
      .single();

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    // Check for active Stripe subscription first
    if (customers.data.length > 0) {
      const customerId = customers.data[0].id;
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 10,
      });

      for (const sub of subscriptions.data) {
        const productId = sub.items.data[0]?.price.product as string;
        const tier = PRODUCT_TO_TIER[productId];
        if (tier) {
          const expiresAt = new Date(sub.current_period_end * 1000).toISOString();
          await supabaseAdmin.from("profiles").update({
            subscription_tier: tier,
            subscription_expires_at: expiresAt,
          }).eq("user_id", user.id);

          return new Response(JSON.stringify({
            subscribed: true,
            tier,
            subscription_end: expiresAt,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
      }
    }

    // No active Stripe subscription — check if there's a valid one-time pass
    if (profile?.subscription_tier && profile?.subscription_expires_at) {
      const expiresAt = new Date(profile.subscription_expires_at);
      if (expiresAt > new Date()) {
        // One-time pass still valid — don't clear it
        return new Response(JSON.stringify({
          subscribed: true,
          tier: profile.subscription_tier,
          subscription_end: profile.subscription_expires_at,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    // No valid subscription or pass — clear tier
    await supabaseAdmin.from("profiles").update({
      subscription_tier: null,
      subscription_expires_at: null,
    }).eq("user_id", user.id);

    return new Response(JSON.stringify({ subscribed: false, tier: null }), {
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
