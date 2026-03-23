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

    // Helper: get or create Connect account
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

        const account = await stripe.accounts.create({
          type: "express",
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
          },
          capabilities: {
            transfers: { requested: true },
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

    // ─── ONBOARD: Create account + return Account Link URL ───
    if (action === "onboard") {
      const { return_url } = body;
      const { accountId } = await getOrCreateAccount();

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: return_url || "https://louisianahelpr.lovable.app/profile",
        return_url: return_url || "https://louisianahelpr.lovable.app/profile",
        type: "account_onboarding",
        collection_options: {
          fields: "currently_due",
          future_requirements: "omit",
        },
      });

      return new Response(JSON.stringify({ success: true, url: accountLink.url, account_id: accountId }), {
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
        type: m.object,
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
      const transfersCapability = account.capabilities?.transfers;

      return new Response(JSON.stringify({
        connected: true,
        details_submitted: account.details_submitted ?? false,
        payouts_enabled: account.payouts_enabled ?? false,
        charges_enabled: account.charges_enabled,
        transfers_status: transfersCapability || "inactive",
        requirements: account.requirements?.currently_due || [],
        account_id: account.id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── DASHBOARD: Manage payout account ───
    if (action === "dashboard") {
      const { return_url } = body;
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      // Sync email to Stripe account before redirecting
      await stripe.accounts.update(profile.stripe_account_id, {
        email: user.email,
        individual: { email: user.email },
      });

      const account = await stripe.accounts.retrieve(profile.stripe_account_id);

      if (account.type === "express") {
        const loginLink = await stripe.accounts.createLoginLink(profile.stripe_account_id);
        return new Response(JSON.stringify({ url: loginLink.url }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      } else {
        const accountLink = await stripe.accountLinks.create({
          account: profile.stripe_account_id,
          refresh_url: return_url || "https://louisianahelpr.lovable.app/profile",
          return_url: return_url || "https://louisianahelpr.lovable.app/profile",
          type: "account_onboarding",
        });
        return new Response(JSON.stringify({ url: accountLink.url }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    // ─── RESET: Delete old account and create fresh Express one ───
    if (action === "reset") {
      const { return_url } = body;
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (profile?.stripe_account_id) {
        try {
          await stripe.accounts.del(profile.stripe_account_id);
        } catch (e) {
          console.log("Could not delete old account:", e.message);
        }
      }

      await supabaseAdmin
        .from("profiles")
        .update({ stripe_account_id: null })
        .eq("user_id", user.id);

      const { accountId } = await getOrCreateAccount();

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: return_url || "https://louisianahelpr.lovable.app/profile",
        return_url: return_url || "https://louisianahelpr.lovable.app/profile",
        type: "account_onboarding",
      });

      return new Response(JSON.stringify({ success: true, url: accountLink.url, account_id: accountId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ─── UPDATE ONBOARDING: Return new Account Link for incomplete accounts ───
    if (action === "update_onboarding") {
      const { return_url } = body;
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", user.id)
        .single();

      if (!profile?.stripe_account_id) throw new Error("No account connected");

      const accountLink = await stripe.accountLinks.create({
        account: profile.stripe_account_id,
        refresh_url: return_url || "https://louisianahelpr.lovable.app/profile",
        return_url: return_url || "https://louisianahelpr.lovable.app/profile",
        type: "account_onboarding",
      });

      return new Response(JSON.stringify({ url: accountLink.url }), {
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
