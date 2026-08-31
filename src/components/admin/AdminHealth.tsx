import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Mail, ShieldAlert, Database, Bug, MapPin, Zap, Bell, Send, Loader2, TrendingUp, ChevronUp, ChevronDown } from "lucide-react";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FILL_DAYS_OPTIONS } from "./adminHealth/types";
import { formatDelay } from "./adminHealth/adminHealthHelpers";
import { useHealthData } from "./adminHealth/useHealthData";
import { toneBadgeClasses, toneTextClasses } from "@/components/admin/tones";
import { useFillRate } from "./adminHealth/useFillRate";
import { useConfigChecks, type CheckTone } from "./adminHealth/useConfigChecks";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";

const AdminHealth = () => {
  const qc = useQueryClient();
  const [sendingTestPush, setSendingTestPush] = useState(false);

  const { fillDays, setFillDays, fillSort, fillSortAsc, fillData, fillFetching, sortedParishes, handleFillSort } = useFillRate();
  const { data: configChecks } = useConfigChecks();

  // Send a test push to the admin's own user_id. Verifies the entire
  // pipeline (push_tokens lookup → APNs/FCM auth → device delivery)
  // without needing to wait on a real notification trigger to fire.
  const sendTestPush = async () => {
    setSendingTestPush(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not signed in");
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
        toast("Push backend not configured", { description: result.skipped });
      } else if (result.no_tokens) {
        toast("No registered devices", { description: "Open the app on your phone and grant push permission first." });
      } else if ((result.sent ?? 0) > 0) {
        toast.success(`Pushed to ${result.sent}/${result.total} device${result.total === 1 ? "" : "s"}`, { description: "Check your phone." });
      } else {
        toast.error("All sends failed", { description: `0 of ${result.total} succeeded` });
      }
    } catch (err) {
      report(err, { tags: { source: "AdminHealth.sendTestPush" } });
      toast.error("Test push failed", { description: err instanceof Error ? err.message : String(err) });
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
    <AdminViewShell>
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

      {/* Configuration checks. Everything here is a defect the 2026-08-25 audit
          found by hand, and they share the trait that makes them dangerous:
          the app looks healthy while they are true. A test Stripe key still
          renders checkout; a job with no recorded fee still shows a price.
          Running them continuously is the difference between finding this in
          an audit and finding it on the screen you already open. */}
      <AdminCard
        title="Configuration Checks"
        subtitle="Problems that do not surface anywhere else in the app."
      >
        {!configChecks || configChecks.length === 0 ? (
          <p className="text-ds-11 text-muted-foreground">Running checks…</p>
        ) : (
          <ul className="space-y-2">
            {configChecks.map((c) => {
              const dot: Record<CheckTone, string> = {
                ok: "bg-[hsl(var(--bark))]",
                warn: "bg-[hsl(var(--burnt-sienna))]",
                danger: "bg-destructive",
                unknown: "bg-muted-foreground",
              };
              return (
                <li key={c.id} className="flex items-start gap-3 rounded-ds-sm border border-border bg-card p-3">
                  <span
                    className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot[c.tone])}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-ds-13 font-semibold text-foreground">
                      {c.label}
                      {/* The dot is decorative; the state has to reach a screen
                          reader as words, not as a colour. */}
                      <span className="sr-only">
                        {c.tone === "ok" ? " — passing" : c.tone === "unknown" ? " — could not check" : " — needs attention"}
                      </span>
                    </p>
                    <p className="text-ds-11 text-muted-foreground leading-tight">{c.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>

      {/* Status overview. Refresh used to float right-aligned on a bare row
          above these three tiles with a phone-width band of nothing beside
          it; it re-reads exactly this card's data, so it is its header
          action. */}
      <AdminCard
        title="Platform Status"
        action={
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey })} disabled={isFetching}>
            <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
        contentClassName="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
      >
        <div className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ds-13 font-medium text-muted-foreground flex items-center gap-1.5">
              <Database className="w-4 h-4" /> Backend Functions
            </span>
            {statusBadge[healthStatus]}
          </div>
        </div>

        <div className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-2">
          <span className="text-ds-13 font-medium text-muted-foreground flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Emails (24h)
          </span>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-ds-13">
            {/* An alarm colour has to mean an alarm. These three were painted
                unconditionally, so a perfectly healthy hour rendered "0 failed"
                in red and "0 suppressed" in yellow — two warnings on a
                dashboard whose entire job is to tell an operator at a glance
                whether anything is wrong. Zero of a bad thing is good news and
                now reads as ordinary muted text; the colour only appears when
                there is genuinely something to look at. */}
            <span className={cn("font-semibold", emailStats.sent > 0 ? toneTextClasses.success : "text-muted-foreground")}>{emailStats.sent} sent</span>
            <span className={cn("font-semibold", emailStats.failed > 0 ? toneTextClasses.danger : "text-muted-foreground")}>{emailStats.failed} failed</span>
            <span className={cn("font-semibold", emailStats.suppressed > 0 ? toneTextClasses.notice : "text-muted-foreground")}>{emailStats.suppressed} suppressed</span>
          </div>
        </div>

        <div className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-2">
          <span className="text-ds-13 font-medium text-muted-foreground flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4" /> Fraud Flags
          </span>
          <p className={`text-ds-17 font-bold ${fraudCount > 0 ? "text-destructive" : "text-foreground"}`}>
            {fraudCount} unresolved
          </p>
        </div>
      </AdminCard>

      {/* Sentry test — admin-only sanity check */}
      <AdminCard
        title={<span className="flex items-center gap-1.5"><Bug className="w-4 h-4 text-primary" /> Sentry Smoke Test</span>}
        subtitle="Fires a test exception; it should appear in Sentry within ~30 seconds."
      >
        <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                report(new Error(`Sentry smoke test (manual) — ${new Date().toISOString()}`), {
                  severity: "info",
                  tags: { source: "admin_smoke_test", kind: "manual" },
                });
                toast.success("Test event sent", { description: "Check Sentry in ~30 seconds." });
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
                toast("Throwing uncaught error", { description: "Check Sentry in ~30 seconds." });
              }}
            >
              Throw Uncaught
            </Button>
        </div>
      </AdminCard>

      {/* Job activity (7 days) */}
      <AdminCard
        title="Job Activity"
        subtitle="Last 7 days."
        contentClassName="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
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
      </AdminCard>

      {/* Marketplace pulse: parish-level supply/demand + responsiveness */}
      <AdminCard
        title={<span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary" /> Marketplace Pulse</span>}
        action={
          <div className="flex flex-wrap items-center gap-2 text-ds-11">
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
        }
      >
        {parishStats.length === 0 ? (
          <EmptyState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            icon={MapPin}
            title="No parish activity yet"
            body="Nothing to compare until there are open jobs or Helprs with a parish set."
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
                <div key={p.parish} className="grid grid-cols-12 gap-2 items-center rounded-ds-sm border border-border/60 bg-background/40 p-2 text-ds-13">
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
      </AdminCard>

      {/* Fill-rate metrics — hidden when RPC not yet deployed (PGRST202) */}
      {fillData?.available && (
        <AdminCard
          title={<span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Marketplace Health</span>}
          action={
            <div className="flex items-center gap-1 rounded-ds-sm bg-background/50 border border-border/40 p-0.5">
              {FILL_DAYS_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setFillDays(d)}
                  aria-pressed={fillDays === d}
                  className={cn(
                    "px-2.5 py-1 text-ds-11 font-medium rounded-sm transition-colors",
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
          }
          contentClassName="space-y-4"
        >
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
                  <div key={p.parish} className="grid grid-cols-12 gap-2 items-center rounded-ds-sm border border-border/60 bg-background/40 p-2 text-ds-13">
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
        </AdminCard>
      )}

      {/* Push notifications */}
      <AdminCard
        title={<span className="flex items-center gap-2"><Bell className="w-4 h-4 text-primary" /> Push Notifications</span>}
        contentClassName="space-y-4"
      >
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
      </AdminCard>
    </AdminViewShell>
  );
};

export default AdminHealth;
