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
    if (!authHeader) throw new Error("Not authenticated");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseClient.auth.getUser(token);
    const user = userData.user;
    if (!user) throw new Error("Not authenticated");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("idv_status, idv_session_id, full_name, role")
      .eq("user_id", user.id)
      .single();

    // Already verified — short-circuit
    if (profile?.idv_status === "verified") {
      return new Response(JSON.stringify({ alreadyVerified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const origin = req.headers.get("origin") || "https://www.louisianahelpr.com";

    // Reuse existing pending session if it exists and is still usable
    if (profile?.idv_session_id && (profile.idv_status === "processing" || profile.idv_status === "pending")) {
      try {
        const existing = await stripe.identity.verificationSessions.retrieve(profile.idv_session_id);
        if (existing.status === "requires_input" && existing.url) {
          return new Response(JSON.stringify({ url: existing.url, sessionId: existing.id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
      } catch (_e) {
        // fall through to create a new session
      }
    }

    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      provided_details: { email: user.email ?? undefined },
      metadata: {
        user_id: user.id,
        full_name: profile?.full_name ?? "",
        role: profile?.role ?? "",
      },
      options: {
        document: {
          require_matching_selfie: true,
          require_live_capture: true,
          allowed_types: ["driving_license", "passport", "id_card"],
        },
      },
      return_url: `${origin}/profile?idv=complete`,
    });

    await supabaseAdmin
      .from("profiles")
      .update({
        idv_session_id: session.id,
        idv_status: "pending",
        idv_attempted_at: new Date().toISOString(),
      } as any)
      .eq("user_id", user.id);

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("stripe-idv-start error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
