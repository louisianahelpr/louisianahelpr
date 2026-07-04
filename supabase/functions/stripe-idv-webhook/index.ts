import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_IDV_WEBHOOK_SECRET");

  if (!stripeKey) {
    console.error("[stripe-idv-webhook] STRIPE_SECRET_KEY not set — acknowledging to stop retries");
    return new Response(JSON.stringify({ received: true, error: "stripe_key_not_configured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!webhookSecret) {
    // Return 200 so Stripe stops retrying — same pattern as stripe-webhook.
    // A 500 here causes Stripe to retry every IDV event indefinitely, filling
    // logs and burning the retry budget.
    console.error("[stripe-idv-webhook] STRIPE_IDV_WEBHOOK_SECRET not set — acknowledging to stop retries");
    return new Response(JSON.stringify({ received: true, error: "webhook_secret_not_configured" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2025-08-27.basil",
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
  );

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    // Return 200 (not 401) — no-sig requests are either misconfigured
    // clients or probes. A 401 causes Stripe to retry 14+ times over 3
    // days; 200 stops the storm immediately.
    console.error("[stripe-idv-webhook] Missing stripe-signature header — acknowledging to stop retries");
    return new Response(JSON.stringify({ received: true, error: "missing_signature_header" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    // Return 200 (not 400) to stop Stripe from retrying. A signature failure
    // here means either a wrong secret or a tampered payload — neither is
    // fixable by retrying. Log loudly so ops can diagnose config issues.
    console.error("[stripe-idv-webhook] Signature verification failed:", err);
    return new Response(JSON.stringify({ received: true, error: "signature_verification_failed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        console.warn("[stripe-idv-webhook] No user_id in metadata", session.id);
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
          updateData.legacy_manual_review = false;
        } else {
          updateData.idv_status = "manual_review";
          updateData.idv_failure_reason = `Auto-approve threshold not met (${confidence} < ${threshold})`;
          updateData.legacy_manual_review = true;
        }
      } else if (event.type === "identity.verification_session.requires_input") {
        updateData.idv_status = "failed";
        updateData.idv_failure_reason = session.last_error?.reason || "Verification could not be completed";
        updateData.legacy_manual_review = true;
      } else if (event.type === "identity.verification_session.processing") {
        updateData.idv_status = "processing";
      } else if (event.type === "identity.verification_session.canceled") {
        updateData.idv_status = "failed";
        updateData.idv_failure_reason = "User canceled verification";
        updateData.legacy_manual_review = true;
      }

      const { error: updErr } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("user_id", userId);

      if (updErr) {
        // Throwing here routes into the outer catch which fires postSlackOpsAlert.
        // A silent log would permanently lose the IDV status update with no operator alert.
        throw updErr;
      }

      // Notify user + admins
      const status = updateData.idv_status as string;
      if (status === "verified") {
        // 1) In-app notification (auto-triggers browser push via useRealtimePush)
        await supabase.from("notifications").insert({
          user_id: userId,
          title: "✅ Verification Successful",
          message: "Your identity has been verified! You're cleared to start using Helpr.",
          type: "success",
          link: "/dashboard",
        });

        // 2) Branded "Verification Successful" email (server-to-server with service role)
        try {
          await supabase.functions.invoke("send-account-status-email", {
            body: { userId, status: "verified" },
            headers: {
              Authorization: `Bearer ${(Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!}`,
            },
          });
        } catch (emailErr) {
          console.error("[stripe-idv-webhook] Verification email dispatch failed:", emailErr);
        }
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
    // Return 200 (not 500) so Stripe stops retrying. Processing errors are
    // logged for investigation; retrying a DB/logic error won't fix it.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-idv-webhook] Processing error:", err);
    postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "warning",
      title: "Stripe IDV webhook processing error",
      message: `Failed to process IDV event \`${(event as Stripe.Event | undefined)?.type ?? "unknown"}\`: ${message}`,
      fields: {
        "Event ID": (event as Stripe.Event | undefined)?.id ?? "—",
        Error: message.slice(0, 200),
      },
    });
    return new Response(JSON.stringify({ received: true, error: "processing_error" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
