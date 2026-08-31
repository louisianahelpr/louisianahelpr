import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { htmlEscape } from "../_shared/safe-strings.ts";
import { FROM_DEFAULT, SUPPORT_EMAIL, sendWithResend } from "../_shared/resend.ts";
import { emailH1, emailP, emailShell, supportLink, transactionalFooter } from "../_shared/emailLayout.ts";

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

    const html = emailShell({
      preheader: "Your Helpr login email is being changed — confirm it was you.",
      title: "Your email address was changed",
      body: [
        emailH1("Your email address was changed"),
        emailP(`Someone signed in to your Helpr account and started changing your login email from <strong>${htmlEscape(oldEmail)}</strong> to <strong>${htmlEscape(newEmail)}</strong>. To finalize the change, the new address will need to confirm the request.`),
        emailP("<strong>Was this you?</strong> No action needed — the confirmation link was sent to your new address."),
        emailP(`<strong>Was this NOT you?</strong> Reset your password immediately and contact us at ${supportLink()}.`),
        transactionalFooter(`Questions? Contact us at ${SUPPORT_EMAIL}.`),
      ].join("\n"),
    });
    const text = `Your Helpr account email is being changed from ${oldEmail} to ${newEmail}. If this was NOT you, reset your password and contact ${SUPPORT_EMAIL} immediately.`;

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
