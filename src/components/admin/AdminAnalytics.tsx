import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, BarChart3, Briefcase, CheckCircle, Clock, CreditCard, Crown, DollarSign, Loader2, PieChart, Sparkles, Star, TrendingUp, Users, XCircle } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { MetricCard, StatusRow, MRRRow, CohortRetentionCard, FunnelCard } from "./AdminAnalyticsCards";
import { UsersDrillDown, SubscriptionsDrillDown, CategoriesDrillDown, PayoutsDrillDown, JobsDrillDown } from "./AdminAnalyticsDrilldowns";
import { PIE_COLORS } from "./adminAnalyticsConstants";
import { SUB_PRICE, type Profile, type Job, type Tip, type DrillDown } from "./adminAnalytics/types";
import { computeMetrics } from "./adminAnalytics/adminAnalyticsHelpers";
import { toneTextClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";
import { formatPrice, formatPriceExact } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";

// Lazy-load charts so recharts (~250 KB pre-gzip) lands in its own chunk
// instead of inflating the AdminAnalytics initial bundle. Funnel cards +
// metric tiles paint immediately while charts hydrate in the background.
const SubscriberPieChart = lazy(() =>
  import("./AdminAnalyticsCharts").then((m) => ({ default: m.SubscriberPieChart }))
);
const RevenueLineChart = lazy(() =>
  import("./AdminAnalyticsCharts").then((m) => ({ default: m.RevenueLineChart }))
);
const MonthlyJobsBarChart = lazy(() =>
  import("./AdminAnalyticsCharts").then((m) => ({ default: m.MonthlyJobsBarChart }))
);

const ChartFallback = () => (
  <div className="flex h-full w-full items-center justify-center">
    <HelprSpinner size={20} />
  </div>
);

const AdminAnalytics = () => {
  const [loading, setLoading] = useState(true);
  const [drillDown, setDrillDown] = useState<DrillDown>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Raw data
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [transfers, setTransfers] = useState<{ amount_cents: number | string; status: string }[]>([]);
  const [tips, setTips] = useState<Tip[]>([]);
  const [drillUsers, setDrillUsers] = useState<Profile[]>([]);
  const [drillJobs, setDrillJobs] = useState<Job[]>([]);
  // user_id → role lookup (profiles.role was dropped — fetched separately
  // from user_roles and joined client-side for the helper/customer counts).
  const [roleByUser, setRoleByUser] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const load = async () => {
      // Paginate jobs to avoid 1000-row limit
      let allJobsData: Job[] = [];
      let page = 0;
      const PAGE_SIZE = 999;
      while (true) {
        const { data, error } = await supabase.from("jobs").select("*").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) {
          report(error, { tags: { source: "AdminAnalytics.loadJobs" } });
          break;
        }
        if (!data || data.length === 0) break;
        allJobsData = [...allJobsData, ...data];
        if (data.length < PAGE_SIZE) break;
        page++;
      }

      const [profilesRes, tipsRes, rolesRes, transfersRes] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("tips").select("*"),
        supabase.from("user_roles").select("user_id, role"),
        // THE LEDGER. "Helpr Payouts" used to be recomputed from job budgets
        // with a fee fallback, which overstated it — see computeMetrics.
        // `as any`: payout_transfers landed in a recent migration that is not
        // in the generated types yet, same cast AdminPayoutBatches uses.
         
        (supabase as any).from("payout_transfers").select("amount_cents, status"),
      ]);
      if (profilesRes.error) report(profilesRes.error, { tags: { source: "AdminAnalytics.loadProfiles" } });
      if (tipsRes.error) report(tipsRes.error, { tags: { source: "AdminAnalytics.loadTips" } });
      if (rolesRes.error) report(rolesRes.error, { tags: { source: "AdminAnalytics.loadRoles" } });
      setProfiles(profilesRes.data || []);
      setAllJobs(allJobsData);
      setTips(tipsRes.data || []);
      setTransfers((transfersRes.data as { amount_cents: number | string; status: string }[] | null) || []);
      // Build user_id → most-privileged role map (admin > helper > customer).
      const roleMap = new Map<string, string>();
      const priority = (r: string) => r === "admin" ? 1 : r === "helper" ? 2 : 3;
      for (const r of rolesRes.data ?? []) {
        const existing = roleMap.get(r.user_id);
        if (!existing || priority(r.role) < priority(existing)) {
          roleMap.set(r.user_id, r.role);
        }
      }
      setRoleByUser(roleMap);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <HelprSpinner size={20} />
      </div>
    );
  }

  // ─── Computed metrics ───
  // All pure derivations (funnels, cohorts, revenue/fee math, category +
  // monthly trends, payout pipeline, subscription breakdown) live in
  // computeMetrics — extracted verbatim to keep this component focused on
  // data-loading, drill-down state, and rendering.
  const {
    helpers,
    customers,
    customerFunnel,
    helperFunnel,
    monthLabel,
    cohortRetention,
    completedJobs,
    capturedJobs,
    refundedJobs,
    openJobs,
    activeJobs,
    cancelledJobs,
    disputedJobs,
    lateCancelledPaidJobs,
    totalRevenue,
    totalFees,
    lateCancelRevenue,
    totalHelperPayouts,
    totalTips,
    avgJobValue,
    completionRate,
    cancellationRate,
    totalRefunded,
    subBasic,
    subPro,
    subElite,
    subFree,
    totalSubRevenue,
    categoryData,
    monthlyData,
    escrowJobs,
    pendingPayouts,
    releasedPayouts,
    escrowTotal,
    pendingPayoutTotal,
    subPieData,
    approvedUsers,
    pendingUsers,
    deniedUsers,
  } = computeMetrics(profiles, allJobs, tips, transfers);

  // ─── Drill-down handler ───
  const openDrillDown = async (type: DrillDown) => {
    setDrillDown(type);
    setDrillLoading(true);
    if (type === "users") {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (error) report(error, { tags: { source: "AdminAnalytics.drillDownUsers" } });
      setDrillUsers(data || []);
    } else if (type === "jobs" || type === "revenue" || type === "fees" || type === "payouts") {
      const query = supabase.from("jobs").select("*").order("created_at", { ascending: false });
      if (type === "revenue" || type === "fees") query.in("payment_status", ["escrow", "payout_pending", "released"]);
      if (type === "payouts") query.in("payment_status", ["escrow", "payout_pending", "released"]);
      const { data, error } = await query;
      if (error) report(error, { tags: { source: "AdminAnalytics.drillDownJobs" } });
      setDrillJobs(data || []);
    } else if (type === "subscriptions") {
      const { data, error } = await supabase.from("profiles").select("*").not("subscription_tier", "is", null).order("subscription_tier");
      if (error) report(error, { tags: { source: "AdminAnalytics.drillDownSubscriptions" } });
      setDrillUsers(data || []);
    }
    setDrillLoading(false);
  };

  // ─── Drill-down views ───
  if (drillDown) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setDrillDown(null)} className="text-ds-11 text-muted-foreground">
            ← Back to Analytics
          </Button>
          <h2 className="text-ds-20 font-display font-bold text-foreground">
            {drillDown === "users" ? "All Users" :
             drillDown === "subscriptions" ? "Subscriber Breakdown" :
             drillDown === "jobs" ? "All Jobs" :
             drillDown === "revenue" ? "Revenue Breakdown" :
             drillDown === "fees" ? "Platform Fee Breakdown" :
             drillDown === "payouts" ? "Payout Tracking" :
             drillDown === "categories" ? "Category Breakdown" : ""}
          </h2>
        </div>

        {drillLoading ? (
          <div className="flex items-center gap-2 text-ds-11 text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : drillDown === "users" ? (
          <UsersDrillDown users={drillUsers} roleByUser={roleByUser} />
        ) : drillDown === "subscriptions" ? (
          <SubscriptionsDrillDown users={drillUsers} />
        ) : drillDown === "categories" ? (
          <CategoriesDrillDown data={categoryData} />
        ) : drillDown === "payouts" ? (
          <PayoutsDrillDown jobs={drillJobs} />
        ) : (
          <JobsDrillDown jobs={drillJobs} showFinancials={drillDown === "revenue" || drillDown === "fees"} showFees={drillDown === "fees"} />
        )}
      </div>
    );
  }

  // ─── Main dashboard ───
  return (
    <div className="space-y-6">
      

      {/* ── Row 1: Key Financial Metrics ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* NOT "Revenue" — this is budget + poster fee across captured jobs,
            i.e. the gross value flowing THROUGH the platform, most of which is
            owed to helpers. Calling it revenue put it beside "$0.00 Platform
            Profit" and read as nonsense to an operator. It also had a second
            name: Dashboard Home called the identical figure "Captured Revenue
            (all-time)". One fact, one name. */}
        <MetricCard
          label="Payments Collected"
          value={`$${totalRevenue.toFixed(2)}`}
          sub={`${capturedJobs.length} captured payments · gross, before payouts`}
          icon={DollarSign}
          onClick={() => openDrillDown("revenue")}
        />
        <MetricCard
          label="Platform Profit"
          value={`$${totalFees.toFixed(2)}`}
          sub={`${totalRevenue > 0 ? ((totalFees / totalRevenue) * 100).toFixed(1) : 0}% of collected revenue`}
          icon={TrendingUp}
          accent
          onClick={() => openDrillDown("fees")}
        />
        <MetricCard
          label="Helpr Payouts"
          value={`$${totalHelperPayouts.toFixed(2)}`}
          sub={`Avg $${completedJobs.length > 0 ? (totalHelperPayouts / completedJobs.length).toFixed(2) : "0"}/completed job`}
          icon={CreditCard}
          onClick={() => openDrillDown("payouts")}
        />
        <MetricCard
          label="Refunded"
          value={`$${totalRefunded.toFixed(2)}`}
          sub={`${refundedJobs.length} refunded ${refundedJobs.length === 1 ? "job" : "jobs"}`}
          icon={XCircle}
        />
      </div>

      {/* Tips */}
      {totalTips > 0 && (
        <div className="rounded-ds-md liquid-glass p-4 flex items-center gap-3">
          <Star className="w-4 h-4 text-accent" />
          <div>
            <p className="text-ds-13 font-semibold text-foreground">Tips Collected: ${totalTips.toFixed(2)}</p>
            <p className="text-ds-11 text-muted-foreground">{tips.filter(t => t.payment_status === "paid" || t.payment_status === "completed").length} paid tips</p>
          </div>
        </div>
      )}

      {lateCancelRevenue > 0 && (
        <div className="rounded-ds-md liquid-glass p-5">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-destructive" />
            <h3 className="text-ds-13 font-semibold text-foreground">Late Cancellation Revenue</h3>
          </div>
          <p className="text-ds-24 font-bold text-foreground">${lateCancelRevenue.toFixed(2)}</p>
          <p className="text-ds-11 text-muted-foreground mt-1">
            Platform fees retained from {lateCancelledPaidJobs.length} late-cancelled {lateCancelledPaidJobs.length === 1 ? "job" : "jobs"} with captured payments
          </p>
          <div className="mt-3 space-y-1.5">
            {lateCancelledPaidJobs.map(j => (
              <div key={j.id} className="flex items-center justify-between text-ds-11 bg-muted/30 rounded-ds-sm px-3 py-2">
                <span className="text-foreground font-medium truncate mr-2">{j.title}</span>
                <span className="text-muted-foreground shrink-0">${((j.customer_fee_amount || 0) + (j.platform_fee_amount || 0)).toFixed(2)} retained</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Row 2: Subscription Revenue ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <button onClick={() => openDrillDown("subscriptions")} className="rounded-ds-md liquid-glass p-5 text-left hover:border-primary/30 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-ds-13 font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Subscription Revenue
            </h3>
            <span className="text-ds-11 text-primary opacity-0 group-hover:opacity-100 transition-opacity">Details →</span>
          </div>
          <p className="text-ds-24 font-bold text-foreground">${totalSubRevenue.toFixed(2)}<span className="text-ds-13 font-normal text-muted-foreground">/mo</span></p>
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              { label: "Elite", count: subElite, color: "bg-accent/20 text-accent" },
              { label: "Pro", count: subPro, color: "bg-primary/10 text-primary" },
              { label: "Basic", count: subBasic, color: "Bg-secondary Text-secondary-foreground" },
              { label: "Free", count: subFree, color: "Bg-muted Text-muted-foreground" },
            ].map(t => (
              <div key={t.label} className="text-center">
                <p className="text-ds-17 font-bold text-foreground">{t.count}</p>
                <Badge className={`text-ds-10 ${t.color}`}>{t.label}</Badge>
              </div>
            ))}
          </div>
          {helpers.length > 0 && (
            <p className="text-ds-11 text-muted-foreground mt-3">
              {((helpers.length - subFree) / helpers.length * 100).toFixed(0)}% of helpers subscribed
            </p>
          )}
        </button>

        {/* Subscription pie chart */}
        <div className="rounded-ds-md liquid-glass p-5">
          <h3 className="text-ds-13 font-semibold text-foreground mb-3 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-primary" /> Subscriber Distribution
          </h3>
          {subPieData.length > 0 ? (
            <div className="h-[180px]">
              <Suspense fallback={<ChartFallback />}>
                <SubscriberPieChart data={subPieData} />
              </Suspense>
            </div>
          ) : (
            <EmptyState
            variant="inline"
            icon={Crown}
            title="No subscribers yet"
            body="Paid plans will appear here once someone upgrades."
          />
          )}
        </div>
      </div>

      {/* ── Row 3: Revenue Trend Chart ── */}
      <div className="rounded-ds-md liquid-glass p-5">
        <h3 className="text-ds-13 font-semibold text-foreground mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" /> Revenue &amp; Growth — Last 6 Months
        </h3>
        <div className="h-[250px]">
          <Suspense fallback={<ChartFallback />}>
            <RevenueLineChart data={monthlyData} />
          </Suspense>
        </div>
      </div>

      {/* ── Row 4: Jobs & Users Overview ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Users"
          value={profiles.length}
          sub={`${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} · ${customers.length} ${customers.length === 1 ? "customer" : "customers"}`}
          icon={Users}
          onClick={() => openDrillDown("users")}
        />
        <MetricCard
          label="Total Jobs"
          value={allJobs.length}
          sub={`${openJobs.length} open · ${activeJobs.length} active · ${completedJobs.length} done`}
          icon={Briefcase}
          onClick={() => openDrillDown("jobs")}
        />
        <MetricCard
          label="Avg Job Value"
          value={`$${avgJobValue.toFixed(2)}`}
          sub={`Completion: ${completionRate.toFixed(1)}%`}
          icon={Activity}
        />
        <MetricCard
          label="Disputes"
          value={disputedJobs.length}
          sub={`Cancellation: ${cancellationRate.toFixed(1)}%`}
          icon={AlertTriangle}
          warning={disputedJobs.length > 0}
        />
      </div>

      {/* ── Row 5: Payout Pipeline & Category Breakdown ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Payout pipeline */}
        <button onClick={() => openDrillDown("payouts")} className="rounded-ds-md liquid-glass p-5 text-left hover:border-primary/30 transition-all group">
          <h3 className="text-ds-13 font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Payout Pipeline
            <span className="text-ds-11 text-primary opacity-0 group-hover:opacity-100 transition-opacity ml-auto">Details →</span>
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full bg-current", toneTextClasses.warning)} />
                <span className="text-ds-11 text-muted-foreground">In Escrow</span>
              </div>
              <div className="text-right">
                <span className="text-ds-13 font-semibold text-foreground">${formatPriceExact(escrowTotal)}</span>
                <span className="text-ds-11 text-muted-foreground ml-2">({escrowJobs.length} job{escrowJobs.length === 1 ? "" : "s"})</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full bg-current", toneTextClasses.info)} />
                <span className="text-ds-11 text-muted-foreground">Payout Pending</span>
              </div>
              <div className="text-right">
                <span className="text-ds-13 font-semibold text-foreground">${formatPriceExact(pendingPayoutTotal)}</span>
                <span className="text-ds-11 text-muted-foreground ml-2">({pendingPayouts.length} job{pendingPayouts.length === 1 ? "" : "s"})</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full bg-current", toneTextClasses.success)} />
                <span className="text-ds-11 text-muted-foreground">Released</span>
              </div>
              <div className="text-right">
                <span className="text-ds-13 font-semibold text-foreground">{releasedPayouts.length} job{releasedPayouts.length === 1 ? "" : "s"}</span>
              </div>
            </div>
          </div>
        </button>

        {/* Category breakdown */}
        <button onClick={() => openDrillDown("categories")} className="rounded-ds-md liquid-glass p-5 text-left hover:border-primary/30 transition-all group">
          <h3 className="text-ds-13 font-semibold text-foreground mb-3 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-primary" /> Top Categories
            <span className="text-ds-11 text-primary opacity-0 group-hover:opacity-100 transition-opacity ml-auto">Details →</span>
          </h3>
          <div className="space-y-2">
            {categoryData.slice(0, 5).map((cat, i) => (
              <div key={cat.name} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="text-ds-13 text-foreground capitalize flex-1">{cat.name}</span>
                <span className="text-ds-11 text-muted-foreground">{cat.count} job{cat.count === 1 ? "" : "s"}</span>
                <span className="text-ds-11 font-semibold text-foreground">${formatPrice(cat.revenue)}</span>
              </div>
            ))}
          </div>
        </button>
      </div>

      {/* ── Row 6: User Status & Quick Stats ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-ds-md liquid-glass p-5">
          <h3 className="text-ds-13 font-semibold text-foreground mb-3">User Status</h3>
          <div className="space-y-2">
            <StatusRow icon={CheckCircle} label="Approved" count={approvedUsers} color="text-primary" />
            <StatusRow icon={Clock} label="Pending Approval" count={pendingUsers} color={toneTextClasses.warning} />
            <StatusRow icon={XCircle} label="Denied" count={deniedUsers} color="text-destructive" />
          </div>
        </div>

        <div className="rounded-ds-md liquid-glass p-5">
          <h3 className="text-ds-13 font-semibold text-foreground mb-3">Job Completion Funnel</h3>
          <div className="space-y-2">
            <StatusRow icon={Briefcase} label="Posted" count={allJobs.length} color="text-muted-foreground" />
            <StatusRow icon={Activity} label="In Progress" count={activeJobs.length} color="text-primary" />
            <StatusRow icon={CheckCircle} label="Completed" count={completedJobs.length} color={toneTextClasses.success} />
            <StatusRow icon={XCircle} label="Cancelled" count={cancelledJobs.length} color="text-destructive" />
            <StatusRow icon={AlertTriangle} label="Disputed" count={disputedJobs.length} color={toneTextClasses.warning} />
          </div>
        </div>

        <div className="rounded-ds-md liquid-glass p-5">
          <h3 className="text-ds-13 font-semibold text-foreground mb-3">Monthly Recurring Revenue</h3>
          <p className="text-3xl font-bold text-foreground">${totalSubRevenue.toFixed(2)}</p>
          <p className="text-ds-11 text-muted-foreground mt-1">Projected annual: ${(totalSubRevenue * 12).toFixed(2)}</p>
          <div className="mt-4 space-y-1.5">
            <MRRRow tier="Elite" count={subElite} amount={subElite * SUB_PRICE.elite} />
            <MRRRow tier="Pro" count={subPro} amount={subPro * SUB_PRICE.pro} />
            <MRRRow tier="Basic" count={subBasic} amount={subBasic * SUB_PRICE.basic} />
          </div>
        </div>
      </div>

      {/* ── Row 6.5: Activation Funnels ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <FunnelCard title="Customer activation" subtitle="Signup → revenue" stages={customerFunnel} />
        <FunnelCard title="Helpr supply" subtitle="Signup → first paid job" stages={helperFunnel} />
      </div>

      {/* ── Row 6.75: Cohort Retention ── */}
      <CohortRetentionCard cohorts={cohortRetention} monthLabel={monthLabel} />

      {/* ── Row 7: Monthly Jobs Bar Chart ── */}
      <div className="rounded-ds-md liquid-glass p-5">
        <h3 className="text-ds-13 font-semibold text-foreground mb-4 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-primary" /> Jobs per Month
        </h3>
        <div className="h-[200px]">
          <Suspense fallback={<ChartFallback />}>
            <MonthlyJobsBarChart data={monthlyData} />
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default AdminAnalytics;
