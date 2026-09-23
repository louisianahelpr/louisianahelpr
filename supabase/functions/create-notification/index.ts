import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import {
  type BuiltNotification,
  buildSelfTestNotification,
  NOTIFICATION_TEMPLATES,
  SELF_TEST_TEMPLATE,
  type TemplateFacts,
} from "../_shared/notification-templates.ts";

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
  // Operator-facing mail (dispute overdue, payout blocked, new signup). Only
  // ever produced server-side by service-role callers; it stays on this
  // allowlist because create-notification is the shared insert path and an
  // absent entry would 400 the admin alerts, not protect anything.
  "admin_alert",
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The template a body names, or null. */
function resolveTemplateName(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  if (typeof body.template === "string") return body.template;
  return null;
}

/** job_id, or (legacy bodies) the `?job=` id in the old client-built link. */
function resolveTemplateJobId(body: Record<string, unknown>): string | null {
  if (typeof body.job_id === "string") return UUID_RE.test(body.job_id) ? body.job_id : null;
  if (typeof body.link === "string") {
    const m = /[?&]job=([0-9a-f-]{36})(?:&|$)/i.exec(body.link);
    if (m && UUID_RE.test(m[1])) return m[1];
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Rate limit (EF-02, hole hunt 2026-09-15). The authorization rule below
  // deliberately lets a job counterparty (or a mere applicant on a job) notify
  // the other party, which is correct for lifecycle notices — but it turned a
  // once-admin-only primitive into a user-reachable one that fans arbitrary
  // caller-supplied copy out over three Helpr-branded channels (in-app + push +
  // service-role email) with no budget. This is the ONLY client-reachable
  // notification producer that lacked `checkRateLimit` while its 18 siblings
  // have it. Keyed narrow per-JWT-subject (the sender) and wide per-IP, so one
  // account can no longer email/push-bomb another. (The relationship gate and
  // the 200/1000-char length caps below still stand; this adds the missing
  // volume ceiling.)
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 20,
    keyPrefix: "create-notification",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

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

    const body = await req.json();
    const { user_id } = body ?? {};

    if (!user_id) {
      return new Response(JSON.stringify({ error: "Missing required field: user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // user.id comes from the verified JWT; user_id is caller-supplied, so pin
    // it to a UUID before it goes anywhere near a query filter string.
    if (!UUID_RE.test(String(user_id))) {
      return new Response(JSON.stringify({ error: "Invalid user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: isAdminData, error: roleErr } = await adminClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    // Fail closed: a role lookup that errored is "not an admin".
    const isAdmin = !roleErr && !!isAdminData;

    // WHO WRITES THE WORDS (Q223 / bus EF-003).
    //
    // Only an ADMIN may send free text (announcements, ban and warning
    // notices). Every other caller names a template from
    // _shared/notification-templates.ts, and the title, message, type and link
    // are built HERE from database facts. This function used to insert the
    // caller's own title/message/type for any job counterparty — or a mere
    // applicant on the job — which let an applicant put a `payment` /
    // `verified` / `system_alert` notification, worded however they liked,
    // into the poster's bell and a Helpr-branded email.
    let built: BuiltNotification;
    let sanitizedJobId: string | null = null;

    const requestedTemplate = resolveTemplateName(body);
    if (isAdmin && requestedTemplate === null) {
      const { title, message, type = "info", link = null, job_id = null } = body;
      if (!title || !message || typeof title !== "string" || typeof message !== "string") {
        return new Response(JSON.stringify({ error: "Missing required fields: user_id, title, message" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (title.length > 200 || message.length > 1000) {
        return new Response(JSON.stringify({ error: "Title or message too long" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
      if (job_id != null) {
        if (typeof job_id !== "string" || !UUID_RE.test(job_id)) {
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
      built = { title, message, type, link: sanitizedLink };
    } else if (requestedTemplate === SELF_TEST_TEMPLATE) {
      // Settings → "Send a Test": yourself only, fixed copy.
      if (user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      built = buildSelfTestNotification(new Date());
    } else {
      const tpl = requestedTemplate !== null && Object.prototype.hasOwnProperty.call(NOTIFICATION_TEMPLATES, requestedTemplate)
        ? NOTIFICATION_TEMPLATES[requestedTemplate]
        : null;
      if (!tpl) {
        return new Response(JSON.stringify({ error: "Unknown or missing notification template" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const jobId = resolveTemplateJobId(body);
      if (!jobId) {
        return new Response(JSON.stringify({ error: "Invalid job_id: must be a uuid" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: job, error: jobErr } = await adminClient
        .from("jobs")
        .select("id, title, customer_id, helper_id, response_deadline, dispute_status")
        .eq("id", jobId)
        .maybeSingle();
      if (jobErr) {
        console.error("template job read failed:", jobErr);
        return new Response(JSON.stringify({ error: "Failed to create notification" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!job) {
        return new Response(JSON.stringify({ error: "Job not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // The caller's side of THIS job. A caller who is neither its poster nor
      // its assigned Helpr — an applicant, a stranger — sends nothing.
      const senderRole: "poster" | "helper" | null =
        job.customer_id && job.customer_id === user.id
          ? "poster"
          : job.helper_id && job.helper_id === user.id
            ? "helper"
            : null;
      let allowed = senderRole !== null && (tpl.sender === "either" || tpl.sender === senderRole);
      if (allowed && senderRole === "helper") {
        allowed = job.customer_id === user_id;
      } else if (allowed && senderRole === "poster") {
        allowed = job.helper_id === user_id;
        if (!allowed) {
          // An applicant who is not (or no longer) assigned: offer, decline,
          // and the no-show report after the RPC has unassigned them.
          const { count: applied } = await adminClient
            .from("applications")
            .select("id", { count: "exact", head: true })
            .eq("job_id", job.id)
            .eq("helper_id", user_id);
          allowed = (applied ?? 0) > 0;
        }
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const facts: TemplateFacts = { job, senderRole: senderRole!, now: new Date() };
      const needs = tpl.needs ?? [];
      if (needs.includes("revision")) {
        const { data: rev } = await adminClient
          .from("job_revisions")
          .select("description")
          .eq("job_id", job.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        facts.revisionDescription = rev?.description ?? null;
      }
      if (needs.includes("application")) {
        const { data: app } = await adminClient
          .from("applications")
          .select("status, decline_reason")
          .eq("job_id", job.id)
          .eq("helper_id", user_id)
          .maybeSingle();
        facts.application = app ?? null;
      }
      if (needs.includes("posterName")) {
        const { data: prof } = await adminClient
          .from("profiles")
          .select("full_name")
          .eq("user_id", user.id)
          .maybeSingle();
        facts.posterFirstName = (prof?.full_name ?? "").split(" ")[0] || null;
      }
      if (needs.includes("noShow")) {
        const { data: v } = await adminClient
          .from("user_violations")
          .select("action_taken")
          .eq("user_id", user_id)
          .eq("job_id", job.id)
          .eq("violation_type", "no_show")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        facts.noShowAction = v?.action_taken ?? null;
      }
      const out = tpl.build(facts);
      if (!out) {
        // The database does not show the event this template announces.
        return new Response(JSON.stringify({ error: "Nothing to notify: the event is not recorded" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      built = out;
      sanitizedJobId = job.id;
    }

    const { title, message, type } = built;
    const sanitizedLink = built.link;

    // Q137: a seed subject never notifies a non-seed recipient. The
    // notifications BEFORE INSERT trigger enforces that by dropping the row,
    // which would make the `.single()` below read as "insert failed" (500).
    // Ask the same DB function first, so a deliberate drop answers as a skip.
    // PGRST202 (function not deployed yet) falls through to the trigger.
    const { data: crossesSeed, error: seedCheckError } = await adminClient.rpc(
      "notification_crosses_seed_boundary",
      {
        p_recipient: user_id,
        p_job_id: sanitizedJobId ?? null,
        p_link: sanitizedLink ?? null,
        // The signed-in caller is the actor: a seed account notifying a real
        // counterparty is a seed subject even when no job is named.
        p_actor: user.id,
      },
    );
    if (seedCheckError && seedCheckError.code !== "PGRST202") {
      console.error("seed boundary check failed:", seedCheckError);
      return new Response(
        JSON.stringify({ error: "Failed to create notification" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (crossesSeed === true) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "seed_subject" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
        body: JSON.stringify({ user_id, title, message, type, link: sanitizedLink, job_id: sanitizedJobId, notification_id: inserted.id }),
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
