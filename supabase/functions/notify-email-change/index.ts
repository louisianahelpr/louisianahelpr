import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { brand } from '../_shared/email-templates/styles.ts'

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

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="background-color:${brand.parchment};font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:24px">
<div style="max-width:480px;margin:0 auto;background:${brand.surface};border-radius:14px;padding:32px 28px;border:1px solid ${brand.hairline}">
  <img src="https://www.louisianahelpr.com/helpr-wordmark.png" alt="Louisiana Helpr" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />
  <h1 style="font-size:24px;font-weight:bold;color:${brand.inkDeep};margin:0 0 16px">Your email address was changed</h1>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">Someone signed in to your Helpr account and started changing your login email from <strong>${oldEmail}</strong> to <strong>${newEmail}</strong>. To finalize the change, the new address will need to confirm the request.</p>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px"><strong>Was this you?</strong> No action needed — the confirmation link was sent to your new address.</p>
  <p style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px"><strong>Was this NOT you?</strong> Reset your password immediately and contact us at <a href="mailto:admin@louisianahelpr.com" style="color:${brand.burntSienna}">admin@louisianahelpr.com</a>.</p>
  <p style="font-size:13px;color:${brand.bodyOlive};line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid ${brand.hairline}">Questions? Contact us at admin@louisianahelpr.com.</p>
</div>
</body></html>`;
    const text = `Your Helpr account email is being changed from ${oldEmail} to ${newEmail}. If this was NOT you, reset your password and contact admin@louisianahelpr.com immediately.`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Helpr <noreply@louisianahelpr.com>",
        to: [oldEmail],
        subject: "Your Helpr email address is being changed",
        html,
        text,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
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
