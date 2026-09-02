import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(userError.message);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // EVERY customer record for this email, not just the first.
    //
    // `limit: 1` was the same bug check-pro-subscription:61-67 and
    // create-pro-checkout:74-84 each already found and documented: one person
    // routinely holds MORE THAN ONE Stripe customer record on one address (one
    // minted by Checkout, another by a Connect or test flow), and `list()`
    // returns an arbitrary one. Both siblings were fixed; this one was not.
    //
    // It matters more here than anywhere else, because this function IS the
    // self-serve exit. The Billing Portal is scoped to the customer it is
    // opened for, so opening it on an arbitrary record shows a member whose
    // subscription lives on a DIFFERENT record an empty portal — no plan, no
    // card, nothing to cancel — while Stripe keeps billing them every month.
    // A paying member with no way to stop paying is the worst shape a billing
    // bug can take, so pick the record that actually carries the subscription.
    const customers = await stripe.customers.list({ email: user.email, limit: 100 });
    if (customers.data.length === 0) {
      throw new Error("No Stripe customer found");
    }

    // Prefer a record with a subscription in ANY state — `all` deliberately,
    // not `active`: a member whose subscription is past_due, unpaid, paused or
    // already cancelled-at-period-end is exactly who needs the portal most, and
    // filtering to `active` would send them back to the empty record.
    let customerId = customers.data[0].id;
    if (customers.data.length > 1) {
      for (const customer of customers.data) {
        const subs = await stripe.subscriptions.list({
          customer: customer.id,
          status: "all",
          limit: 1,
        });
        if (subs.data.length > 0) {
          customerId = customer.id;
          break;
        }
      }
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
