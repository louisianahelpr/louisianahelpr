import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getAppUrl } from "../_shared/appUrl.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseClient.auth.getUser(token);
    const user = userData.user;
    if (!user) throw new Error("Not authenticated");

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      // NO `role`: `profiles.role` was DROPPED when accounts were unified
      // (2026-05, see migrations 20260504142454 / 20260505230500) — this app
      // has no poster/helper roles, and admin lives in `user_roles`. Selecting
      // it made PostgREST 400 the whole SELECT, which tripped the profileErr
      // guard below and 500'd the function on EVERY attempt. The user saw
      // "Edge Function returned a non-2xx status code" and identity
      // verification was completely dead.
      .select("idv_status, idv_session_id, full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    // A dropped error here silently bypasses the "already verified" guard below
    // and — critically — can overwrite idv_status:"verified" with "pending" if
    // the SELECT fails but the subsequent UPDATE succeeds (brief DB read fault).
    if (profileErr) {
      throw new Error("Could not load your account right now. Please try again.");
    }

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
      },
      options: {
        document: {
          require_matching_selfie: true,
          require_live_capture: true,
          allowed_types: ["driving_license", "passport", "id_card"],
        },
      },
      return_url: `${getAppUrl()}/profile?idv=complete`,
    });

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({
        idv_session_id: session.id,
        idv_status: "pending",
        idv_attempted_at: new Date().toISOString(),
      } as any)
      .eq("user_id", user.id);
    if (updateErr) {
      // Log and continue — the IDV webhook sets final status via metadata.user_id,
      // but the missing session record breaks the "reuse pending session" guard and
      // leaves the profile showing no in-progress verification.
      console.error("[stripe-idv-start] Failed to store IDV session on profile:", updateErr);
    }

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
