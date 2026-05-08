import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Mail, ShieldAlert, Database, Bug, MapPin, Zap, Bell, Send, Loader2 } from "lucide-react";
import { report } from "@/lib/errorLogger";
import { toast } from "@/hooks/use-toast";
import { useInstantQuery } from "@/hooks/useInstantQuery";

type ParishStat = { parish: string; openJobs: number; activeHelpers: number; ratio: number | null };

type HealthData = {
  emailStats: { total: number; sent: number; failed: number; suppressed: number };
  pushStats: { total: number; ios: number; android: number; latestAt: string | null };
  fraudCount: number;
  adminPushTokenCount: number;
  recentJobs: { open: number; completed: number; disputed: number; cancelled: number };
  healthStatus: "ok" | "degraded" | "unknown";
  parishStats: ParishStat[];
  medianTimeToFirstAppMin: number | null;
  jobsAwaitingApps: number;
};

const AdminHealth = () => {
  const qc = useQueryClient();
  const queryKey = ["admin-health"];
  const [sendingTestPush, setSendingTestPush] = useState(false);

  // Send a test push to the admin's own user_id. Verifies the entire
  // pipeline (push_tokens lookup → APNs/FCM auth → device delivery)
  // without needing to wait on a real notification trigger to fire.
  const sendTestPush = async () => {
    setSendingTestPush(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "Not signed in", variant: "destructive" });
        return;
      }
      const { data, error } = await supabase.functions.invoke("send-push-notification", {
        body: {
          user_id: user.id,
          title: "Helpr",
          body: "Test push from Admin Health · " + new Date().toLocaleTimeString(),
          thread_id: "admin_test",
        },
      });
      if (error) throw error;
      const result = data as {
        sent?: number; failed?: number; no_tokens?: boolean;
        skipped?: string; total?: number;
      };
      if (result.skipped) {
        toast({ title: "Push backend not configured", description: result.skipped });
      } else if (result.no_tokens) {
        toast({ title: "No registered devices", description: "Open the app on your phone and grant push permission first." });
      } else if ((result.sent ?? 0) > 0) {
        toast({ title: `Pushed to ${result.sent}/${result.total} device${result.total === 1 ? "" : "s"}`, description: "Check your phone." });
      } else {
        toast({ title: "All sends failed", description: `0 of ${result.total} succeeded`, variant: "destructive" });
      }
    } catch (err) {
      report(err, { tags: { source: "AdminHealth.sendTestPush" } });
      toast({ title: "Test push failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSendingTestPush(false);
    }
  };

  const { data, isFetching } = useInstantQuery<HealthData>({
    key: queryKey,
    fallback: {
      emailStats: { total: 0, sent: 0, failed: 0, suppressed: 0 },
      pushStats: { total: 0, ios: 0, android: 0, latestAt: null },
      fraudCount: 0,
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

      const { count: fc } = await supabase.from("fraud_flags").select("id", { count: "exact", head: true }).eq("resolved", false);
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
      const { data: adminUserIds } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
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
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "disputed" as any).gte("updated_at", weekAgo),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "cancelled").gte("updated_at", weekAgo),
      ]);
      const recentJobs = {
        open: openRes.count || 0,
        completed: compRes.count || 0,
        disputed: dispRes.count || 0,
        cancelled: cancelRes.count || 0,
      };

      let healthStatus: "ok" | "degraded" | "unknown" = "unknown";
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
      const [openJobsRes, helperParishRes] = await Promise.all([
        supabase.from("jobs").select("id, parish, created_at").eq("status", "open"),
        supabase.from("helper_preferred_parishes")
          .select("parish, helper_id, profiles!inner(approval_status, ban_status)")
          .eq("profiles.approval_status", "approved")
          .neq("profiles.ban_status", "banned"),
      ]);

      const openJobs = (openJobsRes.data || []) as { id: string; parish: string | null; created_at: string }[];
      const helperRows = (helperParishRes.data || []) as { parish: string; helper_id: string }[];

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
        const { data: appRows } = await supabase
          .from("applications")
          .select("job_id, created_at")
          .in("job_id", jobIds)
          .order("created_at", { ascending: true });
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

  const { emailStats, pushStats, fraudCount, adminPushTokenCount, recentJobs, healthStatus, parishStats, medianTimeToFirstAppMin, jobsAwaitingApps } = data;

  const formatDelay = (mins: number | null): string => {
    if (mins === null) return "—";
    if (mins < 60) return `${Math.round(mins)} min`;
    if (mins < 60 * 24) return `${(mins / 60).toFixed(1)} h`;
    return `${(mins / 60 / 24).toFixed(1)} d`;
  };

  const statusBadge = {
    ok: <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Healthy</Badge>,
    degraded: <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Degraded</Badge>,
    unknown: <Badge className="bg-muted text-muted-foreground">Checking…</Badge>,
  };

  return (
    <div className="space-y-6">
      {/* Death-blow banner — every admin alert this codebase fans
          (auto-restrict, fraud, disputes, stuck-payments) routes via
          push_tokens. With zero admin tokens registered, it all goes
          to in-app only and gets missed in real time. Surfacing as a
          loud red banner so it can't be ignored during launch. */}
      {adminPushTokenCount === 0 && (
        <div className="rounded-xl border-2 border-destructive/40 bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <Activity className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-bold text-foreground">
                ⚠️ No admin has registered a push token
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Every admin notification (fraud flags, auto-restrict reverses,
                dispute escalations, stuck-payment alerts) fans through{" "}
                <code className="text-[10px] bg-muted px-1 rounded">push_tokens</code>.
                With zero admin tokens, those alerts only show up if you happen
                to refresh this dashboard. Install the latest iOS build, sign in,
                and confirm a token lands here.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" /> System Health
        </h2>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey })} disabled={isFetching}>
          <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Status overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-xl liquid-glass p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Database className="w-4 h-4" /> Backend Functions
            </span>
            {statusBadge[healthStatus]}
          </div>
        </div>

        <div className="rounded-xl liquid-glass p-5 space-y-2">
          <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Emails (24h)
          </span>
          <div className="flex gap-3 text-sm">
            <span className="text-green-600 font-semibold">{emailStats.sent} sent</span>
            <span className="text-red-600 font-semibold">{emailStats.failed} failed</span>
            <span className="text-yellow-600 font-semibold">{emailStats.suppressed} suppressed</span>
          </div>
        </div>

        <div className="rounded-xl liquid-glass p-5 space-y-2">
          <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4" /> Fraud Flags
          </span>
          <p className={`text-lg font-bold ${fraudCount > 0 ? "text-destructive" : "text-foreground"}`}>
            {fraudCount} unresolved
          </p>
        </div>
      </div>

      {/* Sentry test — admin-only sanity check */}
      <div className="rounded-xl liquid-glass p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
              <Bug className="w-4 h-4" /> Sentry Smoke Test
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Fires a test exception to confirm Sentry, PostHog, and error_logs are receiving events.
              Should appear in Sentry within ~30 seconds.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                report(new Error(`Sentry smoke test (manual) — ${new Date().toISOString()}`), {
                  severity: "info",
                  tags: { source: "admin_smoke_test", kind: "manual" },
                });
                toast({ title: "Test event sent", description: "Check Sentry in ~30 seconds." });
              }}
            >
              Send test event
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setTimeout(() => {
                  throw new Error(`Sentry uncaught test — ${new Date().toISOString()}`);
                }, 0);
                toast({ title: "Throwing uncaught error", description: "Check Sentry in ~30 seconds." });
              }}
            >
              Throw uncaught
            </Button>
          </div>
        </div>
      </div>

      {/* Job activity (7 days) */}
      <div className="rounded-xl liquid-glass p-5 space-y-3">
        <h3 className="font-semibold text-foreground text-sm">Job Activity (Last 7 Days)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{recentJobs.open}</p>
            <p className="text-xs text-muted-foreground">New Jobs</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{recentJobs.completed}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{recentJobs.disputed}</p>
            <p className="text-xs text-muted-foreground">Disputed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-yellow-600">{recentJobs.cancelled}</p>
            <p className="text-xs text-muted-foreground">Cancelled</p>
          </div>
        </div>
      </div>

      {/* Marketplace pulse: parish-level supply/demand + responsiveness */}
      <div className="rounded-xl liquid-glass p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
            <MapPin className="w-4 h-4" /> Marketplace Pulse
          </h3>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Zap className="w-3 h-3" /> Median first-app:
              <span className="text-foreground font-semibold">{formatDelay(medianTimeToFirstAppMin)}</span>
            </span>
            {jobsAwaitingApps > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {jobsAwaitingApps} job{jobsAwaitingApps === 1 ? "" : "s"} no apps yet
              </Badge>
            )}
          </div>
        </div>

        {parishStats.length === 0 ? (
          <p className="text-xs text-muted-foreground">No open jobs and no helpers with parish prefs yet.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground px-2">
              <div className="col-span-4">Parish</div>
              <div className="col-span-3 text-right">Open jobs</div>
              <div className="col-span-3 text-right">Helprs</div>
              <div className="col-span-2 text-right">Helpr/job</div>
            </div>
            {parishStats.map((p) => {
              // Highlight imbalance: open jobs with no helper coverage,
              // or > 0 jobs with < 1 helper per job.
              const noCoverage = p.openJobs > 0 && p.activeHelpers === 0;
              const undersupplied = p.openJobs > 0 && p.ratio !== null && p.ratio < 1;
              const ratioCls = noCoverage ? "text-destructive font-semibold"
                : undersupplied ? "text-amber-600 font-semibold"
                : "text-foreground";
              return (
                <div key={p.parish} className="grid grid-cols-12 gap-2 items-center rounded-lg liquid-glass p-2 text-sm">
                  <div className="col-span-4 truncate text-foreground">{p.parish}</div>
                  <div className="col-span-3 text-right tabular-nums">{p.openJobs}</div>
                  <div className="col-span-3 text-right tabular-nums">{p.activeHelpers}</div>
                  <div className={`col-span-2 text-right tabular-nums ${ratioCls}`}>
                    {p.ratio === null ? "—" : p.ratio.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Push notifications */}
      <div className="rounded-xl liquid-glass p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" /> Push notifications
          </h3>
        </div>

        {/* Token stats */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg bg-background/50 border border-border/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total tokens</div>
            <div className="text-2xl font-semibold tabular-nums">{pushStats.total}</div>
          </div>
          <div className="rounded-lg bg-background/50 border border-border/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">iOS</div>
            <div className="text-2xl font-semibold tabular-nums">{pushStats.ios}</div>
          </div>
          <div className="rounded-lg bg-background/50 border border-border/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Android</div>
            <div className="text-2xl font-semibold tabular-nums">{pushStats.android}</div>
          </div>
        </div>
        {pushStats.latestAt && (
          <p className="text-xs text-muted-foreground">
            Last token registered{" "}
            <span className="text-foreground font-medium">
              {new Date(pushStats.latestAt).toLocaleString()}
            </span>
          </p>
        )}
        {pushStats.total === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No devices registered yet. Have a user open the iOS/Android app, sign in,
            and tap Allow on the push permission prompt — token will register on next launch.
          </p>
        )}

        <div className="border-t border-border/40 pt-3">
          <p className="text-xs text-muted-foreground mb-2">
            Send a real push to every device registered against your admin user. Verifies
            APNs / FCM credentials + entitlements + device-token registration end-to-end.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={sendTestPush}
            disabled={sendingTestPush}
          >
            {sendingTestPush ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Sending…</>
            ) : (
              <><Send className="w-3.5 h-3.5 mr-1.5" /> Send test push to me</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdminHealth;
