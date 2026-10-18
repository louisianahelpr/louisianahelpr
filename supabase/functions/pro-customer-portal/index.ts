import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
  );

  try {
    // Read once: native callers get a return URL the app can intercept.
    const isNative = isNativeRequest(await req.json().catch(() => ({})));
    const authHeader = req.headers.get("Authorization");
    // Every auth failure answers 401 (Q255 / bus EF-010). They used to throw
    // into the catch below and answer 500 "Internal server error", so an
    // expired session read as a broken billing portal.
    const unauthorized = () =>
      new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    if (!authHeader) return unauthorized();

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) {
      console.error("[pro-customer-portal] auth.getUser error:", userError.message);
      return unauthorized();
    }
    const user = userData.user;
    if (!user?.email) return unauthorized();
    // Q837: an unconfirmed-email caller is refused here, as Q807 refuses at
    // the table (that gate cannot see the caller behind a service-role write).
    const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders);
    if (unconfirmedEmail) return unconfirmedEmail;

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // WHICH Stripe customer (Q2142, lh-money-escrow review of 2340db8b7 #1):
    // the one the member's subscription names, stored on their profile by
    // stripe-webhook when the plan was granted (subscriptionLinkage.ts,
    // profiles.stripe_customer_id), read by the member's own user id. NEVER by
    // email: this used to list every customer on the caller's address and open
    // the first that carried a subscription, and an address reused by a new
    // account (measured 2026-10-18: 3 of 7 live customers carry an email now
    // owned by a newer account) could open the portal on a deleted member's
    // customer. A member whose subscription sits on a customer under another
    // email is found too, because the profile names it.
    //
    // Q2141 (one wallet): the portal opens ONLY on a customer that carries a
    // subscription, in ANY state (`all`: past_due, unpaid, cancel-at-period-end
    // members need the portal most). The one-wallet customer without one is
    // never opened: a card added in the portal becomes that customer's default
    // card, the card auto-tip charges off-session.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    // A read that fails is a 500 (the catch below), never "no billing found".
    if (profileError) throw new Error(`profile read failed: ${profileError.message}`);
    const stored = (profile as { stripe_customer_id?: unknown } | null)?.stripe_customer_id;
    let customerId: string | null = null;
    if (typeof stored === "string" && /^cus_[A-Za-z0-9]+$/.test(stored)) {
      const subs = await stripe.subscriptions.list({ customer: stored, status: "all", limit: 1 });
      if (subs.data.length > 0) customerId = stored;
    }
    if (!customerId) {
      return new Response(JSON.stringify({ error: "No membership billing found for this account." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: buildRedirectUrl(`/profile`, isNative),
    });

    return new Response(JSON.stringify({ url: portalSession.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[pro-customer-portal] error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
