import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SEAT_PRODUCT_TO_TIER, SEAT_TIER_TO_SUBSCRIPTION } from "../_shared/seatTierGrant.ts";
import { BUSINESS_SEAT_TIERS } from "../_shared/businessSeatTiers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Imported, not redeclared: the Stripe webhook now performs this same grant off
// customer.subscription.* events, so both paths must read one definition or the
// fee ladder can silently diverge between "what you got when you paid" and
// "what this poll corrects you to". See _shared/seatTierGrant.ts.
const PRODUCT_TO_TIER = SEAT_PRODUCT_TO_TIER;

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

    // Find the business this user owns (or has any active membership in)
    // Fail closed rather than answering with a downgrade. On a read failure
    // `ownedBiz` was null, which is the same shape as "owns no business", so a
    // paying business owner got a confident `subscribed: false, tier: starter,
    // seat_limit: 2` — their real plan replaced by a wrong one the UI then
    // renders as fact. A 503 lets the client show "couldn't load" instead of
    // quietly telling a customer they don't have what they paid for.
    const { data: ownedBiz, error: ownedBizError } = await supabaseAdmin
      .from("businesses")
      .select("id, owner_id, seat_tier")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (ownedBizError) {
      console.error("[check-business-seat-subscription] business lookup failed:", ownedBizError.message);
      return new Response(
        JSON.stringify({ error: "We couldn't load your plan. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    if (!ownedBiz) {
      return new Response(
        JSON.stringify({ subscribed: false, tier: "starter", seat_limit: 2 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Every customer for this email, not just the first (R7) — the same
    // arbitrary-record bug the personal poll had: a seat subscription living
    // on any other customer record for this address read as "no seat plan"
    // and downgraded the business to starter.
    const customers = await stripe.customers.list({ email: user.email, limit: 100 });

    let activeTier: "starter" | "crew" | "team" | "enterprise" = "starter";
    let subscriptionId: string | null = null;
    let subscriptionStatus: string | null = null;
    let periodEnd: string | null = null;

    if (customers.data.length > 0) {
      const subscriptions = { data: [] as Stripe.Subscription[] };
      for (const customer of customers.data) {
        const subsForCustomer = await stripe.subscriptions.list({
          customer: customer.id,
          status: "active",
          limit: 20,
        });
        subscriptions.data.push(...subsForCustomer.data);
      }

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

    // Sync to DB.
    //
    // NEVER drop this error (CLAUDE.md). Since migration 20260817120000 the
    // member cap READS `seat_tier`, so this statement is the only thing
    // standing between a paying Team business and a 1-seat Starter cap:
    // `activeTier` starts at "starter" and only rises when Stripe returns a
    // matching active subscription, so a transient Stripe failure, an
    // app-vs-Stripe email mismatch, or an unmapped product all write
    // "starter" here. BusinessLayout calls this on every /business/* view, so
    // a silent failure would strand the customer over cap with no signal
    // anywhere. Log it loudly; the response below still returns what Stripe
    // actually said.
    const { error: syncError } = await supabaseAdmin
      .from("businesses")
      .update({
        seat_tier: activeTier,
        seat_subscription_id: subscriptionId,
        seat_subscription_status: subscriptionStatus,
        seat_subscription_current_period_end: periodEnd,
      })
      .eq("id", ownedBiz.id);
    if (syncError) {
      console.error(
        "[check-business-seat-subscription] failed to sync seat_tier — the seat cap now reads this column",
        { businessId: ownedBiz.id, ownerId: ownedBiz.owner_id, activeTier, error: syncError },
      );
    }

    // ── Grant the fee / early-access tier the seat plan pays for ──────────
    //
    // WHY THIS EXISTS. Buying a seat plan wrote `seat_tier` and nothing else,
    // so nothing in the pricing path ever saw it: `posterFeePercentForTier`
    // and `earlyAccessDelayMs` both read `profiles.subscription_tier`, which
    // stayed null. Verified against prod before writing this — zero profiles
    // had a business-ish tier and no code path set one — meaning a Crew
    // customer paying $20/mo was still charged the standard 12% with a
    // 0-minute head start, while /for-business advertised 11% and 5 minutes.
    // The page promised something billing did not deliver.
    //
    // WHY THE MEMBERSHIP RUNGS AND NOT 'business'. `TIER_PERKS.business` is a
    // flat 6%, but the seat plans are a LADDER (Crew 11 / Team 10 /
    // Enterprise 8). Mapping onto basic/pro/elite makes every advertised
    // number true with no new fee plumbing, because those rungs already carry
    // exactly the fee AND early-access values the cards show:
    //
    //     crew       → basic   11% fee,  5-min early access
    //     team       → pro     10% fee, 10-min early access
    //     enterprise → elite    8% fee, 20-min early access
    //     starter    → null    12% fee,  0-min (the standard, i.e. no grant)
    //
    // Granting 'business' instead would give every paid tier 6% — cheaper than
    // any tier we advertise, including Enterprise.
    //
    // ⚠️ KNOWN SIDE EFFECT, deliberate and worth revisiting: SubscriptionTab
    // routes on `subscription_tier`, so a seat owner now reads as a consumer
    // Pro/Elite subscriber there rather than being sent to /for-business. The
    // alternative — a separate business-fee lookup keyed on `seat_tier` —
    // touches the fee path in several places; this keeps the money correct
    // today with one write. Owner only: team members are not granted, since
    // the seat plan is billed to the owner.
    const grantedTier = SEAT_TIER_TO_SUBSCRIPTION[activeTier] ?? null;

    // Only touch the row when the subscription is genuinely active — a
    // cancelled or past_due plan must fall back to the standard rate, which is
    // what `grantedTier = null` does on the starter branch above.
    const { error: grantError } = await supabaseAdmin
      .from("profiles")
      .update({ subscription_tier: grantedTier })
      .eq("user_id", ownedBiz.owner_id);

    // Never swallow this: a silent failure here means the customer keeps
    // paying while quietly getting the free-tier rate.
    if (grantError) {
      console.error(
        "[check-business-seat-subscription] failed to grant subscription_tier",
        { businessId: ownedBiz.id, ownerId: ownedBiz.owner_id, activeTier, grantedTier, error: grantError },
      );
    }

    // Derived, never hardcoded. This used to be a fifth, private seat ladder
    // (2/5/10/15) that disagreed with the pricing page, the client, and the DB
    // trigger — the same class of drift migration 20260817120000 existed to
    // end. BUSINESS_SEAT_TIERS is the one source of truth ("4+" -> 4).
    const seatLimit = parseInt(
      BUSINESS_SEAT_TIERS.find((t) => t.key === activeTier)?.seats ?? "1",
      10,
    );

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
    console.error("[check-business-seat-subscription] error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
