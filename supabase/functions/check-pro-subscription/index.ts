import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PRODUCT_TO_TIER } from "../_shared/productTiers.ts";
import { tierDisplayName } from "../_shared/tierNames.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // EVERY customer for this email, not just the first (R7). A person can
    // easily hold more than one Stripe customer record on one address — one
    // minted by Checkout, another by a Connect or test flow — and `limit: 1`
    // returned an arbitrary one. If the subscription lived on any other
    // record, this function concluded "no subscription" and fell through to
    // the revoke below, downgrading a paying subscriber on a dashboard load.
    const customers = await stripe.customers.list({ email: user.email, limit: 100 });

    // Check for an active Stripe subscription on ANY of them.
    if (customers.data.length > 0) {
      const subscriptions = { data: [] as Stripe.Subscription[] };
      for (const customer of customers.data) {
        const subsForCustomer = await stripe.subscriptions.list({
          customer: customer.id,
          status: "active",
          limit: 10,
        });
        subscriptions.data.push(...subsForCustomer.data);
      }

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
                  message: `Someone you referred upgraded to ${tierDisplayName(tier)} — you earned $10.`,
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

    // No valid personal subscription or pass.
    //
    // REVOKING IS THE DANGEROUS BRANCH (R7), so it is now guarded twice.
    //
    // (a) profiles.subscription_tier was SHARED with the business seat grants
    //     that the Business product used to write. That product was removed on
    //     2026-08-25 and no new seat tier can be granted, but the guard STAYS:
    //     `businesses` rows were deliberately kept, some still carry a
    //     seat_tier, and without this check the next poll would clear a tier
    //     this function never granted — the exact bug it was written for.
    //     Never clear a tier this function did not grant.
    // (b) the write's error was dropped, so a failed revoke looked identical
    //     to a successful one.
    const { data: ownedBusiness, error: ownedBusinessError } = await supabaseAdmin
      .from("businesses")
      .select("id, seat_tier")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (ownedBusinessError) {
      // Fail CLOSED: if we cannot prove the tier is ours to clear, leave it.
      console.error(
        "[check-pro-subscription] business lookup failed; leaving tier untouched:",
        ownedBusinessError.message,
      );
      return new Response(
        JSON.stringify({ subscribed: false, tier: profile.subscription_tier ?? null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (ownedBusiness?.seat_tier) {
      // The tier on this profile belongs to the seat plan, not to us.
      return new Response(
        JSON.stringify({ subscribed: false, tier: profile.subscription_tier ?? null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const { error: clearError } = await supabaseAdmin.from("profiles").update({
      subscription_tier: null,
      subscription_expires_at: null,
    }).eq("user_id", user.id);

    if (clearError) {
      // Never drop the error (CLAUDE.md). A failed revoke that reports success
      // makes the next read disagree with what this response just claimed.
      console.error("[check-pro-subscription] tier clear failed:", clearError.message);
      return new Response(
        JSON.stringify({ subscribed: false, tier: profile.subscription_tier ?? null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

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
