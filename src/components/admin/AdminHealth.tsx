import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Mail, ShieldAlert, Database, Bug, MapPin, Zap, Bell, Send, Loader2, TrendingUp, ChevronUp, ChevronDown } from "lucide-react";
import { report } from "@/lib/errorLogger";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FILL_DAYS_OPTIONS } from "./adminHealth/types";
import { formatDelay } from "./adminHealth/adminHealthHelpers";
import { useHealthData } from "./adminHealth/useHealthData";
import { toneBadgeClasses, toneTextClasses } from "@/components/admin/tones";
import { useFillRate } from "./adminHealth/useFillRate";
import { EmptyState } from "@/components/ui/EmptyState";

const AdminHealth = () => {
  const qc = useQueryClient();
  const [sendingTestPush, setSendingTestPush] = useState(false);

  const { fillDays, setFillDays, fillSort, fillSortAsc, fillData, fillFetching, sortedParishes, handleFillSort } = useFillRate();

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

  const { queryKey, data, isFetching } = useHealthData();

  const { emailStats, pushStats, fraudCount, adminPushTokenCount, recentJobs, healthStatus, parishStats, medianTimeToFirstAppMin, jobsAwaitingApps } = data;

  const statusBadge = {
    ok: <Badge className={toneBadgeClasses.success}>Healthy</Badge>,
    degraded: <Badge className={toneBadgeClasses.danger}>Degraded</Badge>,
    unknown: <Badge className={toneBadgeClasses.neutral}>Checking…</Badge>,
  };

  return (
    <div className="space-y-6">
      {/* Death-blow banner — every admin alert this codebase fans
          (auto-restrict, fraud, disputes, stuck-payments) routes via
          push_tokens. With zero admin tokens registered, it all goes
          to in-app only and gets missed in real time. Surfacing as a
          loud red banner so it can't be ignored during launch. */}
      {adminPushTokenCount === 0 && (
        <div className="rounded-ds-md border-2 border-destructive/40 bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <Activity className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-ds-13 font-bold text-foreground">
                ⚠️ No admin has registered a push token
              </p>
              <p className="text-ds-11 text-muted-foreground leading-relaxed">
                Every admin notification (fraud flags, auto-restrict reverses,
                dispute escalations, stuck-payment alerts) fans through{" "}
                <code className="text-ds-10 bg-muted px-1 rounded">push_tokens</code>.
                With zero admin tokens, those alerts only show up if you happen
                to refresh this dashboard. Install the latest iOS build, sign in,
                and confirm a token lands here.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey })} disabled={isFetching}>
          <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Status overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-ds-md liquid-glass p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-ds-13 font-medium text-muted-foreground flex items-center gap-1.5">
              <Database className="w-4 h-4" /> Backend Functions
            </span>
            {statusBadge[healthStatus]}
          </div>
        </div>

        <div className="rounded-ds-md liquid-glass p-5 space-y-2">
          <span className="text-ds-13 font-medium text-muted-foreground flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Emails (24h)
          </span>
          <div className="flex gap-3 text-ds-13">
            <span className={cn("font-semibold", toneTextClasses.success)}>{emailStats.sent} sent</span>
            <span className={cn("font-semibold", toneTextClasses.danger)}>{emailStats.failed} failed</span>
            <span className={cn("font-semibold", toneTextClasses.notice)}>{emailStats.suppressed} suppressed</span>
          </div>
        </div>

        <div className="rounded-ds-md liquid-glass p-5 space-y-2">
          <span className="text-ds-13 font-medium text-muted-foreground flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4" /> Fraud Flags
          </span>
          <p className={`text-ds-17 font-bold ${fraudCount > 0 ? "text-destructive" : "text-foreground"}`}>
            {fraudCount} unresolved
          </p>
        </div>
      </div>

      {/* Sentry test — admin-only sanity check */}
      <div className="rounded-ds-md liquid-glass p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-foreground text-ds-13 flex items-center gap-1.5">
              <Bug className="w-4 h-4" /> Sentry Smoke Test
            </h3>
            <p className="text-ds-11 text-muted-foreground mt-1 max-w-md">
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
              Send Test Event
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
              Throw Uncaught
            </Button>
          </div>
        </div>
      </div>

      {/* Job activity (7 days) */}
      <div className="rounded-ds-md liquid-glass p-5 space-y-3">
        <h3 className="font-semibold text-foreground text-ds-13">Job Activity (Last 7 Days)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-ds-24 font-bold text-foreground">{recentJobs.open}</p>
            <p className="text-ds-11 text-muted-foreground">New Jobs</p>
          </div>
          <div className="text-center">
            <p className={cn("text-ds-24 font-bold", toneTextClasses.success)}>{recentJobs.completed}</p>
            <p className="text-ds-11 text-muted-foreground">Completed</p>
          </div>
          <div className="text-center">
            <p className={cn("text-ds-24 font-bold", toneTextClasses.danger)}>{recentJobs.disputed}</p>
            <p className="text-ds-11 text-muted-foreground">Disputed</p>
          </div>
          <div className="text-center">
            <p className={cn("text-ds-24 font-bold", toneTextClasses.notice)}>{recentJobs.cancelled}</p>
            <p className="text-ds-11 text-muted-foreground">Cancelled</p>
          </div>
        </div>
      </div>

      {/* Marketplace pulse: parish-level supply/demand + responsiveness */}
      <div className="rounded-ds-md liquid-glass p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-foreground text-ds-13 flex items-center gap-1.5">
            <MapPin className="w-4 h-4" /> Marketplace Pulse
          </h3>
          <div className="flex gap-3 text-ds-11">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Zap className="w-3 h-3" /> Median first-app:
              <span className="text-foreground font-semibold">{formatDelay(medianTimeToFirstAppMin)}</span>
            </span>
            {jobsAwaitingApps > 0 && (
              <Badge variant="outline" className="text-ds-10">
                {jobsAwaitingApps} job{jobsAwaitingApps === 1 ? "" : "s"} no apps yet
              </Badge>
            )}
          </div>
        </div>

        {parishStats.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={MapPin}
            title="No parish activity yet"
            body="Nothing to compare until there are open jobs or helpers with a parish set."
          />
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-12 gap-2 text-ds-10 uppercase tracking-wider text-muted-foreground px-2">
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
                : undersupplied ? cn("font-semibold", toneTextClasses.warning)
                : "text-foreground";
              return (
                <div key={p.parish} className="grid grid-cols-12 gap-2 items-center rounded-ds-sm liquid-glass p-2 text-ds-13">
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

      {/* Fill-rate metrics — hidden when RPC not yet deployed (PGRST202) */}
      {fillData?.available && (
        <div className="rounded-ds-md liquid-glass p-5 space-y-4">
          {/* Header + period toggle */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-foreground text-ds-13 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" /> Marketplace Health
            </h3>
            <div className="flex items-center gap-1 rounded-ds-sm bg-background/50 border border-border/40 p-0.5">
              {FILL_DAYS_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setFillDays(d)}
                  className={cn(
                    "px-2.5 py-1 text-ds-11 font-medium rounded-[4px] transition-colors",
                    fillDays === d
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d}d
                </button>
              ))}
              {fillFetching && <span className="ml-1 text-ds-10 text-muted-foreground motion-safe:animate-pulse">…</span>}
            </div>
          </div>

          {/* 3 stat cards */}
          <div className="grid grid-cols-3 gap-2 text-ds-13">
            <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3 space-y-0.5">
              <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">Fill Rate</div>
              <div className="text-ds-24 font-semibold tabular-nums">
                {fillData.fill_rate_pct !== null ? `${fillData.fill_rate_pct}%` : "—"}
              </div>
              <div className="text-ds-10 text-muted-foreground">jobs with ≥1 app</div>
            </div>
            <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3 space-y-0.5">
              <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">Median Response</div>
              <div className="text-ds-24 font-semibold tabular-nums">
                {formatDelay(fillData.median_minutes_to_first_app)}
              </div>
              <div className="text-ds-10 text-muted-foreground">time to first app</div>
            </div>
            <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3 space-y-0.5">
              <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">Jobs Tracked</div>
              <div className="text-ds-24 font-semibold tabular-nums">{fillData.total_jobs}</div>
              <div className="text-ds-10 text-muted-foreground">{fillData.filled_jobs} filled</div>
            </div>
          </div>

          {/* Per-parish table */}
          {sortedParishes.length > 0 && (
            <div className="space-y-1.5">
              {/* Sortable header */}
              <div className="grid grid-cols-12 gap-2 px-2">
                <div className="col-span-5 text-ds-10 uppercase tracking-wider text-muted-foreground">Parish</div>
                <button
                  type="button"
                  onClick={() => handleFillSort("total_jobs")}
                  className="col-span-3 text-right text-ds-10 uppercase tracking-wider text-muted-foreground flex items-center justify-end gap-0.5 hover:text-foreground transition-colors"
                >
                  Jobs
                  {fillSort === "total_jobs"
                    ? (fillSortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                    : null}
                </button>
                <button
                  type="button"
                  onClick={() => handleFillSort("fill_rate_pct")}
                  className="col-span-4 text-right text-ds-10 uppercase tracking-wider text-muted-foreground flex items-center justify-end gap-0.5 hover:text-foreground transition-colors"
                >
                  Fill %
                  {fillSort === "fill_rate_pct"
                    ? (fillSortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                    : null}
                </button>
              </div>

              {sortedParishes.map((p) => {
                const pct = p.fill_rate_pct;
                const pctCls = pct === null ? "text-muted-foreground"
                  : pct >= 70 ? cn("font-semibold", toneTextClasses.success)
                  : pct >= 40 ? cn("font-semibold", toneTextClasses.warning)
                  : "text-destructive font-semibold";
                return (
                  <div key={p.parish} className="grid grid-cols-12 gap-2 items-center rounded-ds-sm liquid-glass p-2 text-ds-13">
                    <div className="col-span-5 truncate text-foreground">{p.parish}</div>
                    <div className="col-span-3 text-right tabular-nums">{p.total_jobs}</div>
                    <div className={cn("col-span-4 text-right tabular-nums", pctCls)}>
                      {pct !== null ? `${pct}%` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {sortedParishes.length === 0 && fillData.total_jobs === 0 && (
            <p className="text-ds-11 text-muted-foreground">No job data for this period yet.</p>
          )}
        </div>
      )}

      {/* Push notifications */}
      <div className="rounded-ds-md liquid-glass p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-ds-13 font-semibold text-foreground flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" /> Push notifications
          </h3>
        </div>

        {/* Token stats */}
        <div className="grid grid-cols-3 gap-2 text-ds-13">
          <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3">
            <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">Total tokens</div>
            <div className="text-ds-24 font-semibold tabular-nums">{pushStats.total}</div>
          </div>
          <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3">
            <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">iOS</div>
            <div className="text-ds-24 font-semibold tabular-nums">{pushStats.ios}</div>
          </div>
          <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3">
            <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">Android</div>
            <div className="text-ds-24 font-semibold tabular-nums">{pushStats.android}</div>
          </div>
        </div>
        {pushStats.latestAt && (
          <p className="text-ds-11 text-muted-foreground">
            Last token registered{" "}
            <span className="text-foreground font-medium">
              {new Date(pushStats.latestAt).toLocaleString()}
            </span>
          </p>
        )}
        {pushStats.total === 0 && (
          <p className="text-ds-11 text-muted-foreground italic">
            No devices registered yet. Have a user open the iOS/Android app, sign in,
            and tap Allow on the push permission prompt — token will register on next launch.
          </p>
        )}

        <div className="border-t border-border/40 pt-3">
          <p className="text-ds-11 text-muted-foreground mb-2">
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
              <><Send className="w-3.5 h-3.5 mr-1.5" /> Send Test Push to Me</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdminHealth;
