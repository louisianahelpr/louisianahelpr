import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2023-10-16",
  });
  const webhookSecret = Deno.env.get("STRIPE_IDV_WEBHOOK_SECRET");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let event: Stripe.Event;
  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");
    if (webhookSecret && sig) {
      event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
    } else {
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err) {
    console.error("Webhook signature verify failed:", err);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (
      event.type === "identity.verification_session.verified" ||
      event.type === "identity.verification_session.requires_input" ||
      event.type === "identity.verification_session.processing" ||
      event.type === "identity.verification_session.canceled"
    ) {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      const userId = session.metadata?.user_id;
      if (!userId) {
        console.warn("No user_id in metadata", session.id);
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Pull settings for threshold
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("idv_auto_approve_threshold")
        .single();
      const threshold = Number(settings?.idv_auto_approve_threshold ?? 85);

      let updateData: Record<string, unknown> = { idv_session_id: session.id };

      if (event.type === "identity.verification_session.verified") {
        // Stripe Identity returns "verified" as a binary outcome. We compute a
        // confidence score from selfie + document signals when available.
        const verified = await stripe.identity.verificationSessions.retrieve(
          session.id,
          { expand: ["last_verification_report"] }
        );
        const report = verified.last_verification_report as Stripe.Identity.VerificationReport | null;

        // Heuristic confidence: 100 if document + selfie both verified with no errors,
        // 90 if minor issues, otherwise fall back to manual review.
        let confidence = 100;
        if (report?.document?.error || report?.selfie?.error) confidence = 60;
        else if (!report?.selfie) confidence = 80;

        updateData.idv_confidence = confidence;

        if (confidence >= threshold) {
          updateData.idv_status = "verified";
          updateData.approval_status = "approved";
          updateData.idv_failure_reason = null;
        } else {
          updateData.idv_status = "manual_review";
          updateData.idv_failure_reason = `Auto-approve threshold not met (${confidence} < ${threshold})`;
        }
      } else if (event.type === "identity.verification_session.requires_input") {
        updateData.idv_status = "failed";
        updateData.idv_failure_reason = session.last_error?.reason || "Verification could not be completed";
      } else if (event.type === "identity.verification_session.processing") {
        updateData.idv_status = "processing";
      } else if (event.type === "identity.verification_session.canceled") {
        updateData.idv_status = "failed";
        updateData.idv_failure_reason = "User canceled verification";
      }

      const { error: updErr } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("user_id", userId);

      if (updErr) {
        console.error("Profile update failed:", updErr);
      }

      // Notify user + admins
      const status = updateData.idv_status as string;
      if (status === "verified") {
        await supabase.from("notifications").insert({
          user_id: userId,
          title: "✅ Identity verified!",
          message: "Your account is approved. Welcome to Helpr!",
          type: "success",
          link: "/dashboard",
        });
      } else if (status === "manual_review" || status === "failed") {
        // Flag admins
        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");

        if (admins?.length) {
          const reason = status === "failed" ? "failed automated verification" : "needs manual review";
          await supabase.from("notifications").insert(
            admins.map((a: { user_id: string }) => ({
              user_id: a.user_id,
              title: "⚠️ Identity verification needs review",
              message: `A user ${reason}. Tap to review.`,
              type: "warning",
              link: "/admin",
            }))
          );
        }

        await supabase.from("notifications").insert({
          user_id: userId,
          title: "Verification under review",
          message: "We couldn't auto-verify your ID. Our team will review it within 24 hours.",
          type: "info",
          link: "/account-pending",
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
