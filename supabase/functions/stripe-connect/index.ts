import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("Not authenticated");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const body = await req.json();
    const { action } = body;

    // ─── CREATE / RESUME ONBOARDING ───
    if (action === "onboard") {
      // Check if helper already has a Stripe Connect account
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id, full_name, phone, date_of_birth, location")
        .eq("user_id", user.id)
        .single();

      let accountId = profile?.stripe_account_id;

      if (!accountId) {
        // Parse name
        const nameParts = (profile?.full_name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.slice(1).join(" ") || undefined;

        // Parse DOB
        let dob: { day: number; month: number; year: number } | undefined;
        if (profile?.date_of_birth) {
          const d = new Date(profile.date_of_birth);
          dob = { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
        }

        // Parse city/state from location (e.g. "Baton Rouge, LA")
        const locParts = (profile?.location || "").split(",").map((s: string) => s.trim());
        const city = locParts[0] || undefined;
        const state = locParts[1] || undefined;

        const account = await stripe.accounts.create({
          type: "express",
          email: user.email,
          business_type: "individual",
          individual: {
            first_name: firstName,
            last_name: lastName,
            email: user.email,
            phone: profile?.phone || undefined,
            dob,
            address: city ? { city, state, country: "US" } : undefined,
          },
          capabilities: {
            transfers: { requested: true },
          },
          metadata: { user_id: user.id },
        });
        accountId = account.id;

        // Save account ID to profile
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_account_id: accountId })
          .eq("user_id", user.id);
      }

      // Create an account link for onboarding
      const origin = req.headers.get("origin") || "https://louisianahelpr.lovable.app";
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${origin}/profile?tab=payment&connect=refresh`,
        return_url: `${origin}/profile?tab=payment&connect=success`,
        type: "account_onboarding",
      });

      return new Response(JSON.stringify({ url: accountLink.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── CHECK ACCOUNT STATUS ───
    if (action === "status") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (!profile?.stripe_account_id) {
        return new Response(JSON.stringify({ connected: false, details_submitted: false, payouts_enabled: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const account = await stripe.accounts.retrieve(profile.stripe_account_id);

      return new Response(JSON.stringify({
        connected: true,
        details_submitted: account.details_submitted,
        payouts_enabled: account.payouts_enabled,
        charges_enabled: account.charges_enabled,
        account_id: account.id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── CREATE LOGIN LINK (for returning to Stripe dashboard) ───
    if (action === "dashboard") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (!profile?.stripe_account_id) {
        throw new Error("No Stripe account connected");
      }

      const loginLink = await stripe.accounts.createLoginLink(profile.stripe_account_id);

      return new Response(JSON.stringify({ url: loginLink.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    throw new Error("Invalid action");
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});