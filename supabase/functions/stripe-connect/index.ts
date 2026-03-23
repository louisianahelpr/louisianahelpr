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

    // Helper: get or create Custom Connect account
    const getOrCreateAccount = async () => {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id, full_name, phone, date_of_birth, location")
        .eq("user_id", user.id)
        .single();

      let accountId = profile?.stripe_account_id;

      if (!accountId) {
        const nameParts = (profile?.full_name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.slice(1).join(" ") || undefined;

        let dob: { day: number; month: number; year: number } | undefined;
        if (profile?.date_of_birth) {
          const d = new Date(profile.date_of_birth);
          dob = { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
        }

        const locParts = (profile?.location || "").split(",").map((s: string) => s.trim());
        const city = locParts[0] || undefined;
        const state = locParts[1] || undefined;

        const account = await stripe.accounts.create({
          type: "custom",
          country: "US",
          email: user.email,
          business_type: "individual",
          business_profile: {
            mcc: "7299",
            product_description: "Local task and errand services",
          },
          individual: {
            first_name: firstName,
            last_name: lastName,
            email: user.email,
            phone: profile?.phone || undefined,
            dob,
            address: city ? { city, state, country: "US" } : undefined,
            ssn_last_4: ssn_last_4 || undefined,
          },
          capabilities: {
            transfers: { requested: true },
          },
          tos_acceptance: {
            date: Math.floor(Date.now() / 1000),
            ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0",
          },
          settings: {
            payouts: { schedule: { interval: "manual" } },
          },
          metadata: { user_id: user.id },
        });
        accountId = account.id;

        await supabaseAdmin
          .from("profiles")
          .update({ stripe_account_id: accountId })
          .eq("user_id", user.id);
      }

      return { accountId, profile };
    };

    // ─── CREATE CUSTOM ACCOUNT (no redirect needed) ───
    if (action === "onboard") {
      const { accountId } = await getOrCreateAccount();

      // If SSN last 4 provided and account already existed, update it
      if (ssn_last_4) {
        try {
          await stripe.accounts.update(accountId, {
            individual: { ssn_last_4 },
          });
        } catch (_) { /* may already be set */ }
      }

      return new Response(JSON.stringify({ success: true, account_id: accountId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── ADD BANK ACCOUNT ───
    if (action === "add_bank") {
      const { routing_number, account_number, account_holder_name } = body;
      if (!routing_number || !account_number || !account_holder_name) {
        throw new Error("Missing bank account details");
      }

      const { accountId } = await getOrCreateAccount();

      // Create external bank account
      const bankAccount = await stripe.accounts.createExternalAccount(accountId, {
        external_account: {
          object: "bank_account",
          country: "US",
          currency: "usd",
          routing_number,
          account_number,
          account_holder_name,
          account_holder_type: "individual",
        } as any,
      });

      return new Response(JSON.stringify({
        success: true,
        bank_last4: (bankAccount as any).last4,
        bank_name: (bankAccount as any).bank_name,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── ADD DEBIT CARD ───
    if (action === "add_card") {
      const { token: cardToken } = body;
      if (!cardToken) {
        throw new Error("Missing card token");
      }

      const { accountId } = await getOrCreateAccount();

      const card = await stripe.accounts.createExternalAccount(accountId, {
        external_account: cardToken,
      });

      return new Response(JSON.stringify({
        success: true,
        card_last4: (card as any).last4,
        card_brand: (card as any).brand,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── LIST PAYOUT METHODS ───
    if (action === "list_payout_methods") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (!profile?.stripe_account_id) {
        return new Response(JSON.stringify({ methods: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const accounts = await stripe.accounts.listExternalAccounts(profile.stripe_account_id, { limit: 10 });

      const methods = accounts.data.map((m: any) => ({
        id: m.id,
        type: m.object, // "bank_account" or "card"
        last4: m.last4,
        bank_name: m.bank_name || null,
        brand: m.brand || null,
        default_for_currency: m.default_for_currency,
      }));

      return new Response(JSON.stringify({ methods }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── DELETE PAYOUT METHOD ───
    if (action === "delete_payout_method") {
      const { method_id } = body;
      if (!method_id) throw new Error("Missing method_id");

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (!profile?.stripe_account_id) throw new Error("No account connected");

      await stripe.accounts.deleteExternalAccount(profile.stripe_account_id, method_id);

      return new Response(JSON.stringify({ success: true }), {
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

      // Check if they have at least one external account
      const externalAccounts = await stripe.accounts.listExternalAccounts(profile.stripe_account_id, { limit: 1 });
      const hasPayoutMethod = externalAccounts.data.length > 0;

      // Get capability status
      const transfersCapability = account.capabilities?.transfers;

      return new Response(JSON.stringify({
        connected: true,
        details_submitted: hasPayoutMethod,
        payouts_enabled: hasPayoutMethod && (account.payouts_enabled ?? false),
        charges_enabled: account.charges_enabled,
        transfers_status: transfersCapability || "inactive",
        requirements: account.requirements?.currently_due || [],
        account_id: account.id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── DASHBOARD (for Custom accounts, just return status) ───
    if (action === "dashboard") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (!profile?.stripe_account_id) throw new Error("No account connected");

      // Custom accounts don't have Express login links; return to payment tab
      return new Response(JSON.stringify({ url: null, message: "Manage your payout methods in Payment Settings." }), {
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
