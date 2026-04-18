import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PayoutSummary {
  connected: boolean;
  payouts_enabled: boolean;
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
  instant_available?: { amount: number; currency: string }[];
  payouts: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    arrival_date: number;
    method: string;
    created: number;
    description: string | null;
  }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabaseClient.auth.getUser(token);
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    const user = userData.user;

    // Look up Stripe Connect account from profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id")
      .eq("user_id", user.id)
      .single();

    const accountId = profile?.stripe_account_id;

    const empty: PayoutSummary = {
      connected: false,
      payouts_enabled: false,
      available: [],
      pending: [],
      payouts: [],
    };

    if (!accountId) {
      return new Response(JSON.stringify(empty), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Fetch account status, balance and recent payouts in parallel
    const [account, balance, payoutsList] = await Promise.all([
      stripe.accounts.retrieve(accountId),
      stripe.balance.retrieve({ stripeAccount: accountId }),
      stripe.payouts.list({ limit: 20 }, { stripeAccount: accountId }),
    ]);

    const result: PayoutSummary = {
      connected: true,
      payouts_enabled: !!account.payouts_enabled,
      available: balance.available.map((b) => ({ amount: b.amount, currency: b.currency })),
      pending: balance.pending.map((b) => ({ amount: b.amount, currency: b.currency })),
      instant_available: balance.instant_available?.map((b) => ({ amount: b.amount, currency: b.currency })),
      payouts: payoutsList.data.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        arrival_date: p.arrival_date,
        method: p.method,
        created: p.created,
        description: p.description,
      })),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stripe-payouts] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
