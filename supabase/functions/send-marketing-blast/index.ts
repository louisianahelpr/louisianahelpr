// Marketing email blast tool — admin-only.
// Sends a one-off campaign to a segmented user list via Resend (gateway).
// Segments: all | helpers | posters | by_parish.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

interface BlastBody {
  subject: string;
  html: string;
  segment: "all" | "helpers" | "posters" | "by_parish";
  parish?: string;
  test_email?: string; // if present, only send to this address (preview)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

    // Auth: must be admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as BlastBody;
    if (!body.subject?.trim() || !body.html?.trim() || !body.segment) {
      return new Response(JSON.stringify({ error: "subject, html, and segment are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve recipient list
    let recipients: { email: string; full_name: string | null }[] = [];

    if (body.test_email) {
      recipients = [{ email: body.test_email, full_name: "Test" }];
    } else {
      let q = supabase
        .from("profiles")
        .select("email, full_name, role, parish")
        .not("email", "is", null)
        .eq("email_verified", true)
        .eq("approval_status", "approved");

      if (body.segment === "helpers") q = q.eq("role", "helper");
      if (body.segment === "posters") q = q.eq("role", "customer");
      if (body.segment === "by_parish" && body.parish) q = q.eq("parish", body.parish);

      const { data, error } = await q.limit(5000);
      if (error) throw error;

      // Honor email opt-out: drop anyone with email_promotions=false
      const userIds = (data || []).map(r => r.email).filter(Boolean);
      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select("user_id, email_promotions");
      const optedOut = new Set(
        (prefs || []).filter(p => p.email_promotions === false).map(p => p.user_id)
      );

      // Cross-check by user_id — refetch with user_id this time
      const { data: full } = await supabase
        .from("profiles")
        .select("user_id, email, full_name, role, parish")
        .not("email", "is", null)
        .eq("email_verified", true)
        .eq("approval_status", "approved");

      recipients = (full || [])
        .filter(p => {
          if (optedOut.has(p.user_id)) return false;
          if (body.segment === "helpers" && p.role !== "helper") return false;
          if (body.segment === "posters" && p.role !== "customer") return false;
          if (body.segment === "by_parish" && body.parish && p.parish !== body.parish) return false;
          return !!p.email;
        })
        .map(p => ({ email: p.email!, full_name: p.full_name }));
    }

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: "No recipients" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via Resend gateway. Throttle lightly: batches of 10, 200ms between.
    let sent = 0, failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < recipients.length; i += 10) {
      const batch = recipients.slice(i, i + 10);
      await Promise.all(batch.map(async (r) => {
        try {
          const resp = await fetch(`${GATEWAY_URL}/emails`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": RESEND_API_KEY,
            },
            body: JSON.stringify({
              from: "Helpr <hello@notify.louisianahelpr.com>",
              to: [r.email],
              subject: body.subject,
              html: body.html.replaceAll("{{name}}", r.full_name || "neighbor"),
            }),
          });
          if (!resp.ok) {
            failed++;
            const text = await resp.text();
            if (errors.length < 5) errors.push(`${r.email}: ${resp.status} ${text.slice(0, 120)}`);
          } else {
            sent++;
          }
        } catch (e: any) {
          failed++;
          if (errors.length < 5) errors.push(`${r.email}: ${e.message}`);
        }
      }));
      if (i + 10 < recipients.length) await new Promise(r => setTimeout(r, 200));
    }

    // Audit
    await supabase.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "marketing_blast_sent",
      target_type: "campaign",
      details: {
        subject: body.subject,
        segment: body.segment,
        parish: body.parish,
        recipients: recipients.length,
        sent, failed,
      },
    });

    return new Response(JSON.stringify({ sent, failed, total: recipients.length, errors }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("send-marketing-blast error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
