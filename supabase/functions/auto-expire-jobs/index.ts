import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const svcRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!svcRoleKey || authHeader !== `Bearer ${svcRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date().toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // jobs.date_needed is a bare DATE that only means anything in Louisiana's
    // zone, so "today" has to be computed there too. toISOString() gave the UTC
    // date, which between 19:00 and midnight Central is already TOMORROW — so
    // an open job dated today with a 21:00 start satisfied `date_needed < today`
    // and got cancelled that same evening, hours before it was due, telling the
    // poster its "scheduled time passed with no helper assigned" while helpers
    // could still see and want it.
    //
    // en-CA formats as YYYY-MM-DD, which is what the DATE comparison needs.
    // Same computation as todayMs() in src/lib/jobDate.ts, which exists to be
    // the one correct reader of this column.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    // 1. Expire accepted jobs that were accepted 24h+ ago but never started
    // `helper_confirmed_at IS NULL` is the real predicate for "stale
    // acceptance". Selecting on `updated_at` alone un-booked CONFIRMED helpers:
    // a helper who accepted and confirmed a job scheduled for next week had
    // their booking destroyed 24h after the row was last touched, purely
    // because nothing had written to it since. auto_start_due_jobs gets this
    // right and requires helper_confirmed_at IS NOT NULL; this did not.
    // Keyed on `accepted_at` — the moment the job actually entered
    // `accepted` (trigger-stamped, migration 20260824213000) — so an
    // incidental row write can no longer reset the ghosting clock. Rows
    // that predate the stamp keep the old updated_at fallback.
    const { data: staleAccepted, error: fetchError } = await supabase
      .from("jobs")
      .select("id, title, customer_id, helper_id")
      .eq("status", "accepted")
      .is("helper_confirmed_at", null)
      .or(
        `accepted_at.lt.${twentyFourHoursAgo},and(accepted_at.is.null,updated_at.lt.${twentyFourHoursAgo})`,
      );

    if (fetchError) throw fetchError;

    let expiredCount = 0;

    for (const job of staleAccepted || []) {
      // Conditional + row-count checked. The write used to carry no status
      // predicate, and ('in_progress','open') IS an allowed transition — so a
      // job the helper had STARTED in the window between the read above and
      // this write was silently reset to open with helper_id nulled, while its
      // escrow was still held.
      const { data: reopened, error: updateError } = await supabase
        .from("jobs")
        .update({ status: "open", helper_id: null })
        .eq("id", job.id)
        .eq("status", "accepted")
        .is("helper_confirmed_at", null)
        .select("id");
      if (!updateError && (reopened?.length ?? 0) === 0) {
        console.log(`[auto-expire-jobs] job ${job.id} changed since read — skipping reopen`);
        continue;
      }

      if (updateError) {
        console.error(`Failed to expire job ${job.id}:`, updateError);
        continue;
      }

      await supabase
        .from("applications")
        .update({ status: "rejected" })
        .eq("job_id", job.id)
        .eq("status", "accepted");

      await supabase.from("notifications").insert({
        user_id: job.customer_id,
        title: "Job re-opened",
        message: `"${job.title}" was automatically re-opened because the helpr didn't start within 24 hours.`,
        type: "warning",
        link: "/my-posts?filter=open",
      });

      if (job.helper_id) {
        await supabase.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job expired",
          message: `You didn't start "${job.title}" within 24 hours. The job has been re-opened for other helprs.`,
          type: "warning",
          link: "/my-jobs?filter=not_selected",
        });
      }

      expiredCount++;
    }

    // 2. Auto-cancel open jobs whose expires_at has passed OR date_needed is in the past
    const { data: expiredByTime, error: expTimeErr } = await supabase
      .from("jobs")
      .select("id, title, customer_id")
      .eq("status", "open")
      .not("expires_at", "is", null)
      .lt("expires_at", now);

    if (expTimeErr) throw expTimeErr;

    const { data: expiredByDate, error: expDateErr } = await supabase
      .from("jobs")
      .select("id, title, customer_id")
      .eq("status", "open")
      .is("expires_at", null)
      .lt("date_needed", today);

    if (expDateErr) throw expDateErr;

    // Merge and deduplicate
    const allExpired = [...(expiredByTime || []), ...(expiredByDate || [])];
    const seen = new Set<string>();
    let cancelledCount = 0;

    for (const job of allExpired) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);

      // Conditional on still being open — see the reopen guard above. Without
      // it, a helper who won this job via accept_application or
      // instant_book_claim between the read and this write ended up accepted on
      // a CANCELLED job: no cancellation_fee written, and void-cancelled-payments
      // then refunded the poster in full while the helper still believed they
      // were booked.
      const { data: cancelledRows, error: cancelError } = await supabase
        .from("jobs")
        .update({
          status: "cancelled",
          cancelled_at: now,
          cancellation_reason: "Job listing expired — scheduled time passed with no helper assigned",
        })
        .eq("id", job.id)
        .eq("status", "open")
        .select("id");

      if (cancelError) {
        console.error(`Failed to cancel expired job ${job.id}:`, cancelError);
        continue;
      }
      if ((cancelledRows?.length ?? 0) === 0) {
        // Someone claimed it between the read and now. Leave it alone and do
        // NOT notify the poster that it was cancelled — it wasn't.
        console.log(`[auto-expire-jobs] job ${job.id} was claimed since read — skipping cancel`);
        continue;
      }

      await supabase.from("notifications").insert({
        user_id: job.customer_id,
        title: "Job auto-cancelled",
        message: `"${job.title}" was automatically cancelled because the scheduled time passed without a helpr being assigned. You can repost anytime.`,
        type: "warning",
        link: "/post-job",
      });

      cancelledCount++;
    }

    // 3. Expire UNANSWERED offers past their response_deadline.
    //
    // Runs BEFORE the direct-offer sweep and after step 1, but it is really
    // step 1's missing half: step 1 reopens a stale acceptance keyed on
    // `updated_at` older than 24h and files no violation, so a helper who
    // ghosted an offer they had applied for walked away clean while one who
    // pressed Decline took a strike. This keys on the deadline the poster
    // actually set and applies the same 5-strike ladder decline_job_offer
    // does (owner: an expired offer reopens the job AND counts as a decline).
    let unansweredExpired = 0;
    try {
      const { data: unRpc, error: unRpcErr } = await supabase.rpc("expire_unanswered_offers");
      if (unRpcErr) {
        // PGRST202 = the migration has merged but db-deploy has not finished.
        // Expected for a few minutes on every deploy; not worth an error line.
        if (unRpcErr.code !== "PGRST202") {
          console.error("expire_unanswered_offers error:", unRpcErr);
        }
      } else {
        unansweredExpired = (unRpc as number) || 0;
      }
    } catch (e) {
      console.error("Unanswered offer expiry call failed:", e);
    }

    // 4. Expire pending direct offers (24h window)
    let directOfferExpired = 0;
    try {
      const { data: expRpc, error: expRpcErr } = await supabase.rpc("expire_pending_direct_offers");
      if (expRpcErr) {
        console.error("expire_pending_direct_offers error:", expRpcErr);
      } else {
        directOfferExpired = (expRpc as number) || 0;
      }
    } catch (e) {
      console.error("Direct offer expiry call failed:", e);
    }

    return new Response(
      JSON.stringify({
        message: `Expired ${expiredCount} accepted jobs, cancelled ${cancelledCount} past-time open jobs, expired ${unansweredExpired} unanswered offers, expired ${directOfferExpired} direct offers`,
        expiredCount,
        cancelledCount,
        unansweredExpired,
        directOfferExpired,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Auto-expire error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
