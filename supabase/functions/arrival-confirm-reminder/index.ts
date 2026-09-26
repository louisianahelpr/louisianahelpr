// arrival-confirm-reminder — nudges a poster to tap "Confirm They Arrived", then
// escalates to admin (VN-33, owner 2026-09-14: "Nudge, then escalate").
//
// Since 20260919155016 (owner, 2026-09-19) the poster's confirmation is the ONLY
// thing standing between a checked-in Helpr and their work — GPS-verified or
// not. Nothing else asks the poster: the only "has arrived" notice obeys their
// travel-update preference. So this runs off `helper_arrived_at`, the stamp the
// arrival RPC now writes on EVERY check-in; anchoring it on the GPS stamp (as
// it did until 2026-09-19) left exactly the Helprs who most need the tap — the
// ones whose phone had no fix — with nobody ever nudged on their behalf.
//
//   0h  push + email the poster        (ledger.first_sent_at)
//   2h  push + email them again         (ledger.second_sent_at)
//   24h admin notification + ops alert  (ledger.escalated_at); the Helpr is told
//       support has been asked to step in.
//
// NEAR MISS (wrong map pin): a Helpr who checked in >500 ft but within a mile
// of the pin has helper_arrival_near_miss_at and no GPS verification. The
// poster's tap is no longer time-limited, but a wrong pin is an operational
// problem worth an admin's eyes sooner, so admin is still escalated at 10h
// rather than 24h. mark_helper_arrival already sent "Is your Helpr at the
// door?" with the distance, so "first" is claimed without a second send.
//
// NO LOCATION AT ALL: the Helpr checked in with no usable fix. Nudged and
// escalated on the ordinary 0h / 2h / 24h clock, because there is nothing
// unusual about the job — only about their phone.
//
// Stage timing lives in _shared/arrivalNudge.ts (unit-tested). Each stage is
// CLAIMED in public.job_arrival_confirm_nudges with a conditional write before
// anything is sent, so two overlapping runs cannot double-send; a claim that
// matches zero rows means another run already took it.
//
// Auth: CRON_SECRET or service-role bearer. Schedule: every 10 min
// (20260915070651).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { scanAll, scanDefect } from "../_shared/paginate.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { seedBoundaryDropsRow } from "../_shared/seedBoundary.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { arrivalNudgeStage, NEAR_MISS_ESCALATE_AFTER_HOURS, type NudgeLedger } from "../_shared/arrivalNudge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DueJob = {
  id: string;
  title: string;
  customer_id: string | null;
  helper_id: string | null;
  helper_arrived_at: string | null;
  helper_arrival_verified_at: string | null;
  helper_arrival_near_miss_at: string | null;
  helper_arrival_near_miss_ft: number | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (
    !authHeader ||
    ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) &&
      (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))
  ) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  // Reads are bounded and retried: on 2026-09-25 17:34Z one stalled read kept
  // this run for 42.8s, past pg_net's 30s, while the query itself took 59ms
  // (see _shared/boundedFetch.ts for the measurements).
  const supabase = createClient(supabaseUrl, serviceRoleKey, { global: { fetch: boundedFetch() } });
  const defects = defectTracker();
  const now = new Date();

  // Push is fanned out by the notifications insert trigger; email is sent
  // explicitly and its answer is read, the way review-nag-cron does.
  // `jobId` is the SUBJECT (Q139): the Q137 seed boundary reads it, so a seed
  // job never notifies a real account. A zero-row insert the boundary dropped
  // BY DESIGN is not a defect, and that recipient gets no email either.
  const notifyUser = async (userId: string, title: string, message: string, link: string, type: string, jobId: string) => {
    const { data, error } = await supabase
      .from("notifications")
      .insert({ user_id: userId, job_id: jobId, title, message, type, link })
      .select("id");
    if (error) throw error;
    if ((data?.length ?? 0) === 0) {
      if ((await seedBoundaryDropsRow(supabase, { user_id: userId, job_id: jobId, link })) === true) return;
      throw new Error(`notification insert matched 0 rows for ${userId}`);
    }
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ user_id: userId, title, message, type, link, job_id: jobId }),
      });
      if (!res.ok) defects.record(`email ${userId}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    } catch (e) {
      defects.record(`email ${userId}: ${(e as Error).message}`);
    }
  };

  /** Claim one stage. true = this run owns it; false = already taken. */
  const claim = async (jobId: string, stage: "first" | "second" | "escalate"): Promise<boolean> => {
    const stamp = now.toISOString();
    if (stage === "first") {
      const { data, error } = await supabase
        .from("job_arrival_confirm_nudges")
        .upsert({ job_id: jobId, first_sent_at: stamp }, { onConflict: "job_id", ignoreDuplicates: true })
        .select("job_id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    }
    const col = stage === "second" ? "second_sent_at" : "escalated_at";
    const { data, error } = await supabase
      .from("job_arrival_confirm_nudges")
      .update({ [col]: stamp })
      .eq("job_id", jobId)
      .is(col, null)
      .select("job_id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  };

  try {
    const scan = await scanAll<DueJob>("awaiting poster arrival confirm", (countOpt) =>
      supabase
        .from("jobs")
        .select("id, title, customer_id, helper_id, helper_arrived_at, helper_arrival_verified_at, helper_arrival_near_miss_at, helper_arrival_near_miss_ft", countOpt)
        .order("id", { ascending: true })
        .in("status", ["accepted", "in_progress"])
        // Fixture rows are driven by test harnesses, never by a real poster;
        // nudging and escalating them would page admins about seed data (4 such
        // rows on prod at ship time). Same scope as money-reconciliation.
        .eq("is_seed", false)
        // EVERY recorded check-in, not just the GPS-backed ones (20260919155016).
        .not("helper_arrived_at", "is", null)
        .is("poster_confirmed_arrival_at", null)
        .not("customer_id", "is", null)
        .not("helper_id", "is", null),
    );
    if (scan.error) return cronError("arrival-confirm-reminder", scan.error.message, corsHeaders);
    const short = scanDefect("awaiting poster arrival confirm", scan);
    if (short) defects.record(short);

    const ids = scan.rows.map((j) => j.id);
    const ledgers = new Map<string, NudgeLedger>();
    if (ids.length > 0) {
      const { data, error } = await supabase
        .from("job_arrival_confirm_nudges")
        .select("job_id, first_sent_at, second_sent_at, escalated_at")
        .in("job_id", ids);
      if (error) throw error;
      for (const r of data ?? []) ledgers.set(r.job_id, r);
    }

    const counts = { first: 0, second: 0, escalate: 0, errors: 0 };
    for (const job of scan.rows) {
      // The check-in itself is the anchor: it is stamped on every call, and it
      // is the moment the poster's tap became owed. (The GPS/near-miss stamps
      // are written in the same statement, so this does not move the clock for
      // an arrival that had either — it just stops dropping the ones with
      // neither.)
      const verified = !!job.helper_arrival_verified_at;
      const nearMiss = !verified && !!job.helper_arrival_near_miss_at;
      const anchor = (job.helper_arrived_at ?? job.helper_arrival_verified_at ?? job.helper_arrival_near_miss_at)!;
      const stage = nearMiss
        ? arrivalNudgeStage(anchor, ledgers.get(job.id) ?? null, now, NEAR_MISS_ESCALATE_AFTER_HOURS)
        : arrivalNudgeStage(anchor, ledgers.get(job.id) ?? null, now);
      if (!stage) continue;
      try {
        if (!(await claim(job.id, stage))) continue;
        const posterLink = `/posts?job=${job.id}`;
        if (stage === "first" && nearMiss) {
          // mark_helper_arrival already sent "Is your Helpr at the door?".
        } else if (stage === "second" && nearMiss) {
          await notifyUser(
            job.customer_id!,
            "Is your Helpr at the door?",
            `"${job.title}" — they checked in ${job.helper_arrival_near_miss_ft ?? "some"} ft from the map pin. If they're there, tap Confirm They Arrived, or report a problem.`,
            posterLink,
            "job_updates",
            job.id,
          );
        } else if (stage === "first" || stage === "second") {
          await notifyUser(
            job.customer_id!,
            stage === "first" ? "Your Helpr is at the job" : "Please confirm your Helpr arrived",
            stage === "first"
              ? `"${job.title}" — tap Confirm They Arrived so they can start work.`
              : `"${job.title}" — your Helpr has been waiting 2 hours. Confirm they arrived, or report a problem.`,
            posterLink,
            "job_updates",
            job.id,
          );
        } else {
          const { data: admins, error: adminsErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
          if (adminsErr) throw adminsErr;
          for (const a of admins ?? []) {
            await notifyUser(
              a.user_id,
              nearMiss ? "Arrival near a wrong pin not confirmed" : "Arrival not confirmed in 24h",
              nearMiss
                ? `"${job.title}" — the Helpr checked in ${job.helper_arrival_near_miss_ft ?? "?"} ft from the map pin ${NEAR_MISS_ESCALATE_AFTER_HOURS}h ago and the poster hasn't confirmed. Contact them, check the pin, or open a dispute.`
                : verified
                  ? `"${job.title}" — the Helpr's location was verified 24h ago and the poster hasn't confirmed. Confirm the arrival or open a dispute.`
                  : `"${job.title}" — the Helpr checked in 24h ago with no usable location and the poster hasn't confirmed. Contact both, or open a dispute.`,
              // There is no arrival queue; the admin acts on ONE job here —
              // contact both parties, check the pin, or open a dispute — and
              // `?view=jobs` + `?job=` is the only admin surface that opens a
              // named job's detail (AdminJobs.tsx's deep-link effect). The bare
              // `/admin?job=<id>` this used to send was read by nobody:
              // Admin.tsx reads `?view=` only, so AdminJobs never mounted and
              // every one of these alerts landed on the dashboard home.
              `/admin?view=jobs&job=${job.id}`,
              "admin_alert",
              job.id,
            );
          }
          await notifyUser(
            job.helper_id!,
            "We've asked support to step in",
            `"${job.title}" — the person who posted this job hasn't confirmed your arrival, so our team is reviewing it.`,
            `/jobs?job=${job.id}`,
            "job_updates",
            job.id,
          );
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: nearMiss ? "Near-miss arrival not confirmed" : "Arrival not confirmed in 24h",
            message: nearMiss
              ? `Job ${job.id} — Helpr checked in ${job.helper_arrival_near_miss_ft ?? "?"} ft from the pin at ${job.helper_arrival_near_miss_at}; poster has not confirmed.`
              : verified
                ? `Job ${job.id} — GPS arrival verified at ${job.helper_arrival_verified_at}; poster has not confirmed.`
                : `Job ${job.id} — Helpr checked in at ${job.helper_arrived_at} with no usable location; poster has not confirmed.`,
            fields: { job_id: job.id },
            oncePerDayKey: `arrival-confirm-escalation:${job.id}`,
          });
        }
        counts[stage] += 1;
      } catch (e) {
        counts.errors += 1;
        defects.record(`${stage} ${job.id}: ${(e as Error).message ?? String(e)}`);
      }
    }

    return cronResult(
      "arrival-confirm-reminder",
      { processed: scan.rows.length, sent: counts.first + counts.second + counts.escalate, ...counts },
      { count: defects.count, reasons: defects.reasons },
      corsHeaders,
    );
  } catch (e) {
    return cronError("arrival-confirm-reminder", (e as Error).message ?? String(e), corsHeaders);
  }
});
