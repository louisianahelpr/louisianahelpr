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
//     - First nag at 24h after completion (window: 24-48h)
//     - Second nag at 72h after completion (window: 72-96h)
//     - Skip if user already reviewed
//     - Skip if a review notification was already sent this window
//   - Each nag inserts an in-app notification AND fires
//     send-notification-email (mapped to email_reviews pref)
//
// Wakes via the same cron pattern as auto-release-payment / auto-resolve-disputes.
// Runs daily (`26 16 * * *`, migration 20260829010000).
//
// ─── WHY THE WINDOWS ARE 24 HOURS WIDE, NOT 12 ──────────────────────────────
//
// They were `[24,36)` and `[72,84)` — twelve hours wide — against a cron that
// samples once every twenty-four. A window narrower than the sampling interval
// is not a window; it is a coin toss.
//
// Let t₀ be the gap between a job's completion and the next cron tick, so
// t₀ ∈ [0,24). The tick times a job is ever graded at are t₀, t₀+24, t₀+48, …
// With a 12-hour first window, `t₀+24k ∈ [24,36)` has a solution only when
// t₀ ∈ [0,12). With the second window, `t₀+24k ∈ [72,84)` needs t₀ ∈ [0,12) —
// THE SAME HALF. So it is not "half the jobs miss the first nag and catch the
// second": every job completed in the twelve hours BEFORE a tick is graded at
// 12–24h (too early), then 36–48h (past the window), then 60–72h, then 84–96h,
// and is never once inside either window. Half of all completed jobs got zero
// review nags, forever, while the run reported `nags_sent` and a 200.
//
// Widening to 24 makes the window exactly as wide as the sampling interval, so
// `t₀+24k ∈ [24,48)` has a solution — exactly one, at k=1 — for every t₀ in
// [0,24). Full coverage, and still precisely one nag per window per party.
//
// The alternative, running twice as often against the 12-hour windows, also
// closes the hole but with zero margin: the sample grid would exactly equal the
// window width, so a single skipped tick (pg_net times out at 5s, and this
// project logs those routinely) reopens it, and it needs a migration to the
// schedule. Widening is the change that makes the function correct on its own
// terms, independent of how often it is called — which is the property worth
// having, since nothing in this file can see its own schedule. A review nag has
// no hard deadline, so the cost of arriving up to 24h later is nil.
//
// Any change to the schedule MUST keep `period ≤ WINDOW_HOURS`.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { scanAll, scanDefect } from "../_shared/paginate.ts";

/**
 * Width of each nag window, in hours. MUST be >= the cron period, or jobs fall
 * between samples and are never graded — see the header. At the current daily
 * schedule this is exactly equal, which yields precisely one hit per window.
 */
const WINDOW_HOURS = 24;
/** Hours after completion the first nag becomes due. */
const FIRST_NAG_AT_HOURS = 24;
/** Hours after completion the last-chance nag becomes due. */
const SECOND_NAG_AT_HOURS = 72;

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
  //
  // The response is CHECKED. It used to be `await fetch(...)` with nothing
  // read off it: a 401 (wrong bearer), a 500, or a 503 suppression-check
  // failure all fell through the try/catch — `fetch` only rejects on a
  // transport error, never on an HTTP error status — and the run then counted
  // the nag as sent. Review nags are the marketplace flywheel, so a silently
  // broken send loop reported healthy numbers forever.
  //
  // Returns "sent" | "skipped" | "failed":
  //   skipped — the recipient has review emails switched off, or no address.
  //             A legitimate outcome, not a defect.
  //   failed  — anything else. Recorded as a defect so the cron sweep sees it.
  const sendEmail = async (
    user_id: string,
    title: string,
    message: string,
    link: string,
  ): Promise<"sent" | "skipped" | "failed"> => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
        },
        body: JSON.stringify({ user_id, title, message, type: "review", link }),
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        console.error(
          `[review-nag-cron] send-notification-email returned ${res.status}`,
          { user_id, detail },
        );
        defects.record(`send-email ${user_id}: HTTP ${res.status} ${detail}`);
        return "failed";
      }

      // A 200 can still mean "nothing was sent" — the function answers
      // { skipped: true, reason: 'email_disabled' | 'no_email' | 'suppressed' }.
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (body && (body as { skipped?: unknown }).skipped === true) return "skipped";
      return "sent";
    } catch (e) {
      console.error("[review-nag-cron] send-email failed:", (e as Error).message);
      defects.record(`send-email ${user_id}: ${(e as Error).message}`);
      return "failed";
    }
  };

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Paged. The seven-day filter bounds this in principle, but PostgREST caps
    // ANY result at `db-max-rows = 1000` regardless of `.limit()` (measured on
    // prod: `limit=5000` against a 1,619-row table returns exactly 1000), so a
    // week with more than a thousand completed jobs would silently grade a
    // subset and report a clean run. `scanAll` pages past the cap and compares
    // what it read against the server's own exact count, so a short read is a
    // reported defect rather than a quiet one.
    type NagJob = {
      id: string;
      title: string;
      customer_id: string | null;
      helper_id: string | null;
      poster_completed_at: string | null;
      helper_completed_at: string | null;
    };
    const jobScan = await scanAll<NagJob>("completed jobs", (countOpt) =>
      supabase
        .from("jobs")
        .select("id, title, customer_id, helper_id, poster_completed_at, helper_completed_at", countOpt)
        .order("id", { ascending: true })
        .eq("status", "completed")
        .not("helper_id", "is", null)
        .gte("poster_completed_at", sevenDaysAgo),
    );
    if (jobScan.error) throw jobScan.error;
    // A short scan ABORTS here rather than grading the partial set, and that is
    // the opposite of the choice `engagement-automations` makes for its
    // recipient lists. The difference is whether tomorrow's run can repair it.
    // There, it can: a skipped drip recipient is simply picked up next time.
    // Here it cannot — this file's own header proves `t₀+24k ∈ [24,48)` has
    // EXACTLY ONE solution, so a job dropped by a short read misses its window
    // permanently and is never nagged for it. Grading the subset would turn a
    // read fault into a silent, unrecoverable loss and still report which nags
    // "were sent".
    const jobScanDefect = scanDefect("completed jobs", jobScan);
    if (jobScanDefect) throw new Error(jobScanDefect);
    const jobs = jobScan.rows;

    // nags_sent counts nags that actually LEFT — an in-app notification plus a
    // send-notification-email call that did not fail. Emails the recipient has
    // switched off are counted separately rather than inflating the headline
    // number or being reported as breakage.
    let nags_sent = 0;
    let emails_skipped = 0;
    let email_failures = 0;
    const results: Array<{ job_id: string; recipient: string; window: string; email: string }> = [];

    for (const job of jobs) {
      const completionTime = new Date(
        job.poster_completed_at ?? job.helper_completed_at ?? 0,
      ).getTime();
      const hoursSince = (now.getTime() - completionTime) / (1000 * 60 * 60);

      const inFirstWindow =
        hoursSince >= FIRST_NAG_AT_HOURS && hoursSince < FIRST_NAG_AT_HOURS + WINDOW_HOURS;
      const inSecondWindow =
        hoursSince >= SECOND_NAG_AT_HOURS && hoursSince < SECOND_NAG_AT_HOURS + WINDOW_HOURS;
      if (!inFirstWindow && !inSecondWindow) continue;

      const windowLabel = inFirstWindow ? "24h" : "72h";

      // Not paged: a job has at most one review per party. The `error` IS
      // checked, because an errored read yields an EMPTY `reviewedBy` set,
      // which reads identically to "neither party has reviewed" and nags two
      // people who already did.
      const { data: existingReviews, error: reviewsErr } = await supabase
        .from("reviews")
        .select("reviewer_id")
        .eq("job_id", job.id);
      if (reviewsErr) {
        console.error("[review-nag-cron] reviews read failed:", reviewsErr);
        defects.record(`reviews read for job ${job.id}: ${reviewsErr.message}; skipped`);
        continue;
      }
      const reviewedBy = new Set((existingReviews ?? []).map((r) => r.reviewer_id));

      // Avoid duplicate nags within the same window. The lookback tracks
      // WINDOW_HOURS rather than being pinned at 12: a dedupe shorter than the
      // window it guards lets a job that lands in the window twice (a retried
      // run, a schedule change, clock skew at the boundary) nag the same person
      // twice. The two windows are 48h apart, so a 24h lookback cannot suppress
      // the legitimate second nag.
      const windowStart = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
      // A `head: true` count is not subject to db-max-rows — it returns a
      // number, not rows — so this one needs no paging. It DOES need its error:
      // dropped, a failed count reads as `null` → 0 → "not yet nagged", and the
      // dedupe guard inverts into a duplicate-send guarantee. Failing closed
      // (treat an unreadable count as "already nagged") is the right side to
      // err on: a missed nag costs a review, a double nag costs trust.
      const alreadyNagged = async (userId: string): Promise<boolean> => {
        const { count, error: countErr } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("type", "review")
          .ilike("link", `%job=${job.id}%`)
          .gte("created_at", windowStart);
        if (countErr) {
          console.error("[review-nag-cron] dedupe count failed:", countErr);
          defects.record(`dedupe count ${userId} job ${job.id}: ${countErr.message}; nag withheld`);
          return true;
        }
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
          ? "How was your experience?"
          : "Last reminder — how was your experience?";
        const message = `Take 30 seconds to rate ${party.reviewing} for "${job.title}". Reviews help the next ${
          party.reviewing.includes("helper") ? "helper" : "customer"
        } feel safe choosing.`;
        const link = `/profile?tab=reviews&job=${job.id}`;

        // `.select("id")` + a zero-row branch. A null `error` does NOT mean the
        // row exists, and `nags_sent++` below asserts that it does — the same
        // guard `weekly-helper-report` carries, for the same reason. `id` is a
        // real `notifications` column (id, user_id, title, message, type, read,
        // link, created_at); a reflexive `.select("id")` on a table without one
        // is a hard 400.
        const { data: inserted, error: insertErr } = await supabase
          .from("notifications")
          .insert({
            user_id: party.user_id,
            title,
            message,
            type: "review",
            link,
          })
          .select("id");
        if (insertErr) {
          console.error("[review-nag-cron] notification insert failed:", insertErr);
          defects.record(`notification insert ${party.user_id}: ${insertErr.message}`);
          continue;
        }
        if ((inserted?.length ?? 0) === 0) {
          console.error("[review-nag-cron] notification insert matched 0 rows:", party.user_id);
          defects.record(
            `notification insert ${party.user_id}: no error, zero rows written — no nag exists for job ${job.id}`,
          );
          continue;
        }

        const emailOutcome = await sendEmail(party.user_id, title, message, link);
        if (emailOutcome === "skipped") emails_skipped++;
        if (emailOutcome === "failed") email_failures++;
        if (emailOutcome !== "failed") nags_sent++;

        results.push({ job_id: job.id, recipient: party.user_id, window: windowLabel, email: emailOutcome });
      }
    }

    return cronResult(
      "review-nag-cron",
      { success: true, jobs_checked: jobs.length, nags_sent, emails_skipped, email_failures, results },
      defects.defects,
      corsHeaders,
    );
  } catch (err) {
    console.error("[review-nag-cron] error:", err);
    return cronError("review-nag-cron", (err as Error).message, corsHeaders);
  }
});
