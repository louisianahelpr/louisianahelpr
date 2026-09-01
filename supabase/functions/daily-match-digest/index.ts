// Daily match digest — drains the match_digest_queue and emits one
// notification per user summarizing the day's non-urgent matches.
//
// Schedule (recommended): once daily at the user-friendliest hour.
// Suggested 8am Central (13:00 UTC) so the digest lands with morning
// coffee. Configure via `supabase functions schedule` after deploy.
//
// Idempotent within a single day: after emitting, the queue rows are
// deleted; a re-run on the same data does nothing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  // With no service-role key, `createClient(url, undefined)` throws
  // "supabaseKey is required" RIGHT HERE — before the try/catch below and
  // before the auth check, which already tolerates a missing key. The caller
  // got an opaque 500 with no CORS headers and no clue why. Answer instead.
  if (!serviceRoleKey) {
    console.error("[daily-match-digest] SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY is not configured");
    return new Response("Service role key not configured", { status: 503, headers: corsHeaders });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const defects = defectTracker();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    // 1. Pull every queue row + join the job title/budget/location so
    //    the digest message can be assembled without per-user job
    //    round-trips. Cap at 5,000 rows per run — anything bigger means
    //    the digest is overdue and should be split across multiple runs.
    const { data: queueRows, error: queueErr } = await supabase
      .from("match_digest_queue")
      .select("id, user_id, job_id, created_at, jobs(id, title, category, location, budget)")
      .order("created_at", { ascending: true })
      .limit(5000);

    if (queueErr) throw queueErr;
    if (!queueRows || queueRows.length === 0) {
      return cronResult("daily-match-digest", { users: 0, queued: 0 }, { count: 0 }, corsHeaders);
    }

    // 2. Group by user_id.
    type QueueRow = (typeof queueRows)[number] & {
      jobs: { id: string; title: string; category: string; location: string; budget: number } | null;
    };
    const byUser = new Map<string, QueueRow[]>();
    for (const row of queueRows as QueueRow[]) {
      if (!row.jobs) continue;
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id)!.push(row);
    }

    // 2b. Mask the street address before it reaches a notification. Digest
    //     recipients are the general helper pool (never the awarded helper —
    //     those are notified separately once offered), so the full street
    //     address must never be interpolated here. Reuse the same Postgres
    //     function open_jobs_browse uses, so there is exactly one masking
    //     rule. Batch by unique raw location to avoid one RPC round-trip per
    //     row.
    const uniqueLocations = Array.from(
      new Set((queueRows as QueueRow[]).map((r) => r.jobs?.location).filter((l): l is string => !!l)),
    );
    const maskedByLocation = new Map<string, string>();
    for (const loc of uniqueLocations) {
      const { data: masked, error: maskErr } = await supabase.rpc("mask_job_location", { loc });
      if (maskErr) throw maskErr;
      maskedByLocation.set(loc, masked ?? "");
    }

    // 3. Build one notification per user.
    const notifications: Array<{
      user_id: string;
      title: string;
      message: string;
      type: string;
      link: string;
      read: boolean;
    }> = [];

    for (const [userId, rows] of byUser) {
      const count = rows.length;
      // Headline pick — first job is the "lead" so the user has a
      // concrete thing to tap. Rest goes into the message tail.
      const lead = rows[0].jobs!;
      const leadLocation = maskedByLocation.get(lead.location) ?? "";
      const others = count - 1;
      const title = `Today's matches — ${count} job${count === 1 ? "" : "s"} for you`;
      const message =
        others > 0
          ? `${lead.title} in ${leadLocation} · $${lead.budget}, plus ${others} more. Tap to browse.`
          : `${lead.title} in ${leadLocation} · $${lead.budget}. Tap to review and apply.`;
      notifications.push({
        user_id: userId,
        title,
        message,
        type: "job_match",
        link: `/dashboard`,
        read: false,
      });
    }

    if (notifications.length > 0) {
      const { error: insertErr } = await supabase.from("notifications").insert(notifications);
      if (insertErr) throw insertErr;
    }

    // 4. Drain the queue rows we just summarized. Done after the
    //    notifications insert succeeds so a partial failure leaves
    //    the queue intact for retry.
    //    A null `error` here does NOT mean the rows went away: a DELETE
    //    matching zero rows returns `{ data: [], error: null }`. The error was
    //    already checked, but the ROW COUNT was not — and a silent no-op is the
    //    worse half of the same failure, because the notifications above have
    //    already been sent. Every row left behind is re-summarized and re-sent
    //    to a real person tomorrow, and the day after, forever, while the run
    //    reports 200. So the drain now counts what it actually removed.
    //
    //    Policy on a short drain: record a DEFECT (the run answers 500 via
    //    cronResult, which is what `sweep_cron_http_failures()` watches) and do
    //    NOT suppress anything. Suppression is not available as a remedy: the
    //    drain runs AFTER the send, so by the time we learn a row is stuck the
    //    digest it belongs to is already delivered, and there is nothing to
    //    stop within this run. What prevents the repeat is a human clearing the
    //    row before tomorrow's 13:00 UTC tick — so the only useful behaviour is
    //    to say so, loudly, with the count.
    //
    //    Chunked at 500: PostgREST caps how many rows a request returns
    //    (`db-max-rows`), so a single 5,000-id DELETE ... RETURNING could be
    //    truncated and look like a short drain on a perfectly clean run — a
    //    false page. 500 stays well under any configured cap and keeps the
    //    `?id=in.(...)` URL a sane length.
    const queueIds = queueRows.map((r: { id: string }) => r.id);
    const DRAIN_CHUNK = 500;
    let drained = 0;
    for (let i = 0; i < queueIds.length; i += DRAIN_CHUNK) {
      const batch = queueIds.slice(i, i + DRAIN_CHUNK);
      const { data: deletedRows, error: deleteErr } = await supabase
        .from("match_digest_queue")
        .delete()
        .in("id", batch)
        .select("id");
      if (deleteErr) {
        console.warn("queue drain failed (will retry next run):", deleteErr.message);
        // "Retries next run" is only comforting if the next run succeeds. A
        // permanently failing drain re-sends the SAME digest every day forever,
        // and the run reports 200 the whole time.
        defects.record(`queue drain (${batch.length} rows): ${deleteErr.message}`);
        continue;
      }
      const removed = deletedRows?.length ?? 0;
      drained += removed;
      if (removed < batch.length) {
        console.warn(
          `queue drain removed only ${removed}/${batch.length} rows — the rest will re-send the same digest tomorrow`,
        );
        defects.record(
          `queue drain matched ${removed}/${batch.length} rows with no error — undrained match_digest_queue rows re-send the same digest to the same people every day until they are deleted`,
        );
      }
    }

    return cronResult(
      "daily-match-digest",
      { users: byUser.size, queued: queueRows.length, drained },
      defects.defects,
      corsHeaders,
    );
  } catch (error: any) {
    console.error("daily-match-digest error:", error?.message ?? error);
    return cronError("daily-match-digest", error?.message ?? "digest failed", corsHeaders);
  }
});
