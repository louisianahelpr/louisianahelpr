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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Not authenticated");
    const userId = userData.user.id;

    // Get user's Stripe Connect account
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("user_id", userId)
      .single();

    if (!profile?.stripe_account_id) {
      return new Response(
        JSON.stringify({ error: "You need to connect a Stripe account before cashing out. Go to your Profile to set this up." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Get unredeemed credits
    const { data: credits, error: creditsError } = await supabase
      .from("referral_credits")
      .select("id, amount")
      .eq("user_id", userId)
      .eq("redeemed", false);

    if (creditsError) throw new Error("Failed to load credits");
    if (!credits || credits.length === 0) {
      return new Response(
        JSON.stringify({ error: "No available credits to cash out." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const totalAmount = credits.reduce((sum, c) => sum + Number(c.amount), 0);
    const totalCents = Math.round(totalAmount * 100);

    if (totalCents < 100) {
      return new Response(
        JSON.stringify({ error: "Minimum cash-out amount is $1.00." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Create Stripe transfer to connected account
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const transfer = await stripe.transfers.create({
      amount: totalCents,
      currency: "usd",
      destination: profile.stripe_account_id,
      description: `Helpr referral credit cash-out ($${totalAmount.toFixed(2)})`,
    });

    // Mark all credits as redeemed
    const creditIds = credits.map((c) => c.id);
    await supabase
      .from("referral_credits")
      .update({ redeemed: true })
      .in("id", creditIds);

    // Notify user
    await supabase.from("notifications").insert({
      user_id: userId,
      title: "Cash-out successful!",
      message: `$${totalAmount.toFixed(2)} in referral credits has been sent to your connected Stripe account.`,
      type: "payment",
      link: "/profile",
    });

    return new Response(
      JSON.stringify({
        success: true,
        amount: totalAmount,
        transfer_id: transfer.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[CASH-OUT-CREDITS] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
