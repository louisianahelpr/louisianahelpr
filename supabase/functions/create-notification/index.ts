import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Allowlist of notification.type values. Kept in sync with the DB CHECK
// constraint defined in supabase/migrations/20260510032410_message_notifications.sql
// (notifications_type_check). Reject anything else to prevent spoofers from
// laundering arbitrary copy through unknown / cosmetic types.
const ALLOWED_TYPES = new Set([
  "info",
  "success",
  "warning",
  "job_update",
  "application",
  "review",
  "payment",
  "job_match",
  "job_updates",
  "work_status",
  "transit_updates",
  "system_alert",
  "new_offers",
  "expired",
  "financial_alerts",
  "verified",
  "message",
]);

// Same-origin path check: link must be a server-relative path (starts with `/`,
// not `//` which would be protocol-relative), contains no scheme separator,
// no backslashes (Windows path tricks), no whitespace. Rejecting these prevents
// an attacker from injecting `https://evil.com` or `javascript:` into the
// in-app notification link.
function sanitizeLink(link: unknown): string | null {
  if (link == null) return null;
  if (typeof link !== "string") return null;
  if (link.length === 0) return null;
  if (link.length > 2048) return null;
  if (!link.startsWith("/")) return null;
  if (link.startsWith("//")) return null;
  if (link.includes("://")) return null;
  if (link.includes("\\")) return null;
  if (/\s/.test(link)) return null;
  return link;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!;
    const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

    // Verify the user is authenticated using the anon client
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id, title, message, type = "info", link = null } = await req.json();

    // Validate required fields
    if (!user_id || !title || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields: user_id, title, message" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate input lengths
    if (title.length > 200 || message.length > 1000) {
      return new Response(JSON.stringify({ error: "Title or message too long" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: a regular user may only create notifications for themselves.
    // Admins may target any user (e.g. system-wide announcements). Without this
    // check, any signed-up user could POST {user_id: <anyone>, ...} and spoof
    // a notification branded as Helpr to any other user.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    if (user_id !== user.id) {
      const { data: isAdmin, error: roleErr } = await adminClient.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (roleErr || !isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Validate notification type — DB has a CHECK constraint, but rejecting
    // here gives a clean 400 instead of a generic 500 and stops typos from
    // reaching the DB at all.
    if (typeof type !== "string" || !ALLOWED_TYPES.has(type)) {
      return new Response(JSON.stringify({ error: "Invalid notification type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitize link to a same-origin path. If a non-null link was provided
    // and failed the check, reject the request rather than silently dropping
    // it — silent drops produce a confusing notification with no destination.
    let sanitizedLink: string | null = null;
    if (link != null) {
      sanitizedLink = sanitizeLink(link);
      if (sanitizedLink === null) {
        return new Response(JSON.stringify({ error: "Invalid link: must be a same-origin path starting with /" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { error: insertError } = await adminClient.from("notifications").insert({
      user_id,
      title,
      message,
      type,
      link: sanitizedLink,
    });

    if (insertError) {
      console.error("Failed to create notification:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create notification" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Create notification error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
