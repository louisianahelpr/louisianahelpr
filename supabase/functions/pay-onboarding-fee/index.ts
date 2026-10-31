import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { NONTAXABLE_TAX_CODE } from "../_shared/salesTax.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { stripeModeForParties, stripeModeRefusedResponse, StripeModeRefused, stripeSecretKeyFor } from "../_shared/stripeMode.ts";
import { resolveStripeCustomer, StripeCustomerUnavailable } from "../_shared/stripeCustomer.ts";

/**
 * Settle the one-time account setup fee EARLY, on its own.
 *
 * This is not a new charge and not a price change. It is the SAME $2 the
 * account already owes, which is otherwise collected at whichever of these
 * comes first:
 *
 *   - create-payment      adds it as a line item on the first job post
 *   - release-payout      deducts it from the first payout
 *   - process-scheduled-payouts   ditto, on the cron path
 *
 * Why a third door: the fee is normally taken out of a helper's first payout,
 * but identity verification — which the fee pays for — is what a helper needs
 * BEFORE anyone will hire them. So a helper with no earnings yet had no way to
 * settle it. This lets them, once, deliberately.
 *
 * THE "NEVER CHARGED TWICE" GUARANTEE IS LOAD-BEARING, and it is enforced the
 * same way the other three paths enforce it: the flag flip is a conditional
 * UPDATE (`.eq("onboarding_fee_paid", false)`) that exactly one writer can win,
 * and the loser's money is refunded. This function does NOT flip the flag —
 * checkoutSessionCompleted does, after capture, through that same claim. So:
 *
 *   - already paid       → refused here, before Stripe is ever called
 *   - paid concurrently  → the webhook's claim loses and auto-refunds the $2
 *
 * The Stripe idempotency key is per-user, so a double tap reuses one Checkout
 * Session rather than opening a second.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const fail = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 5,
    keyPrefix: "pay-onboarding-fee",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Please sign in first.");
    const { data: userData } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    const user = userData.user;
    if (!user?.email) return fail(401, "Your session expired — sign in again.");
    // Q837: an unconfirmed-email caller is refused here, as Q807 refuses at
    // the table (that gate cannot see the caller behind a service-role write).
    const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders);
    if (unconfirmedEmail) return unconfirmedEmail;

    const rawBody = await req.json().catch(() => ({}));
    const isNative = isNativeRequest(rawBody);
    // Q2352: where the member comes back to. One named place, never a caller-supplied path (deepLinkOneRouter:
    // every redirect target is a literal route): "declutter_selling" = their Declutter listings, when the first
    // listing asked for the fee; anything else = Payments.
    const toDeclutter = (rawBody as { return_to?: unknown })?.return_to === "declutter_selling";
    // Owner 2026-10-30: a first free claim pays first, then verifies: "declutter_free_claim" lands on Buying, where their
    // picked item waits, with the ID check open (IdentityCheckHost reads verify_id).
    const toFreeClaim = (rawBody as { return_to?: unknown })?.return_to === "declutter_free_claim";

    // Fail CLOSED on a read fault. A dropped error here would let someone who
    // has already paid be sent to Stripe to pay again — recoverable (the
    // webhook refunds it) but exactly the experience the guarantee promises
    // they will never have.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("onboarding_fee_paid")
      .eq("user_id", user.id)
      .single();
    if (profileErr) {
      console.error("[pay-onboarding-fee] profile read failed:", profileErr.message);
      return fail(503, "We couldn't check your account just now. Please try again.");
    }
    if (profile?.onboarding_fee_paid) {
      // Not an error state to the user — it is the good news.
      return new Response(JSON.stringify({ alreadyPaid: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // The amount is read from platform_settings, never from a client-side
    // constant, so all four collection paths quote the same number.
    const { data: settings, error: settingsErr } = await supabaseAdmin
      .from("platform_settings")
      .select("onboarding_fee_cents")
      .limit(1)
      .maybeSingle();
    if (settingsErr) {
      console.error("[pay-onboarding-fee] settings read failed:", settingsErr.message);
      return fail(503, "We couldn't load the fee amount just now. Please try again.");
    }
    const feeCents = Number(settings?.onboarding_fee_cents ?? 0);
    if (!Number.isFinite(feeCents) || feeCents <= 0) {
      // A zero fee means the platform isn't charging one; nothing to settle.
      return fail(409, "There's no setup fee to pay on your account.");
    }

    // Stripe mode (owner 2026-10-12): a test account pays on the TEST key, everyone
    // else on the live key; decided from the caller's own row, never the body.
    const stripeMode = await stripeModeForParties(supabaseAdmin, [user.id]);
    const stripe = new Stripe(stripeSecretKeyFor(stripeMode), {
      apiVersion: "2025-08-27.basil",
    });

    // One wallet (Q2139, owner 2026-10-18 "verify ONCE, use EVERYWHERE"): the member's
    // one Stripe customer for this mode (_shared/stripeCustomer.ts), never a customer
    // found by email (an address can belong to someone else's old customer).
    const customerId = await resolveStripeCustomer(supabaseAdmin, stripe, user, stripeMode, { adoptTagged: true });

    const metadata = {
      kind: "onboarding_fee",
      customer_id: user.id,
      // Reuses the SAME two keys the first-job-post path stamps, so the
      // webhook's existing claim-or-refund branch handles this session with no
      // second implementation of the guarantee.
      onboarding_fee_charged: "true",
      onboarding_fee_cents: String(feeCents),
    };

    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        // Q2084 (owner: never eat a fee): card only (Apple Pay and Google Pay ride on
        // card), never the account default list (Klarna, Afterpay, Affirm, Cash App,
        // Amazon Pay cost more than the card fee covers), and dollars only.
        payment_method_types: ["card"],
        adaptive_pricing: { enabled: false },
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "One-time account setup",
                description:
                  "One-time identity verification & account setup fee. Charged once per account.",
                tax_code: NONTAXABLE_TAX_CODE,
              },
              unit_amount: feeCents,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        payment_intent_data: { metadata },
        success_url: toFreeClaim
          ? buildRedirectUrl("/declutter?tab=buying&verify_id=1&verify_reason=claim", isNative)
          : toDeclutter
            ? buildRedirectUrl("/declutter?view=selling", isNative)
            : buildRedirectUrl("/profile?tab=payment&setup_fee=paid", isNative),
        cancel_url: toFreeClaim
          ? buildRedirectUrl("/declutter?tab=buying", isNative)
          : toDeclutter
            ? buildRedirectUrl("/declutter?view=selling", isNative)
            : buildRedirectUrl("/profile?tab=payment", isNative),
        metadata,
      },
      // Per user, not per attempt: a double tap reopens the same session
      // instead of creating a second chargeable one.
      // Q2352: and per return path, since the page's return URLs differ (lh-money-escrow review #3).
      // v2: the wallet customer and payment methods changed the request (Q2084).
      { idempotencyKey: toFreeClaim ? `onboarding-fee:v2:${user.id}:declutter_free_claim` : toDeclutter ? `onboarding-fee:v2:${user.id}:declutter_selling` : `onboarding-fee:v2:${user.id}` },
    );

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    if (error instanceof StripeCustomerUnavailable) {
      console.error(`[pay-onboarding-fee] ${error.message}`);
      return fail(503, "Something went wrong starting that payment. Please try again.");
    }
    console.error("[pay-onboarding-fee] error:", error);
    return fail(500, "Something went wrong starting that payment. Please try again.");
  }
});
