import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Mail, ShieldAlert, Database, Bug } from "lucide-react";
import { report } from "@/lib/errorLogger";
import { toast } from "@/hooks/use-toast";
import { useInstantQuery } from "@/hooks/useInstantQuery";

type HealthData = {
  emailStats: { total: number; sent: number; failed: number; suppressed: number };
  fraudCount: number;
  recentJobs: { open: number; completed: number; disputed: number; cancelled: number };
  healthStatus: "ok" | "degraded" | "unknown";
};

const AdminHealth = () => {
  const qc = useQueryClient();
  const queryKey = ["admin-health"];

  const { data, isFetching } = useInstantQuery<HealthData>({
    key: queryKey,
    fallback: {
      emailStats: { total: 0, sent: 0, failed: 0, suppressed: 0 },
      fraudCount: 0,
      recentJobs: { open: 0, completed: 0, disputed: 0, cancelled: 0 },
      healthStatus: "unknown",
    },
    fetcher: async () => {
      // Email stats (last 24h)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [sentRes, failedRes, suppressedRes] = await Promise.all([
        (supabase.from as any)("email_send_log").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", since),
        (supabase.from as any)("email_send_log").select("id", { count: "exact", head: true }).eq("status", "dlq").gte("created_at", since),
        (supabase.from as any)("email_send_log").select("id", { count: "exact", head: true }).eq("status", "suppressed").gte("created_at", since),
      ]);
      const sent = sentRes.count || 0;
      const failed = failedRes.count || 0;
      const suppressed = suppressedRes.count || 0;
      const emailStats = { total: sent + failed + suppressed, sent, failed, suppressed };

      const { count: fc } = await (supabase.from as any)("fraud_flags").select("id", { count: "exact", head: true }).eq("resolved", false);
      const fraudCount = fc || 0;

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

      return { emailStats, fraudCount, recentJobs, healthStatus };
    },
  });

  const { emailStats, fraudCount, recentJobs, healthStatus } = data;

  const statusBadge = {
    ok: <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Healthy</Badge>,
    degraded: <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Degraded</Badge>,
    unknown: <Badge className="bg-muted text-muted-foreground">Checking…</Badge>,
  };

  return (
    <div className="space-y-6">
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
        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Database className="w-4 h-4" /> Backend Functions
            </span>
            {statusBadge[healthStatus]}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Emails (24h)
          </span>
          <div className="flex gap-3 text-sm">
            <span className="text-green-600 font-semibold">{emailStats.sent} sent</span>
            <span className="text-red-600 font-semibold">{emailStats.failed} failed</span>
            <span className="text-yellow-600 font-semibold">{emailStats.suppressed} suppressed</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4" /> Fraud Flags
          </span>
          <p className={`text-lg font-bold ${fraudCount > 0 ? "text-destructive" : "text-foreground"}`}>
            {fraudCount} unresolved
          </p>
        </div>
      </div>

      {/* Sentry test — admin-only sanity check */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
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
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
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
    </div>
  );
};

export default AdminHealth;
