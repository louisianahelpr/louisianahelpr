import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { BOOST_FEE_CENTS, BOOST_DURATION_HOURS, BOOST_DISCOUNT_PCT, BOOST_MIN_UNIT_AMOUNT_CENTS } from "../_shared/productPrices.ts";
import { TIER_DISPLAY_NAMES } from "../_shared/tierNames.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Throttle: 5 boost-payment attempts per IP per minute. Same Stripe-cost
  // and abuse logic as create-payment.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 5,
    keyPrefix: "create-boost-payment",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
  );

  // Expected, user-facing failures (auth/validation/ownership) must return
  // their own status + human message so the client can show the real reason.
  // Only genuinely unexpected errors fall through to the 500 catch below —
  // otherwise the client only ever sees "Edge Function returned a non-2xx".
  const fail = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Please sign in to boost this job.");
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) return fail(401, "Your session expired — sign in again to boost.");

    const rawBody = await req.json().catch(() => ({}));
    const { job_id } = rawBody;
    const isNative = isNativeRequest(rawBody);
    if (!job_id) return fail(400, "Missing job to boost.");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    // Verify the caller owns this job and it's still open (no point boosting closed work)
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("jobs")
      .select("id, customer_id, status, title, boost_expires_at")
      .eq("id", job_id)
      .single();
    if (jobErr || !job) return fail(404, "We couldn't find that job.");
    if (job.customer_id !== user.id) return fail(403, "You can only boost your own jobs.");
    if (job.status !== "open") return fail(409, "Only open jobs can be boosted.");
    if (job.boost_expires_at && new Date(job.boost_expires_at) > new Date()) {
      return fail(409, "This job is already boosted.");
    }

    // Elite-tier perk: free boost. If the caller has an active Elite
    // subscription, flip the boost flags directly without redirecting
    // to Stripe Checkout. Returns a `free: true` payload so the client
    // can show a success toast instead of redirecting.
    // Fail CLOSED. Dropping this error made `subTier` fall back to "free",
    // silently DOWNGRADING an Elite member: they'd lose their free-boost perk
    // and be sent to Stripe Checkout to pay for something already included.
    const { data: posterProfile, error: posterProfileError } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier, subscription_expires_at")
      .eq("user_id", user.id)
      .single();
    if (posterProfileError) {
      console.error("[create-boost-payment] profile lookup failed:", posterProfileError.message);
      return new Response(
        JSON.stringify({ error: "We couldn't confirm your membership just now. Please try again." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const subTier = (posterProfile?.subscription_tier ?? "free") as string;
    const subExp = posterProfile?.subscription_expires_at
      ? new Date(posterProfile.subscription_expires_at)
      : null;
    const subActive = subExp ? subExp > new Date() : false;
    if (subActive && subTier === "elite") {
      const boostExpires = new Date(Date.now() + BOOST_DURATION_HOURS * 60 * 60 * 1000);
      const { error: boostErr } = await supabaseAdmin
        .from("jobs")
        .update({
          boost_expires_at: boostExpires.toISOString(),
          boosted_at: new Date().toISOString(),
        })
        .eq("id", job_id);
      if (boostErr) {
        console.error("[create-boost-payment] elite boost flip failed:", boostErr);
        return fail(500, `We couldn't apply your ${TIER_DISPLAY_NAMES.elite} boost. Please try again.`);
      }
      return new Response(
        JSON.stringify({
          free: true,
          boost_expires_at: boostExpires.toISOString(),
          message: `Job boosted — included with ${TIER_DISPLAY_NAMES.elite}`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    // Pro perk: ONE FREE BOOST per calendar month (owner, 2026-08-24) —
    // tracked by profiles.boost_credit_used_month (YYYY-MM). After it's
    // spent, Pro falls through to its 20% discount below. The month check
    // and the stamp are one conditional UPDATE so two same-moment boosts
    // can't both ride the credit.
    if (subActive && subTier === "pro") {
      const thisMonth = new Date().toISOString().slice(0, 7);
      const { data: credited, error: creditErr } = await supabaseAdmin
        .from("profiles")
        .update({ boost_credit_used_month: thisMonth })
        .eq("user_id", user.id)
        .or(`boost_credit_used_month.is.null,boost_credit_used_month.neq.${thisMonth}`)
        .select("user_id");
      if (creditErr) {
        console.error("[create-boost-payment] pro credit check failed:", creditErr);
        // Fail toward the PAID path — never block a boost over the perk.
      } else if ((credited?.length ?? 0) > 0) {
        const boostExpires = new Date(Date.now() + BOOST_DURATION_HOURS * 60 * 60 * 1000);
        const { error: boostErr } = await supabaseAdmin
          .from("jobs")
          .update({
            boost_expires_at: boostExpires.toISOString(),
            boosted_at: new Date().toISOString(),
          })
          .eq("id", job_id);
        if (boostErr) {
          console.error("[create-boost-payment] pro credit boost flip failed:", boostErr);
          return fail(500, "We couldn't apply your free monthly boost. Please try again.");
        }
        return new Response(
          JSON.stringify({
            free: true,
            boost_expires_at: boostExpires.toISOString(),
            message: `Job boosted — your free ${TIER_DISPLAY_NAMES.pro} boost this month`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }
    }

    // Basic / Pro perk: 20% off boosts. Same Stripe Checkout flow as the
    // full-price case below, but the unit_amount is discounted and the
    // product description names the subscriber discount so the receipt is
    // legible. Elite is already returned above (free), and Free/Business
    // fall through to the full BOOST_FEE_CENTS price.
    const isBoostDiscountTier = subActive && (subTier === "basic" || subTier === "pro");
    // MIN_UNIT_AMOUNT_CENTS: an absolute floor covering Stripe's per-charge
    // cost (~30¢ fixed + 2.9% variable) plus a thin platform margin, so a
    // future BOOST_FEE_CENTS drop can't silently invert unit economics on
    // discounted subscribers (Cowork audit 2026-07-08 fee-floor guard). At
    // the current $3 gross the discounted $2.40 nets ~$2.03 to platform;
    // 100¢ is a defensive floor well below that, only relevant if the base
    // fee is ever cut below ~$1.25.
    const MIN_UNIT_AMOUNT_CENTS = BOOST_MIN_UNIT_AMOUNT_CENTS;
    const rawDiscounted = Math.round(BOOST_FEE_CENTS * (100 - BOOST_DISCOUNT_PCT) / 100);
    const unitAmount = isBoostDiscountTier
      ? Math.max(rawDiscounted, MIN_UNIT_AMOUNT_CENTS)
      : BOOST_FEE_CENTS;
    // If the floor kicked in, the "20% off" copy would be misleading — a
    // future price change that trips this branch should either bump the
    // floor or drop the discount, not silently charge more than advertised.
    const flooredBelowDiscount = isBoostDiscountTier && unitAmount > rawDiscounted;
    if (flooredBelowDiscount) {
      console.warn(
        `[create-boost-payment] discount floor engaged: BOOST_FEE_CENTS=${BOOST_FEE_CENTS} ` +
        `discounted=${rawDiscounted}¢ floor=${MIN_UNIT_AMOUNT_CENTS}¢ — review BOOST_FEE_CENTS or BOOST_DISCOUNT_PCT`,
      );
    }
    const productName = isBoostDiscountTier
      ? (flooredBelowDiscount
          ? "Job Boost — 24-hour featured placement"
          : `Job Boost — 24-hour featured placement (${BOOST_DISCOUNT_PCT}% off with ${subTier === "basic" ? TIER_DISPLAY_NAMES.basic : TIER_DISPLAY_NAMES.pro})`)
      : "Job Boost — 24-hour featured placement";

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: productName,
            // Derived, not hardcoded: this is the line the customer reads on
            // their Stripe receipt, and it was the ONE duration string in this
            // file that wouldn't follow BOOST_DURATION_HOURS if it changed.
            description: `Boosts "${job.title}" to the top of Browse Jobs for ${BOOST_DURATION_HOURS} hours.`,
            // Promotional / advertising service — not subject to LA sales tax.
            // (LA does not currently tax advertising services for state purposes.)
            tax_code: "txcd_00000000",
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      }],
      mode: "payment",
      automatic_tax: { enabled: true },
      payment_intent_data: {
        metadata: {
          kind: "job_boost",
          job_id,
          customer_id: user.id,
          duration_hours: String(BOOST_DURATION_HOURS),
        },
      },
      success_url: buildRedirectUrl(`/dashboard?boosted=${job_id}`, isNative),
      cancel_url: buildRedirectUrl(`/dashboard?boost_cancelled=${job_id}`, isNative),
      metadata: {
        kind: "job_boost",
        job_id,
        customer_id: user.id,
        duration_hours: String(BOOST_DURATION_HOURS),
      },
    }, {
      idempotencyKey: `boost:${user.id}:${job_id}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-boost-payment] error:", error);
    return fail(500, "Something went wrong starting your boost. Please try again.");
  }
});
