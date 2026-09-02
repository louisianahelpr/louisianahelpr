import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { sumHelperTakeHomeDollars } from "../_shared/helperEarnings.ts";
import { feePercentForTier } from "../_shared/helperFees.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { scanAll, scanAllIn, scanDefect } from "../_shared/paginate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const svcRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!svcRoleKey || authHeader !== `Bearer ${svcRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const defects = defectTracker();

  try {
    // Behavior-based "helper" filter: anyone who has worked at least one
    // job (i.e., shows up as helper_id on a job). profiles.role was
    // dropped in the unified-accounts migration; the previous .eq('role',
    // 'helper') filter would error at the SELECT level on profiles.
    //
    // This read had three separate faults, and they compounded:
    //
    //   1. Its `error` was DROPPED — `const { data: helperIdRows } = await ...`
    //      — so a PostgREST failure produced `undefined`, the roster came back
    //      empty, and the run answered 200 with "No users have worked a job
    //      yet". A report that reaches nobody, reported as a healthy run.
    //   2. It was UNBOUNDED. PostgREST caps a result at `db-max-rows = 1000`
    //      no matter what `.limit()` says (measured on prod: an explicit
    //      `limit=5000` against a 1,619-row table returns exactly 1000), so
    //      past the thousandth assigned job the roster is whatever helpers
    //      happen to appear in the first 1000 rows.
    //   3. It had NO `ORDER BY`, and the cap is applied AFTER the sort. With
    //      no sort there is no defined order, so "the first 1000" is not even
    //      stably the OLDEST 1000 — it is whatever the planner returned. Two
    //      consecutive weeks could report to two different sets of helpers and
    //      neither run would say anything was missing.
    //
    // Paged, ordered, and checked. The sibling lane's earnings fix (each
    // helper's own tier rate rather than the escrow-time global) is only
    // correct if this roster is the real one, so this read is load-bearing for
    // a money figure a helper reads in an email.
    const rosterScan = await scanAll<{ helper_id: string | null }>("jobs roster", (countOpt) =>
      supabase
        .from("jobs")
        .select("helper_id", countOpt)
        .order("id", { ascending: true })
        .not("helper_id", "is", null),
    );
    const rosterDefect = scanDefect("jobs roster", rosterScan);
    if (rosterDefect) throw new Error(rosterDefect);

    const helperIds = [...new Set(rosterScan.rows.map((r) => r.helper_id))].filter(
      (id): id is string => typeof id === "string",
    );

    if (helperIds.length === 0) {
      return cronResult("weekly-helper-report", { sent: 0, message: "No users have worked a job yet" }, { count: 0 }, corsHeaders);
    }

    // `.in(...)` is capped exactly like any other read — a 3,000-id IN list
    // returns 1000 rows and no complaint — and a long enough list also exceeds
    // the URL length before that. Chunked and paged.
    type HelperProfile = {
      user_id: string;
      full_name: string | null;
      email: string | null;
      subscription_tier: string | null;
      subscription_expires_at: string | null;
    };
    const helperScan = await scanAllIn<HelperProfile>("pro helpers", helperIds, (chunk, countOpt) =>
      supabase
        .from("profiles")
        .select("user_id, full_name, email, subscription_tier, subscription_expires_at", countOpt)
        .order("user_id", { ascending: true })
        .in("user_id", chunk)
        .eq("approval_status", "approved")
        .in("subscription_tier", ["pro", "elite"]),
    );
    const helperDefect = scanDefect("pro helpers", helperScan);
    if (helperDefect) throw new Error(helperDefect);

    const helpers = helperScan.rows;
    if (helpers.length === 0) {
      return cronResult("weekly-helper-report", { sent: 0, message: "No Pro+ helpers found" }, { count: 0 }, corsHeaders);
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAgoISO = weekAgo.toISOString();

    // Filter out expired subscriptions
    const activeHelpers = helpers.filter(h => {
      if (!h.subscription_expires_at) return true;
      return new Date(h.subscription_expires_at) > now;
    });

    let sent = 0;

    for (const helper of activeHelpers) {
      // Gather weekly stats
      const [jobsRes, reviewsRes, earningsRes, appsRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, budget, platform_fee_amount, urgent_fee, status")
          .eq("helper_id", helper.user_id)
          .eq("status", "completed")
          .gte("updated_at", weekAgoISO),
        supabase
          .from("reviews")
          .select("rating")
          .eq("reviewee_id", helper.user_id)
          .gte("created_at", weekAgoISO),
        supabase
          .from("jobs")
          // `payment_status` is REQUIRED, not decorative: helperEarnings'
          // isSettledForDisplay opts a row out of the stamped-fee shortcut
          // unless it is 'released', and a row that omits the column is
          // treated as settled. This query is NOT filtered on
          // payment_status — a job completed an hour ago is still inside the
          // 24-hour payout window — so without this column the guard would be
          // inert and the report would keep quoting the escrow-time stamp.
          .select("budget, platform_fee_amount, urgent_fee, helper_fee_percent, is_group_job, helpers_needed, payment_status")
          .eq("helper_id", helper.user_id)
          .eq("status", "completed")
          .gte("updated_at", weekAgoISO),
        supabase
          .from("applications")
          .select("id")
          .eq("helper_id", helper.user_id)
          .gte("created_at", weekAgoISO),
      ]);

      // Every one of these four reads had its `error` dropped: `.data?.length
      // || 0` turns a failed query into a legitimate-looking zero. The email
      // that comes out then tells a helper who worked all week "Earnings:
      // $0.00 · Jobs Completed: 0 · Keep applying", and the run reports a
      // clean send. A wrong money figure mailed to the person it is about is
      // worse than no email, so a failed read SKIPS this helper and is
      // recorded as a defect instead of being rounded down to zero.
      //
      // These four are NOT paged: each is scoped to one helper and one week,
      // so the row counts are single digits and nowhere near the 1000-row cap.
      // If that ever stops being true — a helper completing 1000 jobs in seven
      // days — the numbers would understate, not fabricate, and the fix is the
      // same `scanAll` used for the roster above.
      const readFailure = [
        jobsRes.error && `completed jobs: ${jobsRes.error.message}`,
        reviewsRes.error && `reviews: ${reviewsRes.error.message}`,
        earningsRes.error && `earnings: ${earningsRes.error.message}`,
        appsRes.error && `applications: ${appsRes.error.message}`,
      ].filter(Boolean)[0];
      if (readFailure) {
        console.error(`[weekly-helper-report] stats read failed for ${helper.user_id}`, readFailure);
        defects.record(`stats read for ${helper.user_id} — ${readFailure}; no report sent`);
        continue;
      }

      const completedJobs = jobsRes.data?.length || 0;
      const newReviews = reviewsRes.data?.length || 0;
      const avgNewRating = newReviews > 0
        ? (reviewsRes.data!.reduce((s, r) => s + r.rating, 0) / newReviews).toFixed(1)
        : "N/A";
      // Canonical take-home, shared with every other surface (R17). This used
      // to sum the FULL budget and the FULL urgent fee with no roster split,
      // so a helper on a 3-person group job was emailed 3× what they were
      // actually transferred. sumHelperTakeHomeDollars divides by the roster
      // and honours the per-job frozen fee.
      //
      // The 10% sales tax on the commission is paid by the platform, never the
      // helper, so it is still not deducted here (a prior version subtracted a
      // phantom 8.5%-of-fee "tax" that under-reported pay versus the actual
      // Stripe transfer).
      //
      // The fallback percent is THIS HELPER'S OWN tier rate, not a global
      // default — the same contract the client twin documents, and the same
      // rate `getHelperFeePercent` resolves when the payout actually runs. It
      // is what an unsettled row (still inside the 24-hour payout window) is
      // priced at, since that row's stamp is escrow-time bookkeeping off the
      // global rate and encodes no tier at all. Passing a flat default here
      // would just swap one wrong number for another: an Elite helper (8%) was
      // emailed a figure UNDERSTATING their pay off the 10% stamp, and would
      // still be understated off a flat 12.
      const weeklyEarnings = sumHelperTakeHomeDollars(
        earningsRes.data || [],
        feePercentForTier(helper.subscription_tier, helper.subscription_expires_at),
      );
      const applicationsSubmitted = appsRes.data?.length || 0;

      // Send as in-app notification (email would require email infrastructure)
      const message = [
        `Your Weekly Report (${weekAgo.toLocaleDateString()} – ${now.toLocaleDateString()})`,
        ``,
        `💰 Earnings: $${weeklyEarnings.toFixed(2)}`,
        `✅ Jobs Completed: ${completedJobs}`,
        `📝 Applications Sent: ${applicationsSubmitted}`,
        `⭐ New Reviews: ${newReviews}${newReviews > 0 ? ` (avg ${avgNewRating})` : ""}`,
        ``,
        completedJobs === 0
          ? "Keep applying — your next gig is around the corner! 💪"
          : "Great week! Keep up the momentum! 🔥",
      ].join("\n");

      // The ONLY delivery this function performs, and its result used to be
      // discarded entirely — no `error` check and no row count. supabase-js
      // RESOLVES `{ error }` rather than throwing, so a rejected INSERT (the
      // PGRST204 shape that made `payment-confirm-reminder` deliver nothing for
      // its entire life) left `sent++` running anyway and the run answered 200
      // with a `sent` count that described nothing. `.select("id")` — a column
      // `notifications` really has — plus a zero-row branch makes the counter
      // mean "a row exists", which is the only thing worth counting here.
      const { data: inserted, error: notifErr } = await supabase
        .from("notifications")
        .insert({
          user_id: helper.user_id,
          title: "Weekly Performance Report",
          message,
          type: "info",
          link: "/profile?tab=earnings",
        })
        .select("id");

      if (notifErr) {
        console.error(`[weekly-helper-report] notification insert failed for ${helper.user_id}`, notifErr);
        defects.record(`notification insert ${helper.user_id}: ${notifErr.message}`);
        continue;
      }
      if ((inserted?.length ?? 0) === 0) {
        console.error(`[weekly-helper-report] notification insert matched 0 rows for ${helper.user_id}`);
        defects.record(
          `notification insert ${helper.user_id}: no error, zero rows written — this helper's weekly report does not exist`,
        );
        continue;
      }

      sent++;
    }

    return cronResult(
      "weekly-helper-report",
      { sent, total: activeHelpers.length, scanned_jobs: rosterScan.rows.length },
      defects.defects,
      corsHeaders,
    );
  } catch (error: any) {
    console.error("Weekly report error:", error);
    return cronError("weekly-helper-report", error.message, corsHeaders);
  }
});
