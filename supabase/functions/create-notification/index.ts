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

    const { user_id, title, message, type = "info", link = null, job_id = null } = await req.json();

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

    // Authorization: a regular user may notify themselves, an admin may target
    // anyone (system-wide announcements) — and, since 2026-08-25, a user may
    // notify the OTHER PARTY of a job they share. The original self-or-admin
    // rule (anti-spoofing: any signed-up user could POST {user_id: <anyone>}
    // and brand a fake Helpr notification) silently 403'd EVERY client-driven
    // lifecycle notification — offer, revision, dispute, cancellation, on-my-way
    // (~17 call sites route through createNotification with the counterparty's
    // id), and the callers report-but-swallow the failure. The job-party rule
    // below restores those while still refusing strangers: the caller and the
    // target must share a job (either side of customer/helper), or one must
    // have an application on the other's job (covers offer/decline notices to
    // applicants who aren't assigned yet).
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    if (user_id !== user.id) {
      // user.id comes from the verified JWT; user_id is caller-supplied, so
      // pin it to a UUID before it goes anywhere near a query filter string.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(String(user_id))) {
        return new Response(JSON.stringify({ error: "Invalid user_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdmin, error: roleErr } = await adminClient.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      let allowed = !roleErr && !!isAdmin;
      if (!allowed) {
        const { count: sharedJobs } = await adminClient
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .or(
            `and(customer_id.eq.${user.id},helper_id.eq.${user_id}),and(customer_id.eq.${user_id},helper_id.eq.${user.id})`,
          );
        allowed = (sharedJobs ?? 0) > 0;
      }
      if (!allowed) {
        const { count: theirAppOnMyJob } = await adminClient
          .from("applications")
          .select("id, jobs!inner(customer_id)", { count: "exact", head: true })
          .eq("helper_id", user_id)
          .eq("jobs.customer_id", user.id);
        const { count: myAppOnTheirJob } = await adminClient
          .from("applications")
          .select("id, jobs!inner(customer_id)", { count: "exact", head: true })
          .eq("helper_id", user.id)
          .eq("jobs.customer_id", user_id);
        allowed = (theirAppOnMyJob ?? 0) > 0 || (myAppOnTheirJob ?? 0) > 0;
      }
      if (!allowed) {
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

    // job_id is caller-supplied, so pin it to a UUID before it goes anywhere
    // near the insert. A bad shape is rejected rather than dropped: silently
    // nulling it would produce exactly the failure this column exists to end —
    // a notification that looks fine and has lost the job it is about.
    // Referential truth is the FK's job, not this function's: a well-formed id
    // naming a job that does not exist is refused by
    // notifications_job_id_fkey, and the insert-error branch below reports it.
    let sanitizedJobId: string | null = null;
    if (job_id != null) {
      const JOB_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof job_id !== "string" || !JOB_UUID_RE.test(job_id)) {
        return new Response(JSON.stringify({ error: "Invalid job_id: must be a uuid" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      sanitizedJobId = job_id;
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

    // `.select("id").single()` is not decoration: a null `error` alone does not
    // prove a row landed, and the id is what lets the caller (and the "Send a
    // Test" button) say "the bell row is really there" instead of assuming it.
    const { data: inserted, error: insertError } = await adminClient
      .from("notifications")
      .insert({
        user_id,
        title,
        message,
        type,
        link: sanitizedLink,
        // NULL here is not "no job" — it is "this caller did not say". The
        // trg_notifications_fill_job_id trigger then recovers the job from the
        // link when the link carries one, so a job-shaped link still lands
        // with a reference even from a producer that has not been updated.
        job_id: sanitizedJobId,
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      console.error("Failed to create notification:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create notification" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Chain the email HERE, with the service key. send-notification-email is
    // service-role-only (it will send arbitrary HTML as Helpr, so it must
    // never trust a user JWT) — which means the client's old direct invoke
    // could only ever 401. Every client-driven lifecycle email (offer,
    // arrival, confirmation, …) silently failed in prod and each failure
    // fanned an alert notification out to every admin. This function has
    // already authorized the caller (self / admin / job counterparty), so it
    // is the trusted place to trigger delivery. Fire-and-forget: an email
    // failure must not fail the in-app notification that already landed.
    // Per-channel outcome, reported back to the caller.
    //
    // This used to be a bare `{ success: true }` no matter what actually
    // happened downstream, which is how "Send a Test" could tell the owner to
    // "check your email" on a run where send-notification-email had returned
    // HTTP 200 `{ skipped: true, reason: "email_disabled" }` and no mail was
    // ever queued. A 200 from the email function is NOT proof of a send — only
    // its body says which of send / skip / fail occurred, so read the body.
    type ChannelResult = {
      status: "sent" | "skipped" | "failed";
      reason?: string;
      /** Masked recipient, e.g. `lexi…@gmail.com`, when one was resolved. */
      detail?: string;
      /** The notification_preferences column that turned the email off. */
      pref_column?: string;
    };
    let emailResult: ChannelResult = { status: "failed", reason: "unknown" };

    try {
      const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ user_id, title, message, type, link: sanitizedLink }),
      });
      const emailBody = await emailRes.json().catch(() => null) as
        | {
            success?: boolean; skipped?: boolean; reason?: string; to?: string;
            delivery?: string; error?: string; pref_column?: string;
          }
        | null;

      if (!emailRes.ok) {
        console.error("send-notification-email failed:", emailRes.status, JSON.stringify(emailBody));
        emailResult = { status: "failed", reason: emailBody?.reason ?? `http_${emailRes.status}` };
      } else if (emailBody?.skipped) {
        emailResult = {
          status: "skipped",
          reason: emailBody.reason ?? "skipped",
          detail: emailBody.to,
          ...(emailBody.pref_column ? { pref_column: emailBody.pref_column } : {}),
        };
      } else if (emailBody?.success) {
        emailResult = { status: "sent", reason: emailBody.delivery, detail: emailBody.to };
      } else {
        emailResult = { status: "failed", reason: emailBody?.reason ?? "send_failed", detail: emailBody?.to };
      }
    } catch (emailErr) {
      console.error("send-notification-email unreachable:", emailErr);
      emailResult = { status: "failed", reason: "unreachable" };
    }

    // Push is fanned out asynchronously by the fan_out_push_on_notification
    // trigger on the INSERT above, so we cannot observe its delivery here —
    // but we CAN report the one fact that decides whether push was ever
    // possible: how many devices this user has registered. Zero devices is the
    // difference between "your push didn't arrive" and "there is nowhere to
    // send it", and the caller must be able to say which.
    const { count: pushDevices, error: pushCountError } = await adminClient
      .from("push_tokens")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id);
    if (pushCountError) {
      console.error("push_tokens count failed:", pushCountError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        notification_id: inserted.id,
        channels: {
          in_app: { status: "sent", id: inserted.id },
          email: emailResult,
          push: {
            status: (pushDevices ?? 0) > 0 ? "queued" : "skipped",
            devices: pushDevices ?? 0,
            ...((pushDevices ?? 0) === 0 ? { reason: "no_registered_devices" } : {}),
          },
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Create notification error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
