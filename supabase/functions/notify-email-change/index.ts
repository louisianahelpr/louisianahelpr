import * as React from "npm:react@18.3.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { FROM_DEFAULT, sendWithResend } from "../_shared/resend.ts";
import { SelfEmailChangeNoticeEmail } from "../_shared/email-templates/email-changed.tsx";
import { renderEmail } from "../_shared/email-templates/render.ts";

/**
 * notify-email-change — sends an "email address changed" notification to
 * the OLD address when a user changes their email through the self-service
 * flow in SecurityTab. Supabase's own `updateUser({ email })` only mails a
 * confirmation to the NEW address, which is an account-takeover risk: an
 * attacker who briefly gets a session can point the login email at their
 * own address and the real owner never hears about it.
 *
 * The client calls this AFTER `supabase.auth.updateUser({ email })` returns
 * success. We authenticate via the caller's JWT, treat that user's CURRENT
 * auth.users.email as the "old address" to notify, and email it a heads-up
 * with a contact link if it wasn't them. Best-effort — a failure here must
 * not block the actual email change, which has already been requested via
 * Supabase Auth. Mirrors the format of admin-update-email's notification.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rl = await checkRateLimit(req, {
    windowMs: 300_000,
    maxRequests: 5,
    keyPrefix: "notify-email-change",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user?.email) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const oldEmail = userRes.user.email;

    const body = await req.json().catch(() => ({}));
    const newEmail = typeof body?.newEmail === "string" ? body.newEmail.trim() : "";
    // `newEmail` is caller-supplied and is rendered into an HTML email delivered to
    // the account owner's real inbox from noreply@louisianahelpr.com. Reject anything
    // that is not a plausible address before it reaches the template — escaping alone
    // would still let an attacker post prose into a security notice.
    if (newEmail && !/^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/.test(newEmail)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!newEmail || newEmail === oldEmail) {
      // Nothing meaningful to notify — silently succeed.
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("[notify-email-change] RESEND_API_KEY missing — cannot notify old address");
      return new Response(JSON.stringify({ success: false, error: "Email service unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Both parts come from ONE react-email component: `renderEmail` returns the
    // HTML and react-email's own plaintext twin, so the two can never drift —
    // the hand-written text body this replaced had already lost the "was this
    // you / was this NOT you" guidance the HTML carried. React escapes both
    // addresses; the shape check above is the layer that actually keeps prose
    // out of a Helpr-branded security notice.
    const { html, text } = await renderEmail(
      React.createElement(SelfEmailChangeNoticeEmail, { oldEmail, newEmail }),
    );

    try {
      await sendWithResend(resendApiKey, {
        to: oldEmail,
        from: FROM_DEFAULT,
        subject: "Your Helpr email address is being changed",
        html,
        text,
      });
    } catch (sendErr) {
      // sendWithResend throws on any non-2xx (it does not hand back a Response),
      // so the failure path that used to read `!resp.ok` lives here now.
      const detail = sendErr instanceof Error ? sendErr.message : String(sendErr);
      console.error("[notify-email-change] Resend send failed:", detail);
      return new Response(JSON.stringify({ success: false, error: "Notification send failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-email-change] error:", err);
    return new Response(JSON.stringify({ success: false, error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
