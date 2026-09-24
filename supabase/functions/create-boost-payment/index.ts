import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { BOOST_FEE_CENTS, BOOST_DURATION_HOURS, BOOST_DISCOUNT_PCT, BOOST_MIN_UNIT_AMOUNT_CENTS } from "../_shared/productPrices.ts";
import { TIER_DISPLAY_NAMES, tierDisplayName } from "../_shared/tierNames.ts";
import { hasPerk, monthlyFreeBoostAllowance } from "../_shared/tierPerks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Monthly free-boost meter ────────────────────────────────────────────────
//
// PGRST202 FALLBACK. db-deploy and functions-deploy are separate workflows on
// the same push, so this code can reach prod minutes BEFORE the migration that
// creates `claim_monthly_free_boost` / `refund_monthly_free_boost`. In that
// window the RPC answers PGRST202 (function not found), and the only honest
// thing to do is the pre-allowance meter: a conditional stamp of the month
// column, which grants exactly ONE free boost. That under-grants Plus's second
// boost for a few minutes; it never over-grants anyone, and a Pro member keeps
// their perk throughout. Remove once 20260915043201 is confirmed live.
const MISSING_RPC = "PGRST202";

// NOT `ReturnType<typeof createClient>` — the overload resolves to a client
// typed `never` schema (see execute-dispute-split for the long version).
type SupabaseAdmin = SupabaseClient<any>;

async function claimMonthlyFreeBoost(
  admin: SupabaseAdmin,
  userId: string,
  allowance: number,
): Promise<{ claimed: boolean; month: string; used: number | null; error: unknown }> {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const { data, error } = await admin.rpc("claim_monthly_free_boost", {
    p_user_id: userId,
    p_allowance: allowance,
  });
  if (error && (error as { code?: string }).code === MISSING_RPC) {
    const { data: credited, error: legacyErr } = await admin
      .from("profiles")
      .update({ boost_credit_used_month: thisMonth })
      .eq("user_id", userId)
      .or(`boost_credit_used_month.is.null,boost_credit_used_month.neq.${thisMonth}`)
      .select("user_id");
    return { claimed: (credited?.length ?? 0) > 0, month: thisMonth, used: null, error: legacyErr };
  }
  if (error) return { claimed: false, month: thisMonth, used: null, error };
  // RETURNS TABLE → PostgREST hands back an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { claimed?: boolean; credit_month?: string; credits_used?: number | null }
    | null
    | undefined;
  if (!row || typeof row.claimed !== "boolean") {
    // An answer we cannot read is not a grant. Fail toward the paid path.
    return { claimed: false, month: thisMonth, used: null, error: `unreadable claim result: ${JSON.stringify(data)}` };
  }
  return {
    claimed: row.claimed,
    month: row.credit_month ?? thisMonth,
    used: row.credits_used ?? null,
    error: null,
  };
}

async function refundMonthlyFreeBoost(
  admin: SupabaseAdmin,
  userId: string,
  month: string,
): Promise<{ refunded: boolean; error: unknown }> {
  const { data, error } = await admin.rpc("refund_monthly_free_boost", {
    p_user_id: userId,
    p_month: month,
  });
  if (error && (error as { code?: string }).code === MISSING_RPC) {
    const { data: refunded, error: legacyErr } = await admin
      .from("profiles")
      .update({ boost_credit_used_month: null })
      .eq("user_id", userId)
      .eq("boost_credit_used_month", month)
      .select("user_id");
    return { refunded: (refunded?.length ?? 0) > 0, error: legacyErr };
  }
  if (error) return { refunded: false, error };
  return { refunded: data === true, error: null };
}

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
    // A NULL expiry on a paid tier means "no scheduled end" and counts as
    // ACTIVE. This read `: false`, i.e. the opposite — so a comped/lifetime
    // Elite row with no expiry lost its included boost and was sent to Stripe
    // to pay for it. The convention is documented once, in _shared/tierPerks.ts,
    // and every other gate (instant-payout, EarningsTab, the fee resolvers)
    // already used it; this endpoint was the outlier.
    const subExp = posterProfile?.subscription_expires_at
      ? new Date(posterProfile.subscription_expires_at)
      : null;
    const subActive = subExp ? subExp > new Date() : true;
    if (hasPerk(subTier, "freeBoosts", subActive)) {
      const boostExpires = new Date(Date.now() + BOOST_DURATION_HOURS * 60 * 60 * 1000);
      // `.select("id")` + a zero-row branch, per CLAUDE.md. This response is the
      // ONLY thing that tells an Elite member their perk was applied, and an
      // UPDATE matching zero rows returns `{ data: [], error: null }` — so
      // without the guard a job deleted or re-keyed between the read above and
      // this write answers `free: true` and the client shows "Job boosted" over
      // a job that was never boosted.
      const { data: boostedRows, error: boostErr } = await supabaseAdmin
        .from("jobs")
        .update({
          boost_expires_at: boostExpires.toISOString(),
          boosted_at: new Date().toISOString(),
        })
        .eq("id", job_id)
        .select("id");
      if (boostErr || (boostedRows?.length ?? 0) === 0) {
        console.error(
          "[create-boost-payment] elite boost flip failed:",
          boostErr ?? `zero rows matched for job ${job_id}`,
        );
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

    // Pro-and-up perk: N FREE BOOSTS per calendar month — Pro 1 (owner,
    // 2026-08-24), Plus 2 (owner, 2026-09-14, VN-44). The count is
    // MONTHLY_FREE_BOOSTS in _shared/tierPerks.ts, the same number the
    // storefront bullet and the boost dialog read. After the allowance is
    // spent, the tier falls through to its 20% discount below.
    //
    // The claim is `claim_monthly_free_boost` — one conditional UPDATE of the
    // month + count meter (20260915043201), so two same-moment boosts cannot
    // both ride the last credit. It used to be a PostgREST update of the month
    // column alone, which can only express an allowance of ONE: a Plus member's
    // second boost would have gone to Checkout under a card promising two.
    //
    // Plus inherits the perk from Pro (CC-019: the literal `subTier === "pro"`
    // silently withheld the monthly boost from the tier ABOVE Pro).
    const allowance = monthlyFreeBoostAllowance(subTier, subActive);
    if (allowance > 0) {
      const claim = await claimMonthlyFreeBoost(supabaseAdmin, user.id, allowance);
      if (claim.error) {
        console.error("[create-boost-payment] free monthly boost claim failed:", claim.error);
        // Fail toward the PAID path — never block a boost over the perk.
      } else if (claim.claimed) {
        const boostExpires = new Date(Date.now() + BOOST_DURATION_HOURS * 60 * 60 * 1000);
        // The credit is SPENT at this point — the conditional claim above is
        // what makes two same-moment boosts unable to both ride it, so it has
        // to come first. That means everything after it owes the member a
        // rollback: if the boost never lands, the credit must come back, or
        // one of their free boosts of the month is destroyed and they have
        // nothing to show for it and no way to say so.
        //
        // Guarded with `.select("id")` + a zero-row branch for the same reason
        // as the Elite path above: a zero-row UPDATE is `{ data: [], error:
        // null }`, indistinguishable from success, and would answer
        // `free: true` over a job that was never boosted — while still having
        // burned the credit.
        //
        // CONDITIONAL on the job still being open and not already boosted.
        // The "already boosted" check near the top is a READ taken before the
        // claim, so two same-moment requests for ONE job (two devices, a
        // retry) both pass it, both claim, and both flips land: one 24-hour
        // boost, two credits gone. With an allowance of 2 that is Plus's
        // whole month. Re-checking in the write makes the loser match zero
        // rows, and the zero-row branch below refunds its credit.
        const flipAt = new Date().toISOString();
        const { data: boostedRows, error: boostErr } = await supabaseAdmin
          .from("jobs")
          .update({
            boost_expires_at: boostExpires.toISOString(),
            boosted_at: flipAt,
          })
          .eq("id", job_id)
          .eq("status", "open")
          .or(`boost_expires_at.is.null,boost_expires_at.lte.${flipAt}`)
          .select("id");
        if (boostErr || (boostedRows?.length ?? 0) === 0) {
          console.error(
            "[create-boost-payment] free monthly boost flip failed:",
            boostErr ?? `zero rows matched for job ${job_id}`,
          );
          // Give the credit back. Conditional on the month we claimed in, so a
          // meter that has since rolled into a new month is not touched. If
          // the rollback itself fails the member has silently lost the perk,
          // so that case is logged loudly rather than dropped — it is the only
          // trace ops would have.
          const refund = await refundMonthlyFreeBoost(supabaseAdmin, user.id, claim.month);
          if (refund.error || !refund.refunded) {
            console.error(
              `[create-boost-payment] CRITICAL: free monthly boost credit for ${user.id} was consumed (${claim.month}) but the boost failed AND the credit could not be returned`,
              refund.error ?? "zero rows matched",
            );
          }
          return fail(
            500,
            refund.error || !refund.refunded
              ? "We couldn't apply your free monthly boost. Please try again."
              : "We couldn't apply your free boost — this job may already be boosted. Your free boost wasn't used.",
          );
        }
        return new Response(
          JSON.stringify({
            free: true,
            boost_expires_at: boostExpires.toISOString(),
            message: allowance > 1
              ? `Job boosted — free ${tierDisplayName(subTier)} boost ${claim.used ?? 1} of ${allowance} this month`
              : `Job boosted — your free ${tierDisplayName(subTier)} boost this month`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }
    }

    // Subscriber perk: 20% off boosts. Same Stripe Checkout flow as the
    // full-price case below, but the unit_amount is discounted and the
    // product description names the subscriber discount so the receipt is
    // legible. A tier with `freeBoosts` is already returned above, and Free
    // falls through to the full BOOST_FEE_CENTS price.
    //
    // CC-019: this was `subTier === "basic" || subTier === "pro"`, and the
    // comment above it asserted "There is no Plus tier" — which had been false
    // since 2026-09-05. A Plus poster was charged full price for a boost their
    // plan discounts, on both this endpoint and the client quote in
    // src/lib/productPrices.ts, which held its own copy of the same list.
    // Both now ask TIER_PERK_MATRIX.
    const isBoostDiscountTier = hasPerk(subTier, "boostDiscount", subActive);
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
          : `Job Boost — 24-hour featured placement (${BOOST_DISCOUNT_PCT}% off with ${tierDisplayName(subTier)})`)
      : "Job Boost — 24-hour featured placement";

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
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
      success_url: buildRedirectUrl(`/home?boosted=${job_id}`, isNative),
      cancel_url: buildRedirectUrl(`/home?boost_cancelled=${job_id}`, isNative),
      metadata: {
        kind: "job_boost",
        job_id,
        customer_id: user.id,
        duration_hours: String(BOOST_DURATION_HOURS),
      },
    };
    // Same request = same key, so a double tap replays the first session
    // instead of minting a second payable one. The key carries a digest of the
    // params because Stripe REJECTS a reused key whose params differ (ME-017
    // #8): a retry within 24h after a plan change (price, product name), a
    // first Stripe customer, or web vs app (return URLs) used to fail with an
    // idempotency error shown as a generic one.
    const paramsDigest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(sessionParams)))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("").slice(0, 16);
    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `boost:${user.id}:${job_id}:${paramsDigest}`,
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
