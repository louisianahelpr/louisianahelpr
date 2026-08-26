// expiring-jobs-push — Cron-driven edge function that notifies job posters
// when their open job is about to expire within 24 hours with no helpr yet.
//
// Why this exists: "expiring" jobs are silent failures. The poster doesn't
// know the listing is about to vanish and loses a potential hire without
// ever getting a chance to boost or extend it.
//
// Logic:
//   - Find open jobs (no helper_id) expiring in the next 24 hours
//   - Filter to jobs where expiring_notif_sent IS NULL (never notified)
//   - For each: fire a push notification + in-app notification to the poster
//   - Mark expiring_notif_sent = true so the job is not notified again
//
// Idempotency: the expiring_notif_sent flag prevents double-notification
// even if the cron runs twice during the same window.
//
// Auth: cron secret (CRON_SECRET) or service_role key. Not user-callable.
// Schedule: once daily — recommend 9am Central (14:00 UTC).

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
  const cronSecret = Deno.env.get("CRON_SECRET");

  // Auth gate — accept CRON_SECRET bearer or service_role key bearer
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
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Jobs expiring within the next 24 hours, still open, no helper
    // assigned, and the expiring-soon notification hasn't been sent yet.
    // expiring_notif_sent IS NULL covers the initial state (column defaults
    // to NULL); once we mark it true, .is('expiring_notif_sent', null) skips
    // that row on the next run.
    const { data: jobs, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, title, customer_id, expires_at, category")
      .eq("status", "open")
      .is("helper_id", null)
      .is("expiring_notif_sent", null)
      .gt("expires_at", now.toISOString())
      .lte("expires_at", in24h.toISOString());

    if (fetchErr) {
      console.error("[expiring-jobs-push] failed to fetch expiring jobs", fetchErr);
      return cronError("expiring-jobs-push", fetchErr.message, corsHeaders);
    }

    const results: Array<{ job_id: string; status: "sent" | "error"; error?: string }> = [];
    const markFailures: string[] = [];

    for (const job of jobs ?? []) {
      try {
        // 1. In-app notification — lands immediately in the bell icon.
        //    The fan_out_push_on_notification trigger (20260506120000)
        //    will auto-fire the APNs/FCM push when this row is inserted,
        //    meaning we get both in-app + push from a single INSERT.
        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: job.customer_id,
          title: "Your job expires soon",
          message: `"${job.title}" expires in less than 24 hours with no helpr yet. Boost it to get more visibility!`,
          type: "job_updates",
          link: "/my-posts",
        });

        if (notifErr) {
          // Log but don't abort — mark failed so the flag isn't set and
          // the next cron run can retry this job.
          throw notifErr;
        }

        // 2. Mark the job so this cron doesn't fire again for the same row.
        const { error: markErr } = await supabase
          .from("jobs")
          .update({ expiring_notif_sent: true } as Record<string, unknown>)
          .eq("id", job.id);

        if (markErr) {
          // If marking fails, the in-app notification was already sent.
          // Log it — the next cron run will send a second in-app notification.
          // Acceptable trade-off vs. silently losing the update.
          console.error(`[expiring-jobs-push] failed to mark job ${job.id}`, markErr);
          // A defect: the write is broken, and the poster gets nudged twice.
          markFailures.push(`mark ${job.id}: ${markErr.message}`);
        }

        results.push({ job_id: job.id, status: "sent" });
      } catch (err) {
        console.error(`[expiring-jobs-push] failed to notify for job ${job.id}`, err);
        results.push({ job_id: job.id, status: "error", error: String(err) });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(`[expiring-jobs-push] processed ${results.length} jobs: ${sent} sent, ${errors} errors`);

    // Failed notification INSERTs are defects, not outcomes — the same counter
    // shape that hid payment-confirm-reminder's total failure behind a 200.
    return cronResult(
      "expiring-jobs-push",
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
    console.error("[expiring-jobs-push] unexpected error", message);
    return cronError("expiring-jobs-push", message, corsHeaders);
  }
});
