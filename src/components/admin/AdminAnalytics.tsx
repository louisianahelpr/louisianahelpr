import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, Briefcase, DollarSign, TrendingUp, Star, CreditCard, Activity, PieChart,
  BarChart3, Clock, CheckCircle, XCircle, AlertTriangle, Loader2, Sparkles,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { MetricCard, StatusRow, MRRRow, CohortRetentionCard, FunnelCard } from "./AdminAnalyticsCards";
import { UsersDrillDown, SubscriptionsDrillDown, CategoriesDrillDown, PayoutsDrillDown, JobsDrillDown } from "./AdminAnalyticsDrilldowns";
import { PIE_COLORS, TIER_COLORS } from "./adminAnalyticsConstants";

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
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Tip = Database["public"]["Tables"]["tips"]["Row"];

type DrillDown = "users" | "jobs" | "revenue" | "fees" | "subscriptions" | "categories" | "payouts" | null;

const AdminAnalytics = () => {
  const [loading, setLoading] = useState(true);
  const [drillDown, setDrillDown] = useState<DrillDown>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Raw data
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]);
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
          console.error("[AdminAnalytics] load jobs page:", error);
          break;
        }
        if (!data || data.length === 0) break;
        allJobsData = [...allJobsData, ...data];
        if (data.length < PAGE_SIZE) break;
        page++;
      }

      const [profilesRes, tipsRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("tips").select("*"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profilesRes.error) console.error("[AdminAnalytics] load profiles:", profilesRes.error);
      if (tipsRes.error) console.error("[AdminAnalytics] load tips:", tipsRes.error);
      if (rolesRes.error) console.error("[AdminAnalytics] load roles:", rolesRes.error);
      setProfiles(profilesRes.data || []);
      setAllJobs(allJobsData);
      setTips(tipsRes.data || []);
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
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ─── Computed metrics ───
  // Unified user model: there's no helper-vs-customer distinction at the
  // user level. Define cohorts by behavior instead — anyone who's applied
  // to a job is treated as supply-side; anyone who's posted as demand-side.
  // Same user can be both.
  const helperUserIds = new Set<string>();
  for (const j of allJobs) {
    if (j.helper_id) helperUserIds.add(j.helper_id);
  }
  // also count anyone who's applied (even if never selected)
  // (allApps state isn't fetched here today — fall back to helper_id from
  //  jobs, which captures actual workers; tracking applicants would need
  //  a separate query if we want full supply-side funnel.)
  const customerUserIds = new Set<string>();
  for (const j of allJobs) {
    if (j.customer_id) customerUserIds.add(j.customer_id);
  }
  const helpers = profiles.filter(p => helperUserIds.has(p.user_id));
  const customers = profiles.filter(p => customerUserIds.has(p.user_id));

  // ─── Activation funnels ───
  // Two SaaS-standard funnels: customer-side (revenue funnel) and
  // helper-side (supply funnel). Conversion % is computed against the
  // PRIOR stage so each row reads as "of the people who hit the prior
  // milestone, what % advanced?"
  const customerJobsByUser = new Map<string, number>();
  for (const j of allJobs) {
    if (j.customer_id) {
      customerJobsByUser.set(j.customer_id, (customerJobsByUser.get(j.customer_id) ?? 0) + 1);
    }
  }
  const customersWithFirstPost = new Set(allJobs.map(j => j.customer_id).filter((x): x is string => !!x));
  const customersWithFirstAccepted = new Set(
    allJobs
      .filter(j => ["accepted", "in_progress", "completed", "revision_requested", "disputed"].includes(j.status))
      .map(j => j.customer_id)
      .filter((x): x is string => !!x),
  );
  const customersWithRepeat = new Set(
    [...customerJobsByUser.entries()].filter(([, count]) => count >= 2).map(([uid]) => uid),
  );
  const customerFunnel = [
    { label: "Signed up", count: customers.length, of: customers.length },
    { label: "Posted first job", count: customersWithFirstPost.size, of: customers.length },
    { label: "Got first accept", count: customersWithFirstAccepted.size, of: customersWithFirstPost.size || 1 },
    { label: "Repeat poster (2+)", count: customersWithRepeat.size, of: customersWithFirstAccepted.size || 1 },
  ];

  const helperJobsByUser = new Map<string, number>();
  for (const j of allJobs) {
    if (j.helper_id && j.status === "completed") {
      helperJobsByUser.set(j.helper_id, (helperJobsByUser.get(j.helper_id) ?? 0) + 1);
    }
  }
  const helpersApproved = helpers.filter(p => p.approval_status === "approved");
  const helpersConnectOnboarded = helpersApproved.filter(p => !!(p as { stripe_account_id?: string }).stripe_account_id);
  const helpersWithFirstJob = new Set(
    allJobs.filter(j => j.helper_id && j.status === "completed").map(j => j.helper_id).filter((x): x is string => !!x),
  );
  const helperFunnel = [
    { label: "Signed up", count: helpers.length, of: helpers.length },
    { label: "Approved", count: helpersApproved.length, of: helpers.length },
    { label: "Connect onboarded", count: helpersConnectOnboarded.length, of: helpersApproved.length || 1 },
    { label: "Completed first job", count: helpersWithFirstJob.size, of: helpersConnectOnboarded.length || 1 },
  ];

  // ─── Monthly signup cohorts × current activity ───
  // For each of the last 6 months of signups, what % had any job activity
  // in the last 30 days? Answers "are users from cohort X still around?"
  // — a directional retention signal that doesn't require a multi-column
  // retention matrix (which would need much larger data volumes to be
  // meaningful given current scale).
  const now = new Date();
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = (d: Date) => d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const thirtyDaysAgoMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  // Active = appeared as customer_id or helper_id on any job updated in the last 30 days.
  const activeUserIds = new Set<string>();
  for (const j of allJobs) {
    const updatedAt = (j.updated_at ?? j.created_at) as string | null;
    if (!updatedAt) continue;
    if (new Date(updatedAt).getTime() < thirtyDaysAgoMs) continue;
    if (j.customer_id) activeUserIds.add(j.customer_id);
    if (j.helper_id) activeUserIds.add(j.helper_id);
  }

  const cohortMap = new Map<string, { date: Date; total: number; active: number }>();
  // Pre-seed the last 6 months so empty cohorts still appear (otherwise
  // a quiet month visually disappears, masking the dip).
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(sixMonthsAgo.getUTCFullYear(), sixMonthsAgo.getUTCMonth() + i, 1));
    cohortMap.set(monthKey(d), { date: d, total: 0, active: 0 });
  }
  for (const p of profiles) {
    if (!p.created_at) continue;
    const created = new Date(p.created_at);
    if (created < sixMonthsAgo) continue;
    const key = monthKey(created);
    const bucket = cohortMap.get(key);
    if (!bucket) continue; // older than 6 months
    bucket.total += 1;
    if (activeUserIds.has(p.user_id)) bucket.active += 1;
  }
  const cohortRetention = [...cohortMap.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  const completedJobs = allJobs.filter(j => j.status === "completed");
  // Jobs where money is actually held or paid out (NOT refunded/cancelled)
  const capturedPaymentStatuses = ["escrow", "payout_pending", "released"];
  const capturedJobs = allJobs.filter(j => capturedPaymentStatuses.includes(j.payment_status || ""));
  // Refunded jobs — money was returned, platform does NOT keep fees
  const refundedJobs = allJobs.filter(j => ["refunded"].includes(j.payment_status || ""));
  const openJobs = allJobs.filter(j => j.status === "open");
  const activeJobs = allJobs.filter(j => ["accepted", "in_progress"].includes(j.status));
  const cancelledJobs = allJobs.filter(j => j.status === "cancelled");
  const disputedJobs = allJobs.filter(j => j.status === "disputed");
  // Late cancellations where payment is still captured (not refunded)
  const lateCancelledPaidJobs = allJobs.filter(j => j.status === "cancelled" && j.late_cancellation && capturedPaymentStatuses.includes(j.payment_status || ""));

  // Gross Revenue = total amount collected via Stripe (budget + customer fee) for jobs with captured payments
  const totalRevenue = capturedJobs.reduce((s, j) => s + Number(j.budget || 0) + Number(j.customer_fee_amount || 0), 0);
  // Platform Profit = only fees from jobs where payment is still held (escrow/payout_pending/released)
  // Does NOT include refunded or cancelled-payment jobs since those fees were returned
  const totalFees = capturedJobs.reduce((s, j) => s + Number(j.customer_fee_amount || 0) + Number(j.platform_fee_amount || 0), 0);
  // Removed debug log for production submission
  // Late cancellation revenue the platform retains (cancellation fee commission)
  const lateCancelRevenue = lateCancelledPaidJobs.reduce((s, j) => {
    const cancFee = Number(j.cancellation_fee || 0);
    const commissionPercent = Number(j.helper_fee_percent ?? 10);
    return s + (cancFee * commissionPercent / 100) + Number(j.customer_fee_amount || 0);
  }, 0);
  const totalHelperPayouts = completedJobs.reduce((s, j) => {
    const helpers = j.is_group_job && j.helpers_needed ? j.helpers_needed : 1;
    const perHelper = Number(j.budget || 0) / helpers;
    const commissionPercent = Number(j.helper_fee_percent ?? 10);
    const commission = (perHelper * commissionPercent) / 100;
    return s + (perHelper - commission + Number(j.urgent_fee ?? 0));
  }, 0);
  const totalTips = tips.filter(t => t.payment_status === "paid" || t.payment_status === "completed").reduce((s, t) => s + Number(t.amount), 0);
  const avgJobValue = capturedJobs.length > 0 ? totalRevenue / capturedJobs.length : 0;
  const completionRate = allJobs.length > 0 ? (completedJobs.length / allJobs.length) * 100 : 0;
  const cancellationRate = allJobs.length > 0 ? (cancelledJobs.length / allJobs.length) * 100 : 0;
  const totalRefunded = refundedJobs.reduce((s, j) => s + Number(j.budget || 0) + Number(j.customer_fee_amount || 0), 0);

  // Subscription breakdown
  const subBasic = helpers.filter(h => h.subscription_tier === "basic").length;
  const subPro = helpers.filter(h => h.subscription_tier === "pro").length;
  const subElite = helpers.filter(h => h.subscription_tier === "elite").length;
  const subFree = helpers.filter(h => !h.subscription_tier).length;
  // Monthly subscription revenue estimate (matches live Stripe pricing: $5/$10/$15 per month)
  const totalSubRevenue = (subBasic * 5) + (subPro * 10) + (subElite * 15);

  // Category breakdown
  const categoryMap: Record<string, number> = {};
  const categoryRevenueMap: Record<string, number> = {};
  allJobs.forEach(j => {
    const cat = j.category?.replace("_", " ") || "other";
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    if (j.status === "completed") {
      categoryRevenueMap[cat] = (categoryRevenueMap[cat] || 0) + (j.budget || 0);
    }
  });
  const categoryData = Object.entries(categoryMap)
    .map(([name, count]) => ({ name, count, revenue: categoryRevenueMap[name] || 0 }))
    .sort((a, b) => b.count - a.count);

  // Monthly trends (last 6 months)
  const monthlyData: { month: string; revenue: number; fees: number; jobs: number; signups: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const year = d.getFullYear();
    const month = d.getMonth();
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

    const monthCaptured = capturedJobs.filter(j => {
      const jd = new Date(j.created_at);
      return jd.getFullYear() === year && jd.getMonth() === month;
    });
    const monthCompleted = completedJobs.filter(j => {
      const jd = new Date(j.created_at);
      return jd.getFullYear() === year && jd.getMonth() === month;
    });
    const monthSignups = profiles.filter(p => {
      const pd = new Date(p.created_at);
      return pd.getFullYear() === year && pd.getMonth() === month;
    });

    monthlyData.push({
      month: label,
      revenue: monthCaptured.reduce((s, j) => s + (j.budget || 0) + (j.customer_fee_amount || 0), 0),
      fees: monthCaptured.reduce((s, j) => s + (j.customer_fee_amount || 0) + (j.platform_fee_amount || 0), 0),
      jobs: monthCompleted.length,
      signups: monthSignups.length,
    });
  }

  // Payout status
  const escrowJobs = allJobs.filter(j => j.payment_status === "escrow");
  const pendingPayouts = allJobs.filter(j => j.payment_status === "payout_pending");
  const releasedPayouts = allJobs.filter(j => j.payment_status === "released");
  const escrowTotal = escrowJobs.reduce((s, j) => s + (j.budget || 0), 0);
  const pendingPayoutTotal = pendingPayouts.reduce((s, j) => {
    const helpers = j.is_group_job && j.helpers_needed ? j.helpers_needed : 1;
    const perHelper = (j.budget || 0) / helpers;
    const commissionPercent = j.helper_fee_percent ?? 10;
    const commission = (perHelper * commissionPercent) / 100;
    return s + (perHelper - commission + (j.urgent_fee ?? 0));
  }, 0);

  // Subscription pie data
  const subPieData = [
    { name: "Elite", value: subElite, color: TIER_COLORS.elite },
    { name: "Pro", value: subPro, color: TIER_COLORS.pro },
    { name: "Basic", value: subBasic, color: TIER_COLORS.basic },
    { name: "Free", value: subFree, color: TIER_COLORS.free },
  ].filter(d => d.value > 0);

  // Top helpers (by completed jobs)
  const helperJobCount: Record<string, number> = {};
  completedJobs.forEach(j => {
    if (j.helper_id) helperJobCount[j.helper_id] = (helperJobCount[j.helper_id] || 0) + 1;
  });

  // User growth (approved vs pending)
  const approvedUsers = profiles.filter(p => p.approval_status === "approved").length;
  const pendingUsers = profiles.filter(p => p.approval_status === "pending").length;
  const deniedUsers = profiles.filter(p => p.approval_status === "denied").length;

  // ─── Drill-down handler ───
  const openDrillDown = async (type: DrillDown) => {
    setDrillDown(type);
    setDrillLoading(true);
    if (type === "users") {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (error) console.error("[AdminAnalytics] drillDown users:", error);
      setDrillUsers(data || []);
    } else if (type === "jobs" || type === "revenue" || type === "fees" || type === "payouts") {
      const query = supabase.from("jobs").select("*").order("created_at", { ascending: false });
      if (type === "revenue" || type === "fees") query.in("payment_status", ["escrow", "payout_pending", "released"]);
      if (type === "payouts") query.in("payment_status", ["escrow", "payout_pending", "released"]);
      const { data, error } = await query;
      if (error) console.error("[AdminAnalytics] drillDown jobs:", error);
      setDrillJobs(data || []);
    } else if (type === "subscriptions") {
      const { data, error } = await supabase.from("profiles").select("*").not("subscription_tier", "is", null).order("subscription_tier");
      if (error) console.error("[AdminAnalytics] drillDown subscriptions:", error);
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
        <MetricCard
          label="Collected Revenue"
          value={`$${totalRevenue.toFixed(2)}`}
          sub={`${capturedJobs.length} active payments (excl. refunds)`}
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
              { label: "Elite", count: subElite, color: "bg-accent/20 text-accent-foreground" },
              { label: "Pro", count: subPro, color: "bg-primary/10 text-primary" },
              { label: "Basic", count: subBasic, color: "bg-secondary text-secondary-foreground" },
              { label: "Free", count: subFree, color: "bg-muted text-muted-foreground" },
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
            <p className="text-ds-11 text-muted-foreground text-center py-8">No subscribers yet</p>
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
          sub={`${helpers.length} helpers · ${customers.length} customers`}
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
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-ds-11 text-muted-foreground">In Escrow</span>
              </div>
              <div className="text-right">
                <span className="text-ds-13 font-semibold text-foreground">${escrowTotal.toFixed(2)}</span>
                <span className="text-ds-11 text-muted-foreground ml-2">({escrowJobs.length} jobs)</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-ds-11 text-muted-foreground">Payout Pending</span>
              </div>
              <div className="text-right">
                <span className="text-ds-13 font-semibold text-foreground">${pendingPayoutTotal.toFixed(2)}</span>
                <span className="text-ds-11 text-muted-foreground ml-2">({pendingPayouts.length} jobs)</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-ds-11 text-muted-foreground">Released</span>
              </div>
              <div className="text-right">
                <span className="text-ds-13 font-semibold text-foreground">{releasedPayouts.length} jobs</span>
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
                <span className="text-ds-11 text-muted-foreground">{cat.count} jobs</span>
                <span className="text-ds-11 font-semibold text-foreground">${cat.revenue.toFixed(0)}</span>
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
            <StatusRow icon={Clock} label="Pending Approval" count={pendingUsers} color="text-amber-500" />
            <StatusRow icon={XCircle} label="Denied" count={deniedUsers} color="text-destructive" />
          </div>
        </div>

        <div className="rounded-ds-md liquid-glass p-5">
          <h3 className="text-ds-13 font-semibold text-foreground mb-3">Job Completion Funnel</h3>
          <div className="space-y-2">
            <StatusRow icon={Briefcase} label="Posted" count={allJobs.length} color="text-muted-foreground" />
            <StatusRow icon={Activity} label="In Progress" count={activeJobs.length} color="text-primary" />
            <StatusRow icon={CheckCircle} label="Completed" count={completedJobs.length} color="text-emerald-500" />
            <StatusRow icon={XCircle} label="Cancelled" count={cancelledJobs.length} color="text-destructive" />
            <StatusRow icon={AlertTriangle} label="Disputed" count={disputedJobs.length} color="text-amber-500" />
          </div>
        </div>

        <div className="rounded-ds-md liquid-glass p-5">
          <h3 className="text-ds-13 font-semibold text-foreground mb-3">Monthly Recurring Revenue</h3>
          <p className="text-3xl font-bold text-foreground">${totalSubRevenue.toFixed(2)}</p>
          <p className="text-ds-11 text-muted-foreground mt-1">Projected annual: ${(totalSubRevenue * 12).toFixed(2)}</p>
          <div className="mt-4 space-y-1.5">
            <MRRRow tier="Elite" count={subElite} amount={subElite * 24.99} />
            <MRRRow tier="Pro" count={subPro} amount={subPro * 14.99} />
            <MRRRow tier="Basic" count={subBasic} amount={subBasic * 9.99} />
          </div>
        </div>
      </div>

      {/* ── Row 6.5: Activation Funnels ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <FunnelCard title="Customer activation" subtitle="Signup → revenue" stages={customerFunnel} />
        <FunnelCard title="Helper supply" subtitle="Signup → first paid job" stages={helperFunnel} />
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
