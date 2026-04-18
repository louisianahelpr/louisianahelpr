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
        // Map Stripe's raw failure code/reason to a friendly key
        const rawCode = session.last_error?.code || session.last_error?.reason || "";
        const lower = rawCode.toLowerCase();
        let friendlyKey: string = "blurry_photo";
        let friendlyMsg =
          "We couldn't verify your identity — the photo of your ID was a bit blurry. Please try again with better lighting and hold the camera steady.";

        if (lower.includes("expired")) {
          friendlyKey = "expired_id";
          friendlyMsg =
            "It looks like your ID is expired. Please upload a current, valid government-issued ID and try again.";
        } else if (lower.includes("selfie")) {
          friendlyKey = "selfie_mismatch";
          friendlyMsg =
            "Your selfie didn't quite match the photo on your ID. Please retry in a well-lit area, facing the camera directly.";
        } else if (lower.includes("unsupported") || lower.includes("type_not_supported")) {
          friendlyKey = "document_unsupported";
          friendlyMsg =
            "The document you submitted isn't one we can accept. Please use a U.S. driver's license, state ID, or passport.";
        }

        updateData.idv_status = "failed";
        updateData.idv_failure_reason = friendlyMsg;
        updateData.denial_reason = `[${friendlyKey}] ${friendlyMsg}`;
        // Keep approval_status as "pending" (don't auto-deny) — webhook failures
        // are usually retryable image issues; the user gets a "Try Again" CTA.
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
        // 1) In-app notification (auto-triggers browser push via useRealtimePush)
        await supabase.from("notifications").insert({
          user_id: userId,
          title: "✅ Account verified by Helpr Safety Team",
          message: "The account has been verified by the Helpr Safety Team and is cleared to start using Helpr.",
          type: "success",
          link: "/dashboard",
        });

        // 2) Branded "Verification Successful" email (server-to-server with service role)
        try {
          await supabase.functions.invoke("send-account-status-email", {
            body: { userId, status: "verified" },
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            },
          });
        } catch (emailErr) {
          console.error("Verification email dispatch failed:", emailErr);
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

        const userMsg = status === "failed"
          ? (updateData.idv_failure_reason as string) || "We couldn't verify your ID. Please try again."
          : "We couldn't auto-verify your ID. Our team will review it within 24 hours.";
        const userTitle = status === "failed"
          ? "⚠️ Verification needs another try"
          : "Verification under review";

        await supabase.from("notifications").insert({
          user_id: userId,
          title: userTitle,
          message: userMsg,
          type: status === "failed" ? "warning" : "info",
          link: "/account-pending",
        });

        // Trigger the branded denial email with reason + Try Again CTA
        if (status === "failed") {
          try {
            await supabase.functions.invoke("send-account-status-email", {
              body: {
                userId,
                status: "denied",
                reason: updateData.idv_failure_reason,
                canRetry: true,
              },
              headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
              },
            });
          } catch (emailErr) {
            console.error("Denial email dispatch failed:", emailErr);
          }
        }
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
