// review-nag-cron — Once-a-day cron that reminds participants to leave a
// review on completed jobs they haven't reviewed yet.
//
// Why this exists: review density is the marketplace flywheel. Most users
// forget to leave a review — without an active nag, only ~10-20% of
// completed jobs get a review. With a 24h + 72h reminder, that climbs
// to ~50%+ across most marketplaces.
//
// Logic:
//   - Find jobs where status='completed' AND poster_completed_at >= now-7d
//   - For each (job, party-not-yet-reviewed) pair:
//     - First nag at 24h after completion (window: 24-36h)
//     - Second nag at 72h after completion (window: 72-84h)
//     - Skip if user already reviewed
//     - Skip if a review notification was already sent this window
//   - Each nag inserts an in-app notification AND fires
//     send-notification-email (mapped to email_reviews pref)
//
// Wakes via the same cron pattern as auto-release-payment / auto-resolve-disputes.
// Recommend running daily.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get("Authorization");
  if (
    !authHeader ||
    ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) &&
      (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))
  ) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);
  const defects = defectTracker();

  // send-notification-email handles user pref filtering (email_reviews).
  // Fire-and-forget — failures shouldn't block the next nag.
  const sendEmail = async (
    user_id: string,
    title: string,
    message: string,
    link: string,
  ) => {
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
        },
        body: JSON.stringify({ user_id, title, message, type: "review", link }),
      });
    } catch (e) {
      console.error("[review-nag-cron] send-email failed:", (e as Error).message);
      defects.record(`send-email ${user_id}: ${(e as Error).message}`);
    }
  };

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_id, poster_completed_at, helper_completed_at")
      .eq("status", "completed")
      .not("helper_id", "is", null)
      .gte("poster_completed_at", sevenDaysAgo);

    if (error) throw error;

    let nags_sent = 0;
    const results: Array<{ job_id: string; recipient: string; window: string }> = [];

    for (const job of jobs ?? []) {
      const completionTime = new Date(
        job.poster_completed_at ?? job.helper_completed_at ?? 0,
      ).getTime();
      const hoursSince = (now.getTime() - completionTime) / (1000 * 60 * 60);

      const inFirstWindow = hoursSince >= 24 && hoursSince < 36;
      const inSecondWindow = hoursSince >= 72 && hoursSince < 84;
      if (!inFirstWindow && !inSecondWindow) continue;

      const windowLabel = inFirstWindow ? "24h" : "72h";

      const { data: existingReviews } = await supabase
        .from("reviews")
        .select("reviewer_id")
        .eq("job_id", job.id);
      const reviewedBy = new Set((existingReviews ?? []).map((r) => r.reviewer_id));

      // Avoid duplicate nags within the same 12h window.
      const windowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
      const alreadyNagged = async (userId: string): Promise<boolean> => {
        const { count } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("type", "review")
          .ilike("link", `%job=${job.id}%`)
          .gte("created_at", windowStart);
        return (count ?? 0) > 0;
      };

      for (const party of [
        { user_id: job.customer_id, reviewing: "your helper" },
        { user_id: job.helper_id, reviewing: "the customer" },
      ]) {
        if (!party.user_id) continue;
        if (reviewedBy.has(party.user_id)) continue;
        if (await alreadyNagged(party.user_id)) continue;

        const title = inFirstWindow
          ? "How was your experience? ⭐"
          : "Last reminder — how was your experience? ⭐";
        const message = `Take 30 seconds to rate ${party.reviewing} for "${job.title}". Reviews help the next ${
          party.reviewing.includes("helper") ? "helper" : "customer"
        } feel safe choosing.`;
        const link = `/profile?tab=reviews&job=${job.id}`;

        const { error: insertErr } = await supabase.from("notifications").insert({
          user_id: party.user_id,
          title,
          message,
          type: "review",
          link,
        });
        if (insertErr) {
          console.error("[review-nag-cron] notification insert failed:", insertErr);
          defects.record(`notification insert ${party.user_id}: ${insertErr.message}`);
          continue;
        }

        await sendEmail(party.user_id, title, message, link);

        nags_sent++;
        results.push({ job_id: job.id, recipient: party.user_id, window: windowLabel });
      }
    }

    return cronResult(
      "review-nag-cron",
      { success: true, jobs_checked: jobs?.length ?? 0, nags_sent, results },
      defects.defects,
      corsHeaders,
    );
  } catch (err) {
    console.error("[review-nag-cron] error:", err);
    return cronError("review-nag-cron", (err as Error).message, corsHeaders);
  }
});
