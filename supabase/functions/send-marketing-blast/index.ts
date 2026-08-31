// Marketing email blast tool — admin-only.
// Sends a one-off campaign to a segmented user list via the Resend API.
// Segments: all | helpers | posters | by_parish.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_URL = "https://api.resend.com/emails";

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
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

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
    // Use the shared has_role RPC rather than hand-rolling a user_roles select
    // (the drift admin-resend-verification was already consolidated away from).
    // Both are equivalent today, but a hand-rolled copy silently stops matching
    // if the role model moves — and this endpoint can mail every user.
    // The error is checked so a transient RPC failure returns a truthful 503
    // instead of a misleading "Forbidden" to a real admin.
    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (roleError) {
      console.error("[send-marketing-blast] has_role check failed:", roleError.message);
      return new Response(JSON.stringify({ error: "Couldn't verify permissions. Please retry." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isAdmin) {
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

    // Only {{name}} is substituted. Any other token the admin types would ship
    // verbatim to up to 5000 inboxes, so refuse the send and name the offender
    // rather than mailing "Hey {{first_name}}" to the whole list.
    const leftoverTokens = [
      ...new Set(
        (body.html.replaceAll("{{name}}", "").match(/\{\{\s*[\w.]+\s*\}\}/g) ?? [])
          .concat(body.subject.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []),
      ),
    ];
    if (leftoverTokens.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Unsupported placeholder(s): ${leftoverTokens.join(", ")}. Only {{name}} is substituted.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve recipient list
    let recipients: { email: string; full_name: string | null }[] = [];

    if (body.test_email) {
      recipients = [{ email: body.test_email, full_name: "Test" }];
    } else {
      // profiles.role was dropped in the unified-accounts migration —
      // selecting it would throw. Segments now derive from BEHAVIOR:
      //   helpers  = anyone with ≥1 application
      //   posters  = anyone with ≥1 posted job
      //   by_parish = profile's parish field
      // Same user can be in both helpers and posters segments — that's
      // intentional under the unified user model.
      // Honor explicit marketing-email consent captured at signup. Anyone
      // who didn't tick the marketing opt-in box (or was created before the
      // column existed and has the DB default of `false`) is never sent
      // promotional mail. Transactional mail (auth, receipts, disputes)
      // uses different send paths and is not gated by this column.
      let q = supabase
        .from("profiles")
        .select("user_id, email, full_name, parish")
        .not("email", "is", null)
        .eq("email_verified", true)
        .eq("approval_status", "approved")
        .eq("marketing_consent", true);

      if (body.segment === "helpers") {
        const { data: applicants } = await supabase
          .from("applications")
          .select("helper_id");
        const helperIds = [...new Set((applicants ?? []).map((a) => a.helper_id))];
        if (helperIds.length === 0) {
          return new Response(JSON.stringify({ sent: 0, message: "No users have applied to a job yet" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        q = q.in("user_id", helperIds);
      }
      if (body.segment === "posters") {
        const { data: postedJobs } = await supabase
          .from("jobs")
          .select("customer_id")
          .not("customer_id", "is", null);
        const posterIds = [...new Set((postedJobs ?? []).map((j) => j.customer_id))];
        if (posterIds.length === 0) {
          return new Response(JSON.stringify({ sent: 0, message: "No users have posted a job yet" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        q = q.in("user_id", posterIds as string[]);
      }
      if (body.segment === "by_parish" && body.parish) q = q.eq("parish", body.parish);

      const { data, error } = await q.limit(5000);
      if (error) throw error;

      // Honor email opt-out: drop anyone with email_promotions=false.
      //
      // This read MUST fail closed, exactly like the recipient query above.
      // Dropping the error made the opt-out list fail OPEN: `prefs` comes back
      // null, `|| []` turns it into an empty set, nobody matches `optedOut`,
      // and the blast goes to every user who explicitly unsubscribed from
      // promotions. A single transient read failure is the difference between
      // honoring an opt-out and a CAN-SPAM violation across up to 5000
      // recipients, with no error surfaced. Abort the blast instead — an
      // unsent campaign is retryable, an unwanted one is not.
      const { data: prefs, error: prefsError } = await supabase
        .from("notification_preferences")
        .select("user_id, email_promotions");
      if (prefsError) {
        throw new Error(
          `Could not load email opt-out preferences (${prefsError.message}). Blast aborted — no email was sent.`,
        );
      }
      const optedOut = new Set(
        (prefs || []).filter((p) => p.email_promotions === false).map((p) => p.user_id),
      );

      // The query above already includes the segment filter (in() on
      // helper-applicants or poster-customers, or .eq parish). No need
      // to refetch + cross-check; just drop opted-out users.
      recipients = (data || [])
        .filter((p) => p.user_id && !optedOut.has(p.user_id) && !!p.email)
        .map((p) => ({ email: p.email!, full_name: p.full_name }));
    }

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: "No recipients" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via the Resend API. Throttle lightly: batches of 10, 200ms between.
    // The admin types raw HTML, so the footer and the plaintext part have to be
    // synthesised here — there is no template to hang them off.
    const UNSUB_FOOTER =
      '<p style="font-size:12px;color:#77786f;margin:32px 0 0;padding:16px 0 0;border-top:1px solid #e5e2dd">' +
      'You received this because you opted in to Louisiana Helpr marketing email. ' +
      '<a href="https://louisianahelpr.com/profile?tab=notifications" style="color:#77786f;text-decoration:underline">Unsubscribe</a>.' +
      '</p>';
    const appendUnsubscribeFooter = (html: string) =>
      html.includes("/profile?tab=notifications") ? html : html + UNSUB_FOOTER;
    const htmlToPlainText = (html: string) =>
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    let sent = 0, failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < recipients.length; i += 10) {
      const batch = recipients.slice(i, i + 10);
      await Promise.all(batch.map(async (r) => {
        try {
          const personalisedHtml = appendUnsubscribeFooter(
            body.html.replaceAll("{{name}}", r.full_name || "neighbor"),
          );
          const resp = await fetch(RESEND_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: "Helpr <hello@louisianahelpr.com>",
              to: [r.email],
              subject: body.subject,
              html: personalisedHtml,
              // Every other sender supplies a plaintext part; this one did not.
              // HTML-only mail is a direct spam-score penalty and is unreadable
              // in text-only clients and to some screen readers.
              text: htmlToPlainText(personalisedHtml),
              // This is the only unambiguously commercial send in the product
              // and it carried no opt-out of any kind.
              headers: {
                "List-Unsubscribe": "<https://louisianahelpr.com/profile?tab=notifications>, <mailto:unsubscribe@louisianahelpr.com>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
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
