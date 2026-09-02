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
// Schedule: `15 */6 * * *` — 00:15, 06:15, 12:15 and 18:15 UTC, per migrations
//   20260612440000 → 20260829010000 → 20260902035753.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE WINDOW WAS NARROWER THAN THE SCHEDULE. THE SCHEDULE IS WHAT CHANGED.
// ═══════════════════════════════════════════════════════════════════════════
//
// The cron used to sample once every 24 hours against a 12-hour window, so
// roughly half of all submissions could never land in it. Let t₀ be the gap
// between the helper marking complete and the next tick, t₀ ∈ [0,24). The job
// is graded at t₀, t₀+24, … and `helper_completed_at ∈ [now-24h, now-12h]`
// means `t₀+24k ∈ [12,24]`, which has a solution only for t₀ ∈ [12,24]. Every
// job completed in the twelve hours AFTER a tick was looked at at t₀ (< 12h,
// too early) and then at t₀+24 (> 24h, past auto-release) and was never
// reminded. The poster was not nudged, `payment_confirm_notif_sent` stayed
// NULL, escrow auto-released, and the run reported 200 with a plausible `sent`
// count. Measured on prod 2026-09-02: `payment_confirm_notif_sent = true` on
// ZERO rows, ever.
//
// Widening the window was NOT available here, and that is the difference
// between this function and `review-nag-cron`, where widening was the fix. This
// deadline is HARD: `auto-release-payment` moves the money at
// AUTO_COMPLETE_HOURS (24h). A window wide enough for a daily cron would have
// to start at 0h — nudging a poster minutes after the helper's own "job
// complete" notification, which is noise — and would still have nothing useful
// to say to the job that is already 23h old. There is no 24-hour-wide window
// inside a 24-hour deadline that is also a USEFUL reminder.
//
// So the fix was the schedule, and it needed a migration this function could
// not write. That migration is **20260902035753** and it sets **`15 */6 * * *`**
// (every six hours). With a 6-hour period and a 12-hour window the sample grid
// is half the window width, so every job is graded inside it — twice, in fact,
// which `payment_confirm_notif_sent` makes harmless — and one skipped tick
// still leaves full coverage. Every 12 hours would also have closed the hole,
// but with the grid exactly equal to the window and therefore zero margin
// against a single pg_net timeout, which this project logs routinely.
//
// `CRON_PERIOD_HOURS` below is the assertion that keeps the two in step. It is
// the deployed period, and `SCHEDULE_LEAVES_A_HOLE` is derived from it rather
// than asserted — so if anyone ever widens the schedule back out, the alarm
// text below starts naming the fix again on its own.
//
// The run also MEASURES its own coverage: `missed` counts jobs that reached the
// auto-release cutoff having never been reminded, and reports them as DEFECTS.
// That check stays now that the hole is closed, because it is what proves the
// close held — it is wired to the condition that actually exists rather than to
// a limit nothing enforces.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { AUTO_COMPLETE_HOURS } from "../_shared/escrowTiming.ts";
import { scanAll, scanDefect } from "../_shared/paginate.ts";

/**
 * Hours after the helper marks complete before the poster is nudged. Leaves
 * them the second half of the auto-release window to act in.
 */
const REMIND_AFTER_HOURS = 12;

/**
 * The cron period this window is sized against, in hours. MUST match the
 * deployed `cron.job.schedule`, which 20260902035753 sets to every six hours at
 * quarter past. (Spelled out rather than pasted: the cron expression contains
 * a star-slash, which would close this comment block.)
 *
 * Coverage requires `CRON_PERIOD_HOURS <= AUTO_COMPLETE_HOURS -
 * REMIND_AFTER_HOURS` (i.e. <= 12). It was 24, which is why no reminder was
 * ever sent and why `missed` exists.
 */
const CRON_PERIOD_HOURS = 6;
/** True when the deployed schedule cannot cover the window. Drives the alarm. */
const SCHEDULE_LEAVES_A_HOLE = CRON_PERIOD_HOURS > AUTO_COMPLETE_HOURS - REMIND_AFTER_HOURS;

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

  const defects = defectTracker();

  try {
    const now = new Date();
    // The reminder becomes due REMIND_AFTER_HOURS after the helper marked
    // complete — everything older than this instant is due.
    const cutoffReminderStart = new Date(
      now.getTime() - REMIND_AFTER_HOURS * 60 * 60 * 1000,
    ).toISOString();
    // Auto-release fires at AUTO_COMPLETE_HOURS; nudging past it is pointless
    // because the money has already moved. Derived from the shared constant
    // rather than a re-typed 24, so the reminder and the cron that pays out can
    // never disagree about when the window closes.
    const cutoffAutoRelease = new Date(
      now.getTime() - AUTO_COMPLETE_HOURS * 60 * 60 * 1000,
    ).toISOString();

    // Jobs where:
    //   - helper has marked complete (helper_completed_at is set)
    //   - helper marked complete 12–24 h ago (before auto-release)
    //   - poster hasn't confirmed yet (poster_completed_at IS NULL)
    //   - reminder hasn't been sent yet (payment_confirm_notif_sent IS NULL)
    //   - payment is still held in escrow
    //   - job is still active (in_progress or revision_requested)
    //
    // Paged: the filters bound this to a half-day of submissions in principle,
    // but PostgREST caps ANY result at `db-max-rows = 1000` no matter what
    // `.limit()` asks for, and a busy day past that boundary would drop the
    // remainder silently while answering 200.
    type PendingJob = {
      id: string;
      title: string;
      customer_id: string;
      helper_completed_at: string | null;
    };
    const jobScan = await scanAll<PendingJob>("due reminders", (countOpt) =>
      supabase
        .from("jobs")
        .select("id, title, customer_id, helper_completed_at", countOpt)
        .order("id", { ascending: true })
        .in("status", ["in_progress", "revision_requested"])
        .eq("payment_status", "escrow")
        .is("payment_confirm_notif_sent", null)
        .is("poster_completed_at", null)
        .not("helper_completed_at", "is", null)
        .lte("helper_completed_at", cutoffReminderStart)
        .gt("helper_completed_at", cutoffAutoRelease),
    );

    if (jobScan.error) {
      console.error("[payment-confirm-reminder] failed to fetch jobs", jobScan.error);
      return cronError("payment-confirm-reminder", jobScan.error.message, corsHeaders);
    }
    const scanShortfall = scanDefect("due reminders", jobScan);
    if (scanShortfall) defects.record(scanShortfall);
    const jobs = jobScan.rows;

    // ── The hole this schedule leaves, measured ──────────────────────────────
    //
    // Count the jobs that sailed past the auto-release cutoff never having been
    // reminded. Under a 24-hour schedule with a 12-hour window this is roughly
    // half of all submissions, and nothing anywhere reported it: the miss
    // leaves no error, no log line and no row — only an absence. Counting the
    // absence is what turns "the window is too narrow for the schedule" from a
    // fact you have to derive on paper into a number in the run body.
    //
    // Deliberately a `head` count, so it costs one number and no rows, and
    // deliberately NOT a send: by the time a job is on this list escrow has
    // already auto-released and there is nothing left to confirm.
    //
    // `is_seed = false`, matching `money-reconciliation`'s documented scope.
    // Fixture rows are settled by test harnesses and replay scripts, never by
    // the real lifecycle, so they sit in this state permanently — measured
    // against prod on 2026-09-01, all FIVE all-time hits were seeds. An alarm
    // that fires four times every night on fixtures is muted within a week,
    // and then it is not an alarm. Scoped to real jobs it is silent today,
    // which is the truthful answer: the coverage hole is a live mechanism that
    // has not yet cost a real poster anything, because no real job has reached
    // this state.
    let missed = 0;
    const { count: missedCount, error: missedErr } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("is_seed", false)
      .in("status", ["in_progress", "revision_requested", "completed"])
      .is("payment_confirm_notif_sent", null)
      .is("poster_completed_at", null)
      .not("helper_completed_at", "is", null)
      .lte("helper_completed_at", cutoffAutoRelease)
      .gte(
        "helper_completed_at",
        new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );
    if (missedErr) {
      defects.record(`missed-reminder count failed: ${missedErr.message}`);
    } else {
      missed = missedCount ?? 0;
      if (missed > 0) {
        defects.record(
          `${missed} job(s) in the last 7 days passed the ${AUTO_COMPLETE_HOURS}h auto-release cutoff with no confirm reminder ever sent` +
            (SCHEDULE_LEAVES_A_HOLE
              ? ` — expected: a ${CRON_PERIOD_HOURS}h schedule cannot cover a ${AUTO_COMPLETE_HOURS - REMIND_AFTER_HOURS}h window. Reschedule to '15 */6 * * *'.`
              : ""),
        );
      }
    }

    const results: Array<{ job_id: string; status: "sent" | "error"; error?: string }> = [];
    const markFailures: string[] = [];

    for (const job of jobs) {
      try {
        // 1. In-app notification — the fan_out_push_on_notification trigger
        //    (20260506120000) auto-fires the APNs/FCM push so we get both
        //    in-app + device push from a single INSERT.
        // `.select("id")` + a zero-row branch below. A null `error` does NOT mean
        // the row exists, and `results.push({ status: "sent" })` asserts that it
        // does — while step 2 immediately marks the job so this poster is never
        // considered again. A silent zero-row insert would therefore burn the
        // one reminder they get.
        const { data: notifRows, error: notifErr } = await supabase.from("notifications").insert({
          user_id: job.customer_id,
          title: "Your Helpr marked the job done",
          message: `"${job.title}" — please confirm completion or request a revision. Payment auto-releases in ~24h.`,
          type: "job_updates",
          // No job_id here: public.notifications is (id, user_id, title,
          // message, type, read, link, created_at) and no migration ever adds
          // a job_id column. Passing one made PostgREST reject the INSERT with
          // PGRST204, which threw into the per-job catch below — so this
          // reminder has never once been delivered since the function was
          // written, while the run still returned HTTP 200 with sent: 0. The
          // link already carries the poster to the job.
          // `?job=`, not `?filter=in_progress`. `in_progress` is a legacy filter
          // key with no chip in the five-bucket strip (activityFilters.ts), so
          // the poster landed on a filtered list with nothing selected. And the
          // right bucket here is not fixed anyway: a submission awaiting the
          // poster buckets to "Needs you", which is exactly what this reminder
          // is about, but it moves the moment they act. Activity resolves the
          // bucket from the job id at open time.
          link: `/my-posts?job=${job.id}`,
        }).select("id");

        if (notifErr) {
          // Log but don't mark the flag — next cron run can retry this job.
          throw notifErr;
        }
        if ((notifRows?.length ?? 0) === 0) {
          // Same handling as an error: do NOT mark the flag, so the next run
          // retries rather than recording a reminder that does not exist.
          throw new Error(
            `notification insert matched 0 rows with no error — no reminder exists for job ${job.id}`,
          );
        }

        // 2. Mark the job so this cron doesn't fire again for the same row.
        //
        // `.select("id")` and a zero-row branch: a null `error` does NOT mean
        // the write happened — an UPDATE matching zero rows returns
        // `{ data: [], error: null }`, and this is the ONLY thing making the
        // reminder idempotent. Unmarked, the poster is nudged again on the next
        // tick about a job they may already have confirmed.
        const { data: marked, error: markErr } = await supabase
          .from("jobs")
          .update({ payment_confirm_notif_sent: true } as Record<string, unknown>)
          .eq("id", job.id)
          .select("id");

        if (!markErr && (marked?.length ?? 0) === 0) {
          console.error(`[payment-confirm-reminder] mark matched 0 rows for job ${job.id}`);
          markFailures.push(`mark ${job.id}: no error, zero rows matched — this poster will be nudged again`);
        }

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
      { processed: results.length, sent, errors, missed, results },
      {
        count: errors + markFailures.length + defects.count,
        reasons: [
          ...results.filter((r) => r.status === "error").map((r) => `notify ${r.job_id}: ${r.error}`),
          ...markFailures,
          ...defects.reasons,
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
