// stalled-completion-reminder — the missing sweep for a job that is
// `in_progress` and that NOBODY ever marked done.
//
// THE HOLE IT FILLS. Every other scheduled sweep needs a stamp this job does
// not have: auto-expire-jobs wants `accepted`/`open`, auto-release-payment
// wants one of the two completion stamps, arrival-confirm-reminder wants an
// unconfirmed arrival. So a job whose Helpr simply never tapped "Mark Job
// Complete" held its escrow forever, and the person who posted it was shown no
// Approve control and no explanation. Eleven rows were in that trap on prod
// when this was written. See `_shared/stalledCompletion.ts` for the evidence
// and for where the three thresholds come from.
//
// THE LADDER (owner, 2026-09-19: "Nudge both, then admin queue. Never move
// money automatically."), measured from the job's SCHEDULED END:
//
//   +2h  → push + email BOTH parties                  (ledger.first_sent_at)
//   +24h → push + email BOTH parties again            (ledger.second_sent_at)
//   +48h → a queue item awaiting an admin, an admin_alert per admin, an ops
//          alert, and both parties told a person is looking (ledger.escalated_at)
//
// MONEY NEVER MOVES HERE. This function releases nothing and refunds nothing.
// Stage three is a QUEUE ITEM — `admin_stalled_job_queue()` returns it and an
// admin clears it with `resolve_stalled_job_flag()`. It is deliberately not an
// `admin_audit_log` row: every row there names an `admin_id`, and no admin has
// acted yet.
//
// Each stage is CLAIMED in public.job_completion_nudges with a conditional
// write before anything is sent, so two overlapping runs cannot double-send; a
// claim matching zero rows means another run took it.
//
// SEED ROWS ARE SWEPT TOO — no `is_seed` filter anywhere on this path (owner,
// 2026-09-19, pop-up, verbatim: "Sweep everything, fixtures included."). This
// deliberately DIVERGES from arrival-confirm-reminder and money-reconciliation,
// which both keep `.eq("is_seed", false)`; the owner was shown the tradeoff —
// escalating a fixture puts a fake job in front of whoever works the admin
// queue — and chose it anyway. It is also the only way this sweep can be seen
// working at all: all eleven rows in the trap on prod are `is_seed = true`.
// Do not "restore consistency" with the other two sweeps here.
//
// seed-policy: swept, nudged and queued like real jobs (above); only the OPS
// ALERT differs — a seed job's Slack escalation goes to the daily digest
// (postSlackOpsAlert `seed`), and the admin notification names the job so the
// push->Slack mirror can do the same (docs/OPEN.md Q2, 2026-09-23).
//
// Auth: CRON_SECRET or service-role bearer. Schedule: daily at 14:00 UTC
// (9am CDT / 8am CST) — see the migration. A daily run is deliberate: the
// anchor is the end of a calendar day, so a finer cron would only buy the
// ability to push someone at 2am.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { scanAll, scanDefect } from "../_shared/paginate.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import {
  hoursPastScheduledEnd,
  stalledCompletionStage,
  STALLED_ADMIN_TITLE,
  STALLED_ESCALATED_TITLE,
  STALLED_NUDGE_TITLE_POSTED,
  STALLED_NUDGE_TITLE_WORKING,
  stalledAdminBody,
  stalledEscalatedBody,
  stalledNudgeBodyPosted,
  stalledNudgeBodyWorking,
  type NudgeLedger,
  type StalledEvidence,
} from "../_shared/stalledCompletion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type StalledJob = StalledEvidence & {
  id: string;
  title: string;
  customer_id: string | null;
  helper_id: string | null;
  is_seed: boolean | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const defects = defectTracker();
  const now = new Date();

  // Push is fanned out by the notifications insert trigger; email is sent
  // explicitly and its answer is read (same shape as arrival-confirm-reminder).
  const notifyUser = async (
    userId: string,
    title: string,
    message: string,
    link: string,
    type: string,
  ) => {
    // .select("id"): a null `error` is not a write. Without the row count back
    // there is no way to tell a landed insert from a silent no-op.
    const { data, error } = await supabase
      .from("notifications")
      .insert({ user_id: userId, title, message, type, link })
      .select("id");
    if (error) throw error;
    if ((data?.length ?? 0) === 0) throw new Error(`notification insert matched 0 rows for ${userId}`);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ user_id: userId, title, message, type, link }),
      });
      if (!res.ok) {
        defects.record(
          `email ${userId}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`,
        );
      }
    } catch (e) {
      defects.record(`email ${userId}: ${(e as Error).message}`);
    }
  };

  /** Claim one stage. true = this run owns it; false = another run took it. */
  const claim = async (jobId: string, stage: "first" | "second" | "escalate"): Promise<boolean> => {
    const stamp = now.toISOString();
    if (stage === "first") {
      const { data, error } = await supabase
        .from("job_completion_nudges")
        .upsert({ job_id: jobId, first_sent_at: stamp }, { onConflict: "job_id", ignoreDuplicates: true })
        .select("job_id");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    }
    const col = stage === "second" ? "second_sent_at" : "escalated_at";
    const { data, error } = await supabase
      .from("job_completion_nudges")
      .update({ [col]: stamp })
      .eq("job_id", jobId)
      .is(col, null)
      .select("job_id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  };

  try {
    // DB-side prefilter only — coarse and generous. The exact "is the scheduled
    // work over?" comparison needs start_time + estimated_hours resolved in
    // America/Chicago, which PostgREST cannot express, so it happens below
    // against the same `stalledCompletionStage` the app's card reads.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

    const scan = await scanAll<StalledJob>("in_progress with no completion stamp", (countOpt) =>
      supabase
        .from("jobs")
        .select(
          "id, title, status, customer_id, helper_id, date_needed, start_time, estimated_hours, helper_completed_at, poster_completed_at, is_seed",
          countOpt,
        )
        .order("id", { ascending: true })
        .eq("status", "in_progress")
        .eq("payment_status", "escrow")
        // No `is_seed` clause, on purpose — see the header. Seed jobs are
        // nudged and escalated exactly like real ones.
        .is("helper_completed_at", null)
        .is("poster_completed_at", null)
        .lte("date_needed", today)
        .not("customer_id", "is", null)
        .not("helper_id", "is", null),
    );
    if (scan.error) return cronError("stalled-completion-reminder", scan.error.message, corsHeaders);
    const short = scanDefect("in_progress with no completion stamp", scan);
    if (short) defects.record(short);

    const ids = scan.rows.map((j) => j.id);
    const ledgers = new Map<string, NudgeLedger>();
    if (ids.length > 0) {
      const { data, error } = await supabase
        .from("job_completion_nudges")
        .select("job_id, first_sent_at, second_sent_at, escalated_at")
        .in("job_id", ids);
      if (error) throw error;
      for (const r of data ?? []) ledgers.set(r.job_id, r);
    }

    const counts = { first: 0, second: 0, escalate: 0, errors: 0 };
    for (const job of scan.rows) {
      const stage = stalledCompletionStage(job, ledgers.get(job.id) ?? null, now);
      if (!stage) continue;
      try {
        if (!(await claim(job.id, stage))) continue;
        const postedLink = `/my-posts?job=${job.id}`;
        const workingLink = `/my-jobs?job=${job.id}`;

        if (stage === "first" || stage === "second") {
          const second = stage === "second";
          // BOTH sides, every time — the owner's rule is "nudge both". One of
          // them is the only person who can end this, and neither of them knows
          // which until they talk.
          await notifyUser(
            job.customer_id!,
            STALLED_NUDGE_TITLE_POSTED,
            stalledNudgeBodyPosted(job.title, second),
            postedLink,
            "job_updates",
          );
          await notifyUser(
            job.helper_id!,
            STALLED_NUDGE_TITLE_WORKING,
            stalledNudgeBodyWorking(job.title, second),
            workingLink,
            "job_updates",
          );
        } else {
          // The ledger row claimed above IS the queue item: escalated_at set,
          // resolved_at null, read by admin_stalled_job_queue(). No
          // admin_audit_log row is written — no admin has acted yet.
          const hours = hoursPastScheduledEnd(job, now);
          const { data: admins, error: adminsErr } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("role", "admin");
          if (adminsErr) throw adminsErr;
          for (const a of admins ?? []) {
            await notifyUser(
              a.user_id,
              STALLED_ADMIN_TITLE,
              stalledAdminBody(job.title, hours),
              // The Stuck Jobs queue (`?view=stalled` in Admin.tsx's VIEW_LABELS
              // / adminNavGroups) is the screen built for exactly this row —
              // `admin_stalled_job_queue()` is what it renders, and "Mark
              // Reviewed" is the action this alert is asking for. It used to
              // be `/admin?job=<id>`, which Admin.tsx never reads (it reads
              // `?view=` only), so the alert landed on the dashboard home.
              // The `&job=` names the SUBJECT (2026-09-23, Q2): the admin
              // Slack mirror keys its once-a-day dedupe on title + link, so
              // without it every stalled job that day was ONE post (a real
              // job's page could be swallowed by a seed job's), and the
              // mirror could not tell a seed job's alert from a real one.
              `/admin?view=stalled&job=${job.id}`,
              "admin_alert",
            );
          }
          await notifyUser(
            job.customer_id!,
            STALLED_ESCALATED_TITLE,
            stalledEscalatedBody(job.title),
            postedLink,
            "job_updates",
          );
          await notifyUser(
            job.helper_id!,
            STALLED_ESCALATED_TITLE,
            stalledEscalatedBody(job.title),
            workingLink,
            "job_updates",
          );
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Job stalled with escrow held",
            message: `Job ${job.id} — in_progress, ${Math.round(hours)}h past its scheduled end, neither completion stamp set. Escrow still held. Needs a human decision; nothing moves automatically.`,
            fields: { job_id: job.id },
            oncePerDayKey: `stalled-completion-escalation:${job.id}`,
            // Seed jobs are still swept and queued (owner, 2026-09-19); their
            // ops alert goes to the daily digest instead of paging.
            seed: job.is_seed === true,
          });
        }
        counts[stage] += 1;
      } catch (e) {
        counts.errors += 1;
        defects.record(`${stage} ${job.id}: ${(e as Error).message ?? String(e)}`);
      }
    }

    return cronResult(
      "stalled-completion-reminder",
      {
        processed: scan.rows.length,
        sent: counts.first + counts.second + counts.escalate,
        ...counts,
      },
      { count: defects.count, reasons: defects.reasons },
      corsHeaders,
    );
  } catch (e) {
    return cronError("stalled-completion-reminder", (e as Error).message ?? String(e), corsHeaders);
  }
});
