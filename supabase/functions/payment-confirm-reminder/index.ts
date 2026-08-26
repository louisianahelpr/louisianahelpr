// payment-confirm-reminder — Cron-driven edge function that nudges the poster
// to confirm job completion (or request a revision) 12 hours after the helper
// has marked the job done.
//
// Why this exists: once a helper marks a job complete the poster has 24 hours
// before auto-release pays out.  Without a reminder, many posters miss the
// window and can't request a revision even when they wanted to.  This nudge
// fires at ~12 h after the helper marks complete, giving the poster ~12 h of
// runway before auto-release kicks in.
//
// Logic:
//   - Find jobs in escrow where the helper marked complete 12–24 h ago
//   - Filter to jobs where the poster hasn't confirmed yet (poster_completed_at IS NULL)
//   - Filter to jobs where we haven't already sent this reminder (payment_confirm_notif_sent IS NULL)
//   - For each: insert an in-app notification → the fan_out_push_on_notification
//     trigger (20260506120000) auto-fires the APNs/FCM push
//   - Mark payment_confirm_notif_sent = true so the cron skips on the next run
//
// Idempotency: payment_confirm_notif_sent prevents double-notification even if
// the cron fires twice inside the same 24h window.
//
// Auth: cron secret (CRON_SECRET) or service_role key.  Not user-callable.
// Schedule: once daily at 15:00 UTC (10:00 AM Central) — see migration
//   20260612440000_payment_confirm_reminder.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { cronError, cronResult } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health-check shortcut — no auth required.
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
  const cronSecret = Deno.env.get("CRON_SECRET");

  // Auth gate — accept CRON_SECRET bearer or service_role key bearer.
  const authHeader = req.headers.get("Authorization");
  if (
    !authHeader ||
    ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) &&
      (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))
  ) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const now = new Date();
    // 24h ago — helpers who marked complete at least 24 h ago get a reminder.
    const cutoffReminderStart = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    // 48h ago — auto-release window starts here; no point reminding after this.
    const cutoffAutoRelease = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Jobs where:
    //   - helper has marked complete (helper_completed_at is set)
    //   - helper marked complete 24–48 h ago (before auto-release)
    //   - poster hasn't confirmed yet (poster_completed_at IS NULL)
    //   - reminder hasn't been sent yet (payment_confirm_notif_sent IS NULL)
    //   - payment is still held in escrow
    //   - job is still active (in_progress or revision_requested)
    const { data: jobs, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_completed_at")
      .in("status", ["in_progress", "revision_requested"])
      .eq("payment_status", "escrow")
      .is("payment_confirm_notif_sent", null)
      .is("poster_completed_at", null)
      .not("helper_completed_at", "is", null)
      .lte("helper_completed_at", cutoffReminderStart)
      .gt("helper_completed_at", cutoffAutoRelease);

    if (fetchErr) {
      console.error("[payment-confirm-reminder] failed to fetch jobs", fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{ job_id: string; status: "sent" | "error"; error?: string }> = [];
    const markFailures: string[] = [];

    for (const job of jobs ?? []) {
      try {
        // 1. In-app notification — the fan_out_push_on_notification trigger
        //    (20260506120000) auto-fires the APNs/FCM push so we get both
        //    in-app + device push from a single INSERT.
        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: job.customer_id,
          title: "Your helpr marked the job done",
          message: `"${job.title}" — please confirm completion or request a revision. Payment auto-releases in ~24h.`,
          type: "job_updates",
          // No job_id here: public.notifications is (id, user_id, title,
          // message, type, read, link, created_at) and no migration ever adds
          // a job_id column. Passing one made PostgREST reject the INSERT with
          // PGRST204, which threw into the per-job catch below — so this
          // reminder has never once been delivered since the function was
          // written, while the run still returned HTTP 200 with sent: 0. The
          // link already carries the poster to the job.
          link: "/my-posts?filter=in_progress",
        });

        if (notifErr) {
          // Log but don't mark the flag — next cron run can retry this job.
          throw notifErr;
        }

        // 2. Mark the job so this cron doesn't fire again for the same row.
        const { error: markErr } = await supabase
          .from("jobs")
          .update({ payment_confirm_notif_sent: true } as Record<string, unknown>)
          .eq("id", job.id);

        if (markErr) {
          // The notification was already sent; log the flag failure but don't
          // abort.  The next cron run will send a second notification for this
          // job — acceptable trade-off vs. silently losing the mark.
          console.error(`[payment-confirm-reminder] failed to mark job ${job.id}`, markErr);
          // Counted as a defect: the write is broken, and the visible symptom
          // is the poster being nudged twice about the same job.
          markFailures.push(`mark ${job.id}: ${markErr.message}`);
        }

        results.push({ job_id: job.id, status: "sent" });
      } catch (err) {
        console.error(`[payment-confirm-reminder] failed to notify for job ${job.id}`, err);
        results.push({ job_id: job.id, status: "error", error: String(err) });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(
      `[payment-confirm-reminder] processed ${results.length} jobs: ${sent} sent, ${errors} errors`,
    );

    // Every `error` here is a failed notification INSERT — a defect, never a
    // business outcome. This is the exact counter that read 14 while the run
    // answered 200, so it is the one that now decides the status code.
    return cronResult(
      "payment-confirm-reminder",
      { processed: results.length, sent, errors, results },
      {
        count: errors + markFailures.length,
        reasons: [
          ...results.filter((r) => r.status === "error").map((r) => `notify ${r.job_id}: ${r.error}`),
          ...markFailures,
        ],
      },
      corsHeaders,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payment-confirm-reminder] unexpected error", message);
    return cronError("payment-confirm-reminder", message, corsHeaders);
  }
});
