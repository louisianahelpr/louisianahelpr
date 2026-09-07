import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { PRO_PRICE_MAP } from "../_shared/proTiers.ts";

// billing_cycle: "monthly" | "annual" | "one_time". Price IDs derive from the
// single source of truth so the checkout can never drift from the displayed
// subscription tiers (guarded by src/lib/proTiers.parity.test.ts).
const PRICE_MAP = PRO_PRICE_MAP;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data, error: userErr } = await supabaseClient.auth.getUser(token);
    if (userErr || !data.user?.email) {
      return new Response(JSON.stringify({ error: "User not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const user = data.user;

    const proBody = await req.json();
    const { tier, billing_cycle = "monthly", billing_day } = proBody;
    const isNative = isNativeRequest(proBody);
    // `billing_cycle` is caller-controlled and was being used as a raw index —
    // the SAME prototype-lookup hole the `tier` allowlist below was added to
    // close, left open on the sibling key. `PRICE_MAP["constructor"]` is
    // truthy, so `if (!cycle)` waved it through and the checkout carried on
    // with `Function` standing in for the price table. Validate it the same way.
    const ALLOWED_CYCLES = ["monthly", "annual", "one_time"] as const;
    if (!ALLOWED_CYCLES.includes(billing_cycle)) {
      throw new Error(`Invalid billing_cycle. Use: ${ALLOWED_CYCLES.join(", ")}`);
    }
    const cycle = PRICE_MAP[billing_cycle as (typeof ALLOWED_CYCLES)[number]];
    if (!cycle) throw new Error("Invalid billing_cycle. Use: monthly, annual, or one_time");
    // Validate `tier` against an explicit allowlist BEFORE using it as an index.
    // Two reasons, both real: (1) the old check was `if (!priceId)` on a raw
    // `cycle[tier]` lookup, so an inherited key like "constructor" or
    // "__proto__" resolved to something truthy-but-not-a-price and was handed
    // to Stripe as `line_items[0].price`; (2) the old error message said "Use:
    // pro or elite" while `basic` has been a valid, live-priced tier for some
    // time — a caller debugging a Basic checkout was told their correct input
    // was invalid.
    const ALLOWED_TIERS = ["basic", "pro", "plus", "elite"] as const;
    if (!ALLOWED_TIERS.includes(tier)) {
      throw new Error(`Invalid tier. Use: ${ALLOWED_TIERS.join(", ")}`);
    }
    const priceId = cycle[tier as (typeof ALLOWED_TIERS)[number]];
    if (!priceId) throw new Error(`No Stripe price configured for tier "${tier}" on the ${billing_cycle} cycle.`);

    // ── Cross-platform guard: no second subscription through Stripe ────────
    // The owner's rule for holding both an Apple and a Stripe membership is to
    // PREVENT IT AT PURCHASE TIME (2026-09-05), and this is the server half of
    // it. The iOS client asks the same RPC before opening the purchase sheet,
    // but a client check is a courtesy, not a guard — this one runs where the
    // Checkout Session is actually created and cannot be skipped.
    //
    // Deliberately BEFORE the Stripe customer lookup below: it is one query
    // against our own database versus up to 100 customer records plus a
    // subscription list per record, and there is no reason to pay for that on
    // behalf of someone who is not allowed to buy.
    //
    // This complements rather than replaces the existing active-Stripe-
    // subscription check further down. That one asks Stripe "does this email
    // already have a live subscription"; this one asks our own row "is Apple
    // the authority here". Neither can see what the other sees.
    //
    // The RPC must run AS THE CALLER, and that needs the caller's JWT attached
    // to the client — `supabaseClient` above is built from the anon key with no
    // Authorization header, so it authenticates as `anon`.
    //
    // This shipped broken on 2026-09-05 and blocked EVERY membership purchase.
    // The migration deliberately revokes anon and grants EXECUTE only to
    // `authenticated`, so calling it as anon raised 42501 insufficient_privilege,
    // the fail-closed branch returned 503, and the storefront's Upgrade button
    // did nothing at all. The comment here even asserted it ran as the caller,
    // which made the bug read as impossible.
    //
    // A request-scoped client is the fix: same anon key, plus this request's
    // Authorization header, so PostgREST sees the member's JWT and auth.uid()
    // resolves to them.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: eligibility, error: eligibilityErr } = await callerClient
      .rpc("subscription_purchase_eligibility", { p_platform: "stripe" });
    if (eligibilityErr) {
      // Fail CLOSED. A purchase we cannot prove is allowed is exactly the one
      // that produces a double charge, and the recovery for a wrongly-blocked
      // checkout is a retry, while the recovery for a wrongly-allowed one is a
      // refund and a support ticket.
      console.error("[create-pro-checkout] eligibility check failed:", eligibilityErr);
      return new Response(
        JSON.stringify({ error: "We couldn't confirm your membership status. Please try again in a moment." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }
    const verdict = eligibility as { allowed?: boolean; reason?: string } | null;
    if (verdict && verdict.allowed === false) {
      return new Response(
        JSON.stringify({ error: verdict.reason ?? "You already have an active membership." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // `limit: 1` here was the same bug check-pro-subscription:62-65 already
    // fixed and documented: a user can hold MULTIPLE Stripe customer records
    // for one email, and list() returns an arbitrary one. If the active
    // subscription lived on any other record, the "already subscribed" guard
    // below never fired, we tried to open a second checkout, Stripe rejected
    // it, and the catch masked that as a 500. An audit reproduced it five
    // times out of five on a subscribed account.
    //
    // Mirror the sibling function: consider EVERY customer record for the
    // email, and treat an active subscription on any of them as subscribed.
    const customers = await stripe.customers.list({ email: user.email, limit: 100 });
    let customerId;
    if (customers.data.length > 0) {
      // Prefer a record that actually carries the active subscription, so the
      // checkout attaches to the right customer rather than an empty duplicate.
      customerId = customers.data[0].id;
      if (billing_cycle !== "one_time") {
        for (const customer of customers.data) {
          const subs = await stripe.subscriptions.list({ customer: customer.id, status: "active", limit: 10 });
          if (subs.data.length > 0) {
            return new Response(JSON.stringify({ error: "You already have an active subscription. Manage it from the portal to switch tiers." }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            });
          }
        }
      }
    }

    const isOneTime = billing_cycle === "one_time";

    // Build subscription data with optional billing anchor day (only for recurring)
    // Stamp the user onto the SUBSCRIPTION itself, not just the Session.
    // customer.subscription.updated/deleted events carry the subscription, not
    // the session, so without this they had nothing to resolve a user by and
    // fell back to matching `profiles.email` — a column with NO unique
    // constraint, so a renewal could hit zero rows or several. Now every
    // lifecycle event can resolve the exact account.
    const subscriptionData: Record<string, any> = {
      metadata: { user_id: user.id, tier },
    };
    if (!isOneTime && billing_day && billing_day >= 1 && billing_day <= 28) {
      subscriptionData.billing_cycle_anchor_config = { day_of_month: billing_day };
    }

    const sessionParams: any = {
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isOneTime ? "payment" : "subscription",
      success_url: buildRedirectUrl(`/profile?pro=success`, isNative),
      cancel_url: buildRedirectUrl(`/profile?pro=cancel`, isNative),
      // Stamp the buyer's user_id so the webhook can grant the tier by primary
      // key. Without it the webhook could only match on `.eq("email", …)`, and
      // profiles.email carries no unique constraint — a case variant or a stale
      // unconfirmed signup sharing the address would have taken the paid tier
      // from someone else's payment. client_reference_id survives on the
      // Session; the metadata copy covers the one-time/payment_intent path.
      client_reference_id: user.id,
      metadata: { tier, billing_cycle, user_id: user.id },
      automatic_tax: { enabled: true },
    };

    if (!isOneTime) {
      sessionParams.subscription_data = subscriptionData;
    }

    // For one-time, store tier info in payment metadata so webhook can update profile
    if (isOneTime) {
      sessionParams.payment_intent_data = { metadata: { tier, billing_cycle: "one_time", user_id: user.id } };
    }

    const session = await stripe.checkout.sessions.create(sessionParams, {
      // Include billing_cycle: the same user+tier at a different cycle
      // (monthly ↔ annual ↔ one_time) is a DIFFERENT priced checkout, so it must
      // not collide with a prior cycle's cached session inside Stripe's 24h key
      // window and replay the wrong amount.
      idempotencyKey: `pro:${user.id}:${tier}:${billing_cycle}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[create-pro-checkout] error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
