import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Mail, ShieldAlert, Database, Download } from "lucide-react";

const AdminHealth = () => {
  const [loading, setLoading] = useState(true);
  const [emailStats, setEmailStats] = useState({ total: 0, sent: 0, failed: 0, suppressed: 0 });
  const [fraudCount, setFraudCount] = useState(0);
  const [recentJobs, setRecentJobs] = useState({ open: 0, completed: 0, disputed: 0, cancelled: 0 });
  const [healthStatus, setHealthStatus] = useState<"ok" | "degraded" | "unknown">("unknown");

  const loadHealth = async () => {
    setLoading(true);

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
    setEmailStats({ total: sent + failed + suppressed, sent, failed, suppressed });

    // Unresolved fraud flags
    const { count: fc } = await (supabase.from as any)("fraud_flags").select("id", { count: "exact", head: true }).eq("resolved", false);
    setFraudCount(fc || 0);

    // Recent job stats (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [openRes, compRes, dispRes, cancelRes] = await Promise.all([
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "open").gte("created_at", weekAgo),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed").gte("updated_at", weekAgo),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "disputed" as any).gte("updated_at", weekAgo),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "cancelled").gte("updated_at", weekAgo),
    ]);
    setRecentJobs({
      open: openRes.count || 0,
      completed: compRes.count || 0,
      disputed: dispRes.count || 0,
      cancelled: cancelRes.count || 0,
    });

    // Health check
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/health-check`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      });
      setHealthStatus(resp.ok ? "ok" : "degraded");
    } catch {
      setHealthStatus("degraded");
    }

    setLoading(false);
  };

  useEffect(() => { loadHealth(); }, []);

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
        <Button variant="outline" size="sm" onClick={loadHealth} disabled={loading}>
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
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
