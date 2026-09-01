import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PRODUCT_TO_TIER } from "../_shared/productTiers.ts";
import { tierDisplayName } from "../_shared/tierNames.ts";
import { subscriptionCurrentPeriodEndISO } from "../_shared/stripeSubscriptionPeriod.ts";
import { CLEARED_SUBSCRIPTION_LINKAGE, subscriptionLinkage } from "../_shared/subscriptionLinkage.ts";

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
          // NOT `sub.current_period_end` — gone from the Subscription object
          // as of API version 2025-03-31.basil (this function pins
          // 2025-08-27.basil), so it read `undefined` and
          // `new Date(NaN).toISOString()` threw RangeError. The throw landed in
          // the outer catch, which answers 200 `{ subscribed: false }` — so
          // this reconciliation poll told every genuinely-subscribed caller
          // they had no membership. See _shared/stripeSubscriptionPeriod.ts.
          const expiresAt = subscriptionCurrentPeriodEndISO(sub);
          // `.select("user_id")` + an explicit error/zero-row check, per
          // CLAUDE.md: this is an entitlement write, and a null `error` on an
          // UPDATE matching zero rows is indistinguishable from success. It
          // used to drop both, so a failed grant answered `subscribed: true`
          // and the next profile read disagreed with what was just claimed.
          const { data: granted, error: grantError } = await supabaseAdmin
            .from("profiles")
            .update({
              subscription_tier: tier,
              subscription_expires_at: expiresAt,
              // This function reconciles a member against Stripe on every
              // dashboard load, so it is also the natural BACKFILL for the
              // linkage columns on accounts whose last webhook predates them.
              ...subscriptionLinkage(sub),
            })
            .eq("user_id", user.id)
            .select("user_id");
          if (grantError) {
            console.error("[check-pro-subscription] tier grant failed:", grantError.message);
            return new Response(
              JSON.stringify({ error: "Couldn't sync your membership. Please try again." }),
              { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          if (!granted || granted.length === 0) {
            console.error("[check-pro-subscription] tier grant matched 0 profiles for", user.id);
            return new Response(
              JSON.stringify({ error: "Couldn't sync your membership. Please try again." }),
              { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

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
                // The dedupe read above is a read-then-write, and this function
                // runs on EVERY dashboard load — two concurrent loads both see
                // "no bonus yet". The real arbiter is the unique index
                // `referral_credits_one_per_reason` on
                // (user_id, referral_code_id, referred_user_id, reason)
                // (migration 20260823010000), so the loser's INSERT comes back
                // 23505 and no second credit is minted. Good.
                //
                // But the result was DISCARDED and the notification sent
                // unconditionally, so the loser still told the referrer
                // "you earned $10" with no credit behind it — and so did every
                // genuine insert failure. Notify only when a row was actually
                // created; `.select("id")` is what makes that knowable, since a
                // null `error` alone never proves a write happened.
                const { data: mintedRows, error: mintErr } = await supabaseAdmin
                  .from("referral_credits")
                  .insert({
                    user_id: referral.referrer_id,
                    referred_user_id: user.id,
                    referral_code_id: referral.referral_code_id,
                    amount: 10,
                    reason: "subscription_bonus",
                    redeemed: false,
                  })
                  .select("id");
                const minted = !mintErr && (mintedRows?.length ?? 0) > 0;
                if (!minted) {
                  // 23505 is the expected, benign outcome of losing the race —
                  // the credit exists, it just wasn't this call that made it.
                  // Anything else is a real failure worth seeing.
                  const code = (mintErr as { code?: string } | null)?.code;
                  if (code === "23505") {
                    console.log(
                      `[check-pro-subscription] referral bonus already granted for referrer ${referral.referrer_id} / referred ${user.id} — not re-notifying`,
                    );
                  } else {
                    console.error(
                      `[check-pro-subscription] referral bonus MINT FAILED for referrer ${referral.referrer_id} / referred ${user.id}:`,
                      mintErr?.message ?? "insert returned zero rows",
                    );
                  }
                } else {
                  // Notify the referrer so the upgrade-credit moment isn't
                  // silent. Best-effort — a failed notification doesn't block
                  // the subscription update, but it isn't dropped either: the
                  // credit is real and the referrer was not told about it.
                  const { data: notifRows, error: notifErr } = await supabaseAdmin
                    .from("notifications")
                    .insert({
                      user_id: referral.referrer_id,
                      title: "Bonus credit earned",
                      message: `Someone you referred upgraded to ${tierDisplayName(tier)} — you earned $10.`,
                      type: "payment",
                      link: "/profile?tab=referral",
                      read: false,
                    })
                    .select("id");
                  if (notifErr || (notifRows?.length ?? 0) === 0) {
                    console.error(
                      `[check-pro-subscription] referral bonus credited but the referrer ${referral.referrer_id} was not notified:`,
                      notifErr?.message ?? "insert returned zero rows",
                    );
                  }
                }
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
    // REVOKING IS THE DANGEROUS BRANCH (R7), so the write's error is checked
    // below: it used to be dropped, and a failed revoke then looked identical
    // to a successful one.
    //
    // There was a second guard here — a `businesses` lookup that refused to
    // clear the tier when the caller owned a business carrying a `seat_tier`,
    // because profiles.subscription_tier was SHARED with the seat grants the
    // Business product wrote. That product's backend was removed on
    // 2026-08-25 and the `businesses` table is now dropped, so no seat tier
    // can exist to protect; the only tiers this column can hold are the ones
    // this function and the one-time-pass flow grant, both checked above.
    // Verified before removing it: every remaining businesses row was
    // test/seed data and every one of those owners already had
    // subscription_tier NULL, so the guard was protecting nothing for anyone.
    const { error: clearError } = await supabaseAdmin.from("profiles").update({
      subscription_tier: null,
      subscription_expires_at: null,
      ...CLEARED_SUBSCRIPTION_LINKAGE,
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
