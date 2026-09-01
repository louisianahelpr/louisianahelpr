import { supabase } from "@/integrations/supabase/client";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import type { ConfigCheck } from "./useConfigChecks";

/**
 * Whether the scheduled jobs are actually running — on a screen someone opens.
 *
 * ── Why this card exists ────────────────────────────────────────────────────
 *
 * Roughly 40 pg_cron jobs run this product with no user in the loop: escrow
 * auto-release, cancellation-fee settlement, subscription expiry, the email
 * queue, every push and digest, and the sweeps that watch the other sweeps.
 * Before this card, NOTHING in the app rendered any of it. The only place a
 * dead or failing cron surfaced was a Slack message and rows in `error_logs`
 * that no screen reads. The 2026-09-01 cron audit found `money-reconciliation`
 * had not completed a single observed run since it was scheduled on 2026-08-28
 * — four days — and every dashboard was green the whole time.
 *
 * ── What each row is actually asserting ─────────────────────────────────────
 *
 * The distinction that matters here is the one 20260829020000 and
 * 20260901030926 are built around, so the card must not blur it:
 *
 *   LIVENESS  — did the job FIRE. Comes from `sweep_dead_crons()`, which reads
 *               `cron.job_run_details`. This is the only trustworthy source,
 *               because it sees SQL-only crons and jobs that have never run.
 *   ANSWERS   — what a run REPORTED. Comes from `cron_run_log`, which only
 *               holds runs that returned a JSON body inside pg_net's 5-second
 *               timeout. A cron that is healthy but slow is missing from it, so
 *               it is shown here as context and never as a liveness verdict.
 *
 * Conflating the two is exactly how a monitor reports an outage as an all-clear,
 * so "jobs reporting" below is deliberately phrased as an observation rather
 * than a pass/fail.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type ErrLog = { severity: string; message: string; tags: Record<string, unknown> | null };

export const useCronHealth = () => {
  return useInstantQuery<ConfigCheck[]>({
    key: ["admin-cron-health"],
    fallback: [],
    fetcher: async () => {
      const checks: ConfigCheck[] = [];
      const since = new Date(Date.now() - DAY_MS).toISOString();

      // ── 1. Liveness. `sweep_dead_crons()` writes one row per job per day
      // tagged cron-dead, with the verdict in tags.verdict: dead / never-ran /
      // unscheduled / inactive / erroring. Bounded well above the ~40 jobs that
      // could ever appear, so the 1000-row PostgREST cap is never in play.
      const { data: deadRows, error: deadErr } = await supabase
        .from("error_logs")
        .select("severity, message, tags")
        .eq("tags->>source", "cron-dead")
        .gte("created_at", since)
        .limit(100);

      if (deadErr) {
        // Never claim health we could not read. A failed check is "unknown",
        // never "ok" — that substitution is the bug this whole card is about.
        checks.push({
          id: "cron-liveness",
          label: "Cron liveness",
          tone: "unknown",
          detail: "Could not read the cron liveness log.",
        });
      } else {
        const dead = (deadRows ?? []) as ErrLog[];
        const byJob = new Map<string, string>();
        for (const r of dead) {
          const job = String(r.tags?.["job"] ?? "unknown");
          if (!byJob.has(job)) byJob.set(job, String(r.tags?.["verdict"] ?? "dead"));
        }
        checks.push(
          byJob.size > 0
            ? {
                id: "cron-liveness",
                label: "Cron liveness",
                tone: "danger",
                detail: `${byJob.size} job(s) not running as scheduled: ${[...byJob.entries()]
                  .map(([j, v]) => `${j} (${v})`)
                  .join(", ")}.`,
              }
            : {
                id: "cron-liveness",
                label: "Cron liveness",
                tone: "ok",
                detail: "Every scheduled job with a registered tolerance has fired within it.",
              },
        );
      }

      // ── 2. Runs that answered non-2xx in the last day. `sweep_cron_http_failures()`
      // records failures at `error` and pg_net timeouts at `warning`, and the
      // two mean different things: a non-2xx is the function reporting dropped
      // work, a timeout only means pg_net gave up at 5s while the function very
      // likely kept going. They are counted separately so a run of routine cold
      // starts never reads as a money-path failure.
      const { data: httpRows, error: httpErr } = await supabase
        .from("error_logs")
        .select("severity, message, tags")
        .eq("tags->>source", "cron-http")
        .gte("created_at", since)
        .limit(1000);

      if (httpErr) {
        checks.push({
          id: "cron-failures",
          label: "Cron run failures",
          tone: "unknown",
          detail: "Could not read the cron HTTP failure log.",
        });
      } else {
        const rows = (httpRows ?? []) as ErrLog[];
        const failures = rows.filter((r) => r.severity === "error");
        const timeouts = rows.filter((r) => r.severity === "warning");

        const worst = new Map<string, number>();
        for (const r of failures) {
          const job = String(r.tags?.["job"] ?? "unknown");
          worst.set(job, (worst.get(job) ?? 0) + 1);
        }
        const ranked = [...worst.entries()].sort((a, b) => b[1] - a[1]);

        checks.push(
          failures.length > 0
            ? {
                id: "cron-failures",
                label: "Cron run failures",
                tone: "danger",
                detail: `${failures.length} failed run(s) in 24h — ${ranked
                  .slice(0, 3)
                  .map(([j, n]) => `${j} ×${n}`)
                  .join(", ")}.`,
              }
            : {
                id: "cron-failures",
                label: "Cron run failures",
                tone: "ok",
                detail: "No scheduled run reported dropped work in the last 24h.",
              },
        );

        // Informational, not a pass/fail: a timeout is ambiguous by design.
        checks.push({
          id: "cron-timeouts",
          label: "Cron response times",
          tone: timeouts.length > 12 ? "warn" : "ok",
          detail:
            timeouts.length === 0
              ? "Every run answered inside pg_net's 5s window."
              : `${timeouts.length} run(s) took over 5s, so pg_net stopped waiting. The function itself very likely finished; only its answer was lost.`,
        });
      }

      // ── 3. Silent runs: found candidates, dispositioned none, twice running.
      // Written by `sweep_silent_cron_failures()`.
      const { data: silentRows } = await supabase
        .from("error_logs")
        .select("severity, message, tags")
        .eq("tags->>source", "cron-silent")
        .gte("created_at", since)
        .limit(100);

      const silent = (silentRows ?? []) as ErrLog[];
      checks.push(
        silent.length > 0
          ? {
              id: "cron-silent",
              label: "Silent cron runs",
              tone: "danger",
              detail: `${silent.length} job(s) found work and completed none of it: ${[
                ...new Set(silent.map((r) => String(r.tags?.["job"] ?? "unknown"))),
              ].join(", ")}.`,
            }
          : {
              id: "cron-silent",
              label: "Silent cron runs",
              tone: "ok",
              detail: "No job reported finding candidates and dispositioning none.",
            },
      );

      // ── 4. Context, deliberately not a verdict. See the header: cron_run_log
      // holds ANSWERS, not firings, so a low number here can mean "slow" as
      // easily as "stopped". The liveness row above is the one that judges.
      const { data: logRows } = await supabase
        .from("cron_run_log")
        .select("jobname")
        .gte("occurred_at", since)
        .limit(1000);
      const reporting = new Set((logRows ?? []).map((r) => (r as { jobname: string }).jobname));

      const { data: expectRows } = await supabase
        .from("cron_work_expectations")
        .select("jobname")
        .limit(100);
      const registered = (expectRows ?? []).length;

      // Stated as two independent facts, not as a ratio. The sets genuinely
      // differ — cron_run_log can only ever contain HTTP crons that answered,
      // while the tolerance list covers the SQL-only sweeps too — so "N of M"
      // would invite a comparison that is meaningless in both directions.
      checks.push({
        id: "cron-reporting",
        label: "Jobs reporting",
        tone: "ok",
        detail: `${reporting.size} job(s) returned a readable result in the last 24h. ${registered} job(s) have a registered liveness tolerance; the SQL-only sweeps among them never answer over HTTP, so they are judged by the liveness row above rather than counted here.`,
      });

      return checks;
    },
  });
};
