import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import type { HealthData, ParishStat } from "./types";
import { report } from "@/lib/errorLogger";

export const useHealthData = () => {
  const queryKey = ["admin-health"];
  const query = useInstantQuery<HealthData>({
    key: queryKey,
    fallback: {
      emailStats: { total: 0, sent: 0, failed: 0, suppressed: 0 },
      pushStats: { total: 0, ios: 0, android: 0, latestAt: null },
      fraudCount: 0,
      adminPushTokenCount: 0,
      recentJobs: { open: 0, completed: 0, disputed: 0, cancelled: 0 },
      healthStatus: "unknown",
      parishStats: [],
      medianTimeToFirstAppMin: null,
      jobsAwaitingApps: 0,
    },
    fetcher: async () => {
      // Email stats (last 24h)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [sentRes, failedRes, suppressedRes] = await Promise.all([
        supabase.from("email_send_log").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", since),
        supabase.from("email_send_log").select("id", { count: "exact", head: true }).eq("status", "dlq").gte("created_at", since),
        supabase.from("email_send_log").select("id", { count: "exact", head: true }).eq("status", "suppressed").gte("created_at", since),
      ]);
      const sent = sentRes.count || 0;
      const failed = failedRes.count || 0;
      const suppressed = suppressedRes.count || 0;
      const emailStats = { total: sent + failed + suppressed, sent, failed, suppressed };

      const { count: fc, error: fcErr } = await supabase.from("fraud_flags").select("id", { count: "exact", head: true }).eq("resolved", false);
      if (fcErr) throw fcErr;
      const fraudCount = fc || 0;

      // Push token stats — useful at-a-glance for "is push working" debugging.
      const [pushTotalRes, pushIosRes, pushAndroidRes, pushLatestRes] = await Promise.all([
        supabase.from("push_tokens").select("id", { count: "exact", head: true }),
        supabase.from("push_tokens").select("id", { count: "exact", head: true }).eq("platform", "ios"),
        supabase.from("push_tokens").select("id", { count: "exact", head: true }).eq("platform", "android"),
        supabase.from("push_tokens").select("updated_at").order("updated_at", { ascending: false }).limit(1),
      ]);
      const pushStats = {
        total: pushTotalRes.count || 0,
        ios: pushIosRes.count || 0,
        android: pushAndroidRes.count || 0,
        latestAt: (pushLatestRes.data?.[0]?.updated_at as string | undefined) ?? null,
      };

      // Death-blow check: admin notifications fan to push, but if no
      // admin has installed Build #17+ and signed in, every safety
      // alert (auto-restrict, fraud flags, dispute escalations,
      // stuck-payment) fans into the void. Surface this prominently
      // so it can't be missed during launch.
      // Don't drop the error: this powers the "do admins have push tokens?"
      // health check. A failed read yields zero admin ids, which renders as a
      // confident "0 admins have push tokens" alert — indistinguishable from
      // the real failure it is meant to detect.
      const { data: adminUserIds, error: adminUserIdsError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      if (adminUserIdsError) {
        report(adminUserIdsError, { severity: "warning", tags: { source: "useHealthData.adminIds" } });
      }
      const adminIds = (adminUserIds ?? []).map((r) => r.user_id);
      let adminPushTokenCount = 0;
      if (adminIds.length > 0) {
        const { count } = await supabase
          .from("push_tokens")
          .select("id", { count: "exact", head: true })
          .in("user_id", adminIds);
        adminPushTokenCount = count || 0;
      }

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [openRes, compRes, dispRes, cancelRes] = await Promise.all([
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "open").gte("created_at", weekAgo),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed").gte("updated_at", weekAgo),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "disputed").gte("updated_at", weekAgo),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "cancelled").gte("updated_at", weekAgo),
      ]);
      const recentJobs = {
        open: openRes.count || 0,
        completed: compRes.count || 0,
        disputed: dispRes.count || 0,
        cancelled: cancelRes.count || 0,
      };

      let healthStatus: "ok" | "degraded" | "unknown";
      try {
        const { data: hc, error } = await supabase.functions.invoke("health-check");
        healthStatus = error ? "degraded" : (hc?.status === "healthy" ? "ok" : "degraded");
      } catch {
        healthStatus = "degraded";
      }

      // ── Marketplace pulse: open-jobs-by-parish, supply ratio, time-to-first-app
      // Volumes are still small (~tens of open jobs, low hundreds of helpers),
      // so client-side aggregation is fine. Convert to an RPC if either query
      // routinely returns more than a few hundred rows.
      // Supply is counted from `profiles.parish` — the parish derived from each
      // account's ZIP. It used to be counted from `helper_preferred_parishes`,
      // which meant this panel reported ZERO helpers in every parish for the
      // life of the product: nothing could ever write that table, so it was
      // permanently empty, and it was removed on 2026-09-07 (migration
      // 20260907194734). `profiles.parish` is the same signal the two server
      // paths that matter already use — `get_ranked_open_jobs`' parish rung and
      // `notify_helpers_on_job_post`'s fan-out — so the panel now measures the
      // supply those paths actually reach.
      const [openJobs, helperProfiles] = await Promise.all([
        (async () =>
          unwrap(
            await supabase.from("jobs").select("id, parish, created_at").eq("status", "open"),
          ) as { id: string; parish: string | null; created_at: string }[])(),
        (async () =>
          unwrap(
            await supabase
              .from("profiles")
              .select("user_id, parish, ban_status")
              .not("parish", "is", null)
              .eq("approval_status", "approved"),
          ) as { user_id: string; parish: string | null; ban_status: string | null }[])(),
      ]);

      const helperRows = helperProfiles
        .filter((p) => p.ban_status !== "banned")
        .map((p) => ({ parish: p.parish, helper_id: p.user_id }));

      const openByParish = new Map<string, number>();
      for (const j of openJobs) {
        if (!j.parish) continue;
        openByParish.set(j.parish, (openByParish.get(j.parish) ?? 0) + 1);
      }
      const helpersByParish = new Map<string, Set<string>>();
      for (const h of helperRows) {
        if (!h.parish) continue;
        if (!helpersByParish.has(h.parish)) helpersByParish.set(h.parish, new Set());
        helpersByParish.get(h.parish)!.add(h.helper_id);
      }
      const allParishes = new Set<string>([...openByParish.keys(), ...helpersByParish.keys()]);
      const parishStats: ParishStat[] = [...allParishes]
        .map((parish) => {
          const openJobsCount = openByParish.get(parish) ?? 0;
          const activeHelpers = helpersByParish.get(parish)?.size ?? 0;
          // Ratio = helpers per open job. Higher = healthier supply.
          // null when there are no open jobs (no demand to evaluate against).
          const ratio = openJobsCount > 0 ? activeHelpers / openJobsCount : null;
          return { parish, openJobs: openJobsCount, activeHelpers, ratio };
        })
        // Show parishes with demand first, then by helper count
        .sort((a, b) => (b.openJobs - a.openJobs) || (b.activeHelpers - a.activeHelpers))
        .slice(0, 10);

      // Median time-to-first-application for jobs posted in the last 7 days.
      // Job ids fetched above (only open ones); also pull recently-claimed
      // jobs so we don't bias toward unanswered listings.
      const recentJobsForApps = await supabase
        .from("jobs")
        .select("id, created_at")
        .gte("created_at", weekAgo);
      const jobIds = (recentJobsForApps.data || []).map((j) => j.id);
      let medianTimeToFirstAppMin: number | null = null;
      let jobsAwaitingApps = 0;
      if (jobIds.length > 0) {
        // Don't drop the error: a failed read makes every job look like it has
        // zero applications, inflating "jobs awaiting applications" and voiding
        // the median-time-to-first-application metric with no signal.
        const { data: appRows, error: appRowsError } = await supabase
          .from("applications")
          .select("job_id, created_at")
          .in("job_id", jobIds)
          .order("created_at", { ascending: true });
        if (appRowsError) {
          report(appRowsError, { severity: "warning", tags: { source: "useHealthData.applications" } });
        }
        const firstAppByJob = new Map<string, string>();
        for (const a of (appRows || []) as { job_id: string; created_at: string }[]) {
          if (!firstAppByJob.has(a.job_id)) firstAppByJob.set(a.job_id, a.created_at);
        }
        const jobCreatedById = new Map<string, string>();
        for (const j of (recentJobsForApps.data || []) as { id: string; created_at: string }[]) {
          jobCreatedById.set(j.id, j.created_at);
        }
        const deltasMin: number[] = [];
        for (const [jobId, firstAppAt] of firstAppByJob) {
          const created = jobCreatedById.get(jobId);
          if (!created) continue;
          deltasMin.push((new Date(firstAppAt).getTime() - new Date(created).getTime()) / 60000);
        }
        jobsAwaitingApps = jobIds.length - firstAppByJob.size;
        if (deltasMin.length > 0) {
          deltasMin.sort((a, b) => a - b);
          const mid = Math.floor(deltasMin.length / 2);
          medianTimeToFirstAppMin = deltasMin.length % 2
            ? deltasMin[mid]
            : (deltasMin[mid - 1] + deltasMin[mid]) / 2;
        }
      }

      return { emailStats, pushStats, fraudCount, adminPushTokenCount, recentJobs, healthStatus, parishStats, medianTimeToFirstAppMin, jobsAwaitingApps };
    },
  });

  return { queryKey, ...query };
};
