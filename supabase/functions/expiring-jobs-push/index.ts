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
// Schedule: hourly through the Louisiana day, '14 13-23,0-2 * * *' (Q994,
// 20261005060246). Once a day missed every listing posted after the run that
// expired before the next one; src/test/expiringJobsPushCadence.test.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { serve } from "../_shared/buildStamp.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


// deno-lint-ignore no-explicit-any
type Client = any;

/** What the poster reads: the applicants waiting, when there are any. */
export function expiringJobCopy(title: string | null, waiting: number, when: "day" | "final"): { title: string; message: string } {
  const what = title ? `"${title}"` : "Your job";
  if (waiting > 0) {
    const people = waiting === 1 ? "1 person has" : `${waiting} people have`;
    return when === "final"
      ? { title: "Pick someone today", message: `${people} applied to ${what}, and it expires in a few hours. Pick someone before it closes.` }
      : { title: "Your job expires soon", message: `${people} applied to ${what}. Pick someone before it expires tomorrow.` };
  }
  return { title: "Your job expires soon", message: `${what} expires in less than 24 hours with no helpr yet. Boost it to get more visibility!` };
}

/** Pending applications per job, in one read. */
async function pendingApplicantCounts(supabase: Client, jobIds: string[]): Promise<{ counts: Map<string, number>; error: string | null }> {
  const counts = new Map<string, number>();
  if (jobIds.length === 0) return { counts, error: null };
  const { data, error } = await supabase.from("applications").select("job_id").in("job_id", jobIds).eq("status", "pending");
  if (error) return { counts, error: `applicant counts: ${error.message}` };
  for (const row of (data ?? []) as Array<{ job_id: string }>) counts.set(row.job_id, (counts.get(row.job_id) ?? 0) + 1);
  return { counts, error: null };
}

/** The same words by email (send-notification-email applies the poster's job-update email switch and suppression). */
async function emailPoster(userId: string, jobId: string, copy: { title: string; message: string }, notes: string[]): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    notes.push(`email ${jobId}: no SUPABASE_URL / service key`);
    return;
  }
  try {
    const res = await fetch(`${url}/functions/v1/send-notification-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ user_id: userId, title: copy.title, message: copy.message, type: "job_update", link: `/posts?job=${jobId}`, job_id: jobId }),
    });
    if (!res.ok) notes.push(`email ${jobId}: send-notification-email answered ${res.status}`);
  } catch (e) {
    notes.push(`email ${jobId}: ${caughtMessage(e)}`);
  }
}

serve(async (req) => {
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, { global: { fetch: boundedFetch() } });

  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in6h = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const defectsFromCounts: string[] = [];
    const emailNotes: string[] = [];

    // Jobs expiring within the next 24 hours, still open, no helper
    // assigned, and the expiring-soon notification hasn't been sent yet.
    // expiring_notif_sent IS NULL covers the initial state (column defaults
    // to NULL); once we mark it true, .is('expiring_notif_sent', null) skips
    // that row on the next run.
    const { data: jobs, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, title, customer_id, expires_at, category")
      .eq("status", "open")
      // Only a FUNDED job is live to Helprs. A checkout nobody finished
      // (unpaid / abandoned) was never shown to anyone, so "no helpr yet,
      // Boost it" is false (owner report, 2026-10-09: Ben's unpaid draft).
      .eq("payment_status", "escrow")
      .is("helper_id", null)
      // AL-010: a deleted poster leaves customer_id NULL; the notification
      // insert then fails NOT NULL, the job is never marked, and every run
      // retries it forever. There is nobody to tell, so never fetch it.
      .not("customer_id", "is", null)
      .is("expiring_notif_sent", null)
      .gt("expires_at", now.toISOString())
      .lte("expires_at", in24h.toISOString());

    if (fetchErr) {
      console.error("[expiring-jobs-push] failed to fetch expiring jobs", fetchErr);
      return cronError("expiring-jobs-push", fetchErr.message, corsHeaders);
    }

    const results: Array<{ job_id: string; status: "sent" | "error"; error?: string }> = [];
    const markFailures: string[] = [];
    // Hire nudge (owner 2026-10-25): name the applicants waiting, so a poster
    // with 43 applicants is told to pick one, not to "boost" the job.
    const applicantCounts = await pendingApplicantCounts(supabase, (jobs ?? []).map((j) => j.id));
    if (applicantCounts.error) defectsFromCounts.push(applicantCounts.error);

    for (const job of jobs ?? []) {
      try {
        // 1. In-app notification — lands immediately in the bell icon.
        //    The fan_out_push_on_notification trigger (20260506120000)
        //    will auto-fire the APNs/FCM push when this row is inserted,
        //    meaning we get both in-app + push from a single INSERT.
        const waiting = applicantCounts.counts.get(job.id) ?? 0;
        const copy = expiringJobCopy(job.title, waiting, "day");
        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: job.customer_id,
          job_id: job.id,
          title: copy.title,
          message: copy.message,
          type: "job_updates",
          // The expiring job itself. A job with no helpr yet and no pending
          // applications buckets to "Waiting", not the "Needs you" bucket a
          // bare /posts opens on.
          link: `/posts?job=${job.id}`,
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

        if (waiting > 0) await emailPoster(job.customer_id, job.id, copy, emailNotes);
        results.push({ job_id: job.id, status: "sent" });
      } catch (err) {
        console.error(`[expiring-jobs-push] failed to notify for job ${job.id}`, err);
        results.push({ job_id: job.id, status: "error", error: String(err) });
      }
    }

    // Final reminder: the last 6 hours, someone has applied, nobody hired yet.
    const { data: finalJobs, error: finalErr } = await supabase
      .from("jobs")
      .select("id, title, customer_id")
      .eq("status", "open")
      .eq("payment_status", "escrow")
      .is("helper_id", null)
      .not("customer_id", "is", null)
      .is("expiring_final_notif_sent", null)
      .gt("expires_at", now.toISOString())
      .lte("expires_at", in6h.toISOString());
    if (finalErr) defectsFromCounts.push(`final read: ${finalErr.message}`);
    const finalCounts = await pendingApplicantCounts(supabase, (finalJobs ?? []).map((j: { id: string }) => j.id));
    if (finalCounts.error) defectsFromCounts.push(finalCounts.error);
    let finalSent = 0;
    for (const job of (finalJobs ?? []) as Array<{ id: string; title: string | null; customer_id: string }>) {
      const waiting = finalCounts.counts.get(job.id) ?? 0;
      if (waiting === 0) continue;
      const copy = expiringJobCopy(job.title, waiting, "final");
      // Mark first: a failed mark sends nothing, so the poster is never nudged twice.
      const { data: marked, error: markErr } = await supabase
        .from("jobs")
        .update({ expiring_final_notif_sent: true } as Record<string, unknown>)
        .eq("id", job.id)
        .is("expiring_final_notif_sent", null)
        .select("id");
      if (markErr) {
        markFailures.push(`final mark ${job.id}: ${markErr.message}`);
        continue;
      }
      if (!marked || marked.length === 0) continue; // another run took it
      const { error: notifErr } = await supabase.from("notifications").insert({
        user_id: job.customer_id, job_id: job.id, title: copy.title, message: copy.message, type: "job_updates", link: `/posts?job=${job.id}`,
      });
      if (notifErr) {
        markFailures.push(`final notify ${job.id}: ${notifErr.message}`);
        continue;
      }
      await emailPoster(job.customer_id, job.id, copy, emailNotes);
      finalSent++;
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(`[expiring-jobs-push] processed ${results.length} jobs: ${sent} sent, ${errors} errors`);

    // Failed notification INSERTs are defects, not outcomes — the same counter
    // shape that hid payment-confirm-reminder's total failure behind a 200.
    return cronResult(
      "expiring-jobs-push",
      { processed: results.length, sent, errors, results, final_sent: finalSent, email_notes: emailNotes },
      {
        count: errors + markFailures.length + defectsFromCounts.length,
        reasons: [
          ...defectsFromCounts,
          ...results.filter((r) => r.status === "error").map((r) => `notify ${r.job_id}: ${r.error}`),
          ...markFailures,
        ],
      },
      corsHeaders,
    );
  } catch (err: unknown) {
    const message = caughtMessage(err);
    console.error("[expiring-jobs-push] unexpected error", message);
    return cronError("expiring-jobs-push", message, corsHeaders);
  }
});
