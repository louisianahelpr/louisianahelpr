import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;

    // Check hybrid IDV is enabled
    const { data: settings } = await admin
      .from("platform_settings")
      .select("hybrid_idv_enabled")
      .single();

    if (!settings?.hybrid_idv_enabled) {
      return new Response(
        JSON.stringify({ error: "Automated verification is currently disabled. Your application will be reviewed manually." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enforce single-attempt rule
    const { data: profile } = await admin
      .from("profiles")
      .select("idv_status, idv_session_id, legacy_manual_review, full_name, email")
      .eq("user_id", userId)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (profile.legacy_manual_review) {
      return new Response(
        JSON.stringify({ error: "Your application is on the manual review queue." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Block if already verified or already attempted (single-attempt)
    if (profile.idv_status === "verified") {
      return new Response(JSON.stringify({ error: "Already verified" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (["pending", "processing", "failed", "manual_review"].includes(profile.idv_status || "")) {
      return new Response(
        JSON.stringify({ error: "You have already used your verification attempt. An admin will review your submission." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
    });

    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      metadata: { user_id: userId },
      options: {
        document: {
          require_live_capture: true,
          require_matching_selfie: true,
          require_id_number: false,
          allowed_types: ["driving_license", "id_card", "passport"],
        },
      },
      provided_details: profile.email ? { email: profile.email } : undefined,
    });

    await admin
      .from("profiles")
      .update({
        idv_session_id: session.id,
        idv_status: "pending",
        idv_attempted_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return new Response(
      JSON.stringify({ client_secret: session.client_secret, session_id: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-idv-session error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
