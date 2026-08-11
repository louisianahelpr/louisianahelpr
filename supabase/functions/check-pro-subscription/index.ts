import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
  );

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
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
    // Fail CLOSED: a dropped error here reads as "no profile", which makes a
    // paying Pro/Elite member resolve as free for the rest of this call —
    // silently revoking entitlements they've paid for.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier, subscription_expires_at")
      .eq("user_id", user.id)
      .single();
    if (profileError) {
      console.error("[check-pro-subscription] profile lookup failed:", profileError.message);
      return new Response(
        JSON.stringify({ error: "Couldn't load your membership. Please try again." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

          // Referral upgrade bonus — if this user was referred AND
          // they just upgraded to a paid tier (pro/elite), award the
          // referrer an extra $10 credit on top of the standard $5.
          // Idempotent: skip if a "subscription_bonus" credit already
          // exists for this referral.
          if (tier === "pro" || tier === "elite") {
            const { data: referral } = await supabaseAdmin
              .from("referrals")
              .select("id, referrer_id, referral_code_id")
              .eq("referred_id", user.id)
              .maybeSingle();
            if (referral?.referrer_id && referral?.referral_code_id) {
              // This read is the ONLY thing standing between a retry and a
              // duplicate referral bonus, so it must fail CLOSED: dropping the
              // error made `!existingBonus` true on any read failure and minted
              // the credit again.
              const { data: existingBonus, error: existingBonusError } = await supabaseAdmin
                .from("referral_credits")
                .select("id")
                .eq("user_id", referral.referrer_id)
                .eq("referred_user_id", user.id)
                .eq("reason", "subscription_bonus")
                .maybeSingle();
              if (existingBonusError) {
                console.error(
                  "[check-pro-subscription] referral bonus dedupe read failed; skipping bonus:",
                  existingBonusError.message,
                );
              } else if (!existingBonus) {
                await supabaseAdmin.from("referral_credits").insert({
                  user_id: referral.referrer_id,
                  referred_user_id: user.id,
                  referral_code_id: referral.referral_code_id,
                  amount: 10,
                  reason: "subscription_bonus",
                  redeemed: false,
                });
                // Notify the referrer so the upgrade-credit moment isn't
                // silent. Best-effort — failure here doesn't block the
                // subscription update.
                await supabaseAdmin.from("notifications").insert({
                  user_id: referral.referrer_id,
                  title: "Bonus credit earned",
                  message: `Someone you referred upgraded to ${tier.charAt(0).toUpperCase() + tier.slice(1)} — you earned $10.`,
                  type: "payment",
                  link: "/profile?tab=referral",
                  read: false,
                });
              }
            }
          }

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
    console.error("[check-pro-subscription] error:", error);
    // Return 200 with fallback so frontend doesn't crash/blank-screen
    return new Response(
      JSON.stringify({
        subscribed: false,
        tier: null,
        fallback: true,
        error: "Internal server error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  }
});

// Top-level safety net: never let the runtime return 503/blank screens
addEventListener("error", (e) => {
  console.error("[check-pro-subscription] uncaught error:", e.message);
});
addEventListener("unhandledrejection", (e) => {
  console.error("[check-pro-subscription] unhandled rejection:", e.reason);
});
