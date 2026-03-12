import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, Briefcase, DollarSign, TrendingUp, ArrowLeft, MapPin, Star, Calendar,
  Crown, Zap, CreditCard, ArrowUpRight, ArrowDownRight, Activity, PieChart,
  BarChart3, Clock, CheckCircle, XCircle, AlertTriangle, Loader2, Sparkles,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from "recharts";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Tip = Database["public"]["Tables"]["tips"]["Row"];

type DrillDown = "users" | "jobs" | "revenue" | "fees" | "subscriptions" | "categories" | "payouts" | null;

const TIER_COLORS: Record<string, string> = {
  basic: "hsl(var(--secondary))",
  pro: "hsl(var(--primary))",
  elite: "hsl(var(--accent))",
  free: "hsl(var(--muted))",
};

const TIER_LABELS: Record<string, string> = {
  basic: "Basic ($9.99/mo)",
  pro: "Pro ($14.99/mo)",
  elite: "Elite ($24.99/mo)",
  free: "Free",
};

const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--accent))", "hsl(var(--muted))", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4"];

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

  useEffect(() => {
    const load = async () => {
      const [profilesRes, jobsRes, tipsRes] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("jobs").select("*"),
        supabase.from("tips").select("*"),
      ]);
      setProfiles(profilesRes.data || []);
      setAllJobs(jobsRes.data || []);
      setTips(tipsRes.data || []);
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
  const helpers = profiles.filter(p => p.role === "helper");
  const customers = profiles.filter(p => p.role === "customer");
  const completedJobs = allJobs.filter(j => j.status === "completed");
  const openJobs = allJobs.filter(j => j.status === "open");
  const activeJobs = allJobs.filter(j => ["accepted", "in_progress"].includes(j.status));
  const cancelledJobs = allJobs.filter(j => j.status === "cancelled");
  const disputedJobs = allJobs.filter(j => j.status === "disputed");

  const totalRevenue = completedJobs.reduce((s, j) => s + (j.budget || 0), 0);
  const totalFees = completedJobs.reduce((s, j) => s + (j.platform_fee_amount || 0), 0);
  const totalHelperPayouts = totalRevenue - totalFees;
  const totalTips = tips.filter(t => t.payment_status === "paid" || t.payment_status === "completed").reduce((s, t) => s + t.amount, 0);
  const avgJobValue = completedJobs.length > 0 ? totalRevenue / completedJobs.length : 0;
  const completionRate = allJobs.length > 0 ? (completedJobs.length / allJobs.length) * 100 : 0;
  const cancellationRate = allJobs.length > 0 ? (cancelledJobs.length / allJobs.length) * 100 : 0;

  // Subscription breakdown
  const subBasic = helpers.filter(h => h.subscription_tier === "basic").length;
  const subPro = helpers.filter(h => h.subscription_tier === "pro").length;
  const subElite = helpers.filter(h => h.subscription_tier === "elite").length;
  const subFree = helpers.filter(h => !h.subscription_tier).length;
  const totalSubRevenue = (subBasic * 9.99) + (subPro * 14.99) + (subElite * 24.99);

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

    const monthJobs = completedJobs.filter(j => {
      const jd = new Date(j.created_at);
      return jd.getFullYear() === year && jd.getMonth() === month;
    });
    const monthSignups = profiles.filter(p => {
      const pd = new Date(p.created_at);
      return pd.getFullYear() === year && pd.getMonth() === month;
    });

    monthlyData.push({
      month: label,
      revenue: monthJobs.reduce((s, j) => s + (j.budget || 0), 0),
      fees: monthJobs.reduce((s, j) => s + (j.platform_fee_amount || 0), 0),
      jobs: monthJobs.length,
      signups: monthSignups.length,
    });
  }

  // Payout status
  const escrowJobs = allJobs.filter(j => j.payment_status === "escrow");
  const pendingPayouts = allJobs.filter(j => j.payment_status === "payout_pending");
  const releasedPayouts = allJobs.filter(j => j.payment_status === "released");
  const escrowTotal = escrowJobs.reduce((s, j) => s + (j.budget || 0), 0);
  const pendingPayoutTotal = pendingPayouts.reduce((s, j) => s + (j.budget - (j.platform_fee_amount || 0)), 0);

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
      const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      setDrillUsers(data || []);
    } else if (type === "jobs" || type === "revenue" || type === "fees" || type === "payouts") {
      const query = supabase.from("jobs").select("*").order("created_at", { ascending: false });
      if (type === "revenue" || type === "fees") query.eq("status", "completed");
      if (type === "payouts") query.in("payment_status", ["escrow", "payout_pending", "released"]);
      const { data } = await query;
      setDrillJobs(data || []);
    } else if (type === "subscriptions") {
      const { data } = await supabase.from("profiles").select("*").eq("role", "helper").order("subscription_tier");
      setDrillUsers(data || []);
    }
    setDrillLoading(false);
  };

  // ─── Drill-down views ───
  if (drillDown) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setDrillDown(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-display font-bold text-foreground">
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : drillDown === "users" ? (
          <UsersDrillDown users={drillUsers} />
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
      <h2 className="text-2xl font-display font-bold text-foreground">Analytics Dashboard</h2>

      {/* ── Row 1: Key Financial Metrics ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Gross Revenue"
          value={`$${totalRevenue.toFixed(2)}`}
          sub={`${completedJobs.length} completed jobs`}
          icon={DollarSign}
          onClick={() => openDrillDown("revenue")}
        />
        <MetricCard
          label="Platform Profit"
          value={`$${totalFees.toFixed(2)}`}
          sub={`${totalRevenue > 0 ? ((totalFees / totalRevenue) * 100).toFixed(1) : 0}% of revenue`}
          icon={TrendingUp}
          accent
          onClick={() => openDrillDown("fees")}
        />
        <MetricCard
          label="Helper Payouts"
          value={`$${totalHelperPayouts.toFixed(2)}`}
          sub={`Avg $${completedJobs.length > 0 ? (totalHelperPayouts / completedJobs.length).toFixed(2) : "0"}/job`}
          icon={CreditCard}
          onClick={() => openDrillDown("payouts")}
        />
        <MetricCard
          label="Tips Collected"
          value={`$${totalTips.toFixed(2)}`}
          sub={`${tips.length} total tips`}
          icon={Star}
        />
      </div>

      {/* ── Row 2: Subscription Revenue ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <button onClick={() => openDrillDown("subscriptions")} className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary/30 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Subscription Revenue
            </h3>
            <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">Details →</span>
          </div>
          <p className="text-2xl font-bold text-foreground">${totalSubRevenue.toFixed(2)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              { label: "Elite", count: subElite, color: "bg-accent/20 text-accent-foreground" },
              { label: "Pro", count: subPro, color: "bg-primary/10 text-primary" },
              { label: "Basic", count: subBasic, color: "bg-secondary text-secondary-foreground" },
              { label: "Free", count: subFree, color: "bg-muted text-muted-foreground" },
            ].map(t => (
              <div key={t.label} className="text-center">
                <p className="text-lg font-bold text-foreground">{t.count}</p>
                <Badge className={`text-[10px] ${t.color}`}>{t.label}</Badge>
              </div>
            ))}
          </div>
          {helpers.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              {((helpers.length - subFree) / helpers.length * 100).toFixed(0)}% of helpers subscribed
            </p>
          )}
        </button>

        {/* Subscription pie chart */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-primary" /> Subscriber Distribution
          </h3>
          {subPieData.length > 0 ? (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={subPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                    {subPieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, name: string) => [`${value} helpers`, name]} />
                  <Legend />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No subscribers yet</p>
          )}
        </div>
      </div>

      {/* ── Row 3: Revenue Trend Chart ── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" /> Revenue &amp; Growth — Last 6 Months
        </h3>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Legend />
              <Line type="monotone" dataKey="revenue" name="Revenue ($)" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="fees" name="Profit ($)" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="signups" name="New Users" stroke="hsl(var(--secondary))" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
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
        <button onClick={() => openDrillDown("payouts")} className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary/30 transition-all group">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Payout Pipeline
            <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity ml-auto">Details →</span>
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-sm text-muted-foreground">In Escrow</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold text-foreground">${escrowTotal.toFixed(2)}</span>
                <span className="text-xs text-muted-foreground ml-2">({escrowJobs.length} jobs)</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-sm text-muted-foreground">Payout Pending</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold text-foreground">${pendingPayoutTotal.toFixed(2)}</span>
                <span className="text-xs text-muted-foreground ml-2">({pendingPayouts.length} jobs)</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-sm text-muted-foreground">Released</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold text-foreground">{releasedPayouts.length} jobs</span>
              </div>
            </div>
          </div>
        </button>

        {/* Category breakdown */}
        <button onClick={() => openDrillDown("categories")} className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary/30 transition-all group">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-primary" /> Top Categories
            <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity ml-auto">Details →</span>
          </h3>
          <div className="space-y-2">
            {categoryData.slice(0, 5).map((cat, i) => (
              <div key={cat.name} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="text-sm text-foreground capitalize flex-1">{cat.name}</span>
                <span className="text-xs text-muted-foreground">{cat.count} jobs</span>
                <span className="text-xs font-semibold text-foreground">${cat.revenue.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </button>
      </div>

      {/* ── Row 6: User Status & Quick Stats ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">User Status</h3>
          <div className="space-y-2">
            <StatusRow icon={CheckCircle} label="Approved" count={approvedUsers} color="text-primary" />
            <StatusRow icon={Clock} label="Pending Approval" count={pendingUsers} color="text-amber-500" />
            <StatusRow icon={XCircle} label="Denied" count={deniedUsers} color="text-destructive" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Job Completion Funnel</h3>
          <div className="space-y-2">
            <StatusRow icon={Briefcase} label="Posted" count={allJobs.length} color="text-muted-foreground" />
            <StatusRow icon={Activity} label="In Progress" count={activeJobs.length} color="text-primary" />
            <StatusRow icon={CheckCircle} label="Completed" count={completedJobs.length} color="text-emerald-500" />
            <StatusRow icon={XCircle} label="Cancelled" count={cancelledJobs.length} color="text-destructive" />
            <StatusRow icon={AlertTriangle} label="Disputed" count={disputedJobs.length} color="text-amber-500" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Monthly Recurring Revenue</h3>
          <p className="text-3xl font-bold text-foreground">${totalSubRevenue.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">Projected annual: ${(totalSubRevenue * 12).toFixed(2)}</p>
          <div className="mt-4 space-y-1.5">
            <MRRRow tier="Elite" count={subElite} amount={subElite * 24.99} />
            <MRRRow tier="Pro" count={subPro} amount={subPro * 14.99} />
            <MRRRow tier="Basic" count={subBasic} amount={subBasic * 9.99} />
          </div>
        </div>
      </div>

      {/* ── Row 7: Monthly Jobs Bar Chart ── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-primary" /> Jobs per Month
        </h3>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
              />
              <Bar dataKey="jobs" name="Completed Jobs" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ─── Reusable components ───

const MetricCard = ({ label, value, sub, icon: Icon, accent, warning, onClick }: {
  label: string; value: string | number; sub: string; icon: any; accent?: boolean; warning?: boolean; onClick?: () => void;
}) => (
  <button
    onClick={onClick}
    disabled={!onClick}
    className={`rounded-xl border bg-card p-5 text-left transition-all group ${
      onClick ? "hover:bg-secondary/30 hover:border-primary/30 cursor-pointer" : ""
    } ${warning ? "border-amber-500/30" : "border-border"}`}
  >
    <div className="flex items-center justify-between mb-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Icon className={`w-5 h-5 ${accent ? "text-primary" : warning ? "text-amber-500" : "text-primary"} group-hover:scale-110 transition-transform`} />
    </div>
    <p className={`text-2xl font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    {onClick && <p className="text-[10px] text-primary mt-2 opacity-0 group-hover:opacity-100 transition-opacity">Click to view details →</p>}
  </button>
);

const StatusRow = ({ icon: Icon, label, count, color }: { icon: any; label: string; count: number; color: string }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
    <span className="text-sm font-semibold text-foreground">{count}</span>
  </div>
);

const MRRRow = ({ tier, count, amount }: { tier: string; count: number; amount: number }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-muted-foreground">{tier} × {count}</span>
    <span className="font-semibold text-foreground">${amount.toFixed(2)}</span>
  </div>
);

// ─── Drill-down: Users ───
const UsersDrillDown = ({ users }: { users: Profile[] }) => {
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "denied">("all");
  const filtered = users.filter(u => statusFilter === "all" || u.approval_status === statusFilter);

  const statusColor = (status: string) => {
    if (status === "approved") return "bg-primary/10 text-primary";
    if (status === "denied") return "bg-destructive/10 text-destructive";
    return "bg-accent/20 text-accent-foreground";
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
        {(["all", "pending", "approved", "denied"] as const).map(s => {
          const count = users.filter(u => s === "all" || u.approval_status === s).length;
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${statusFilter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {s} ({count})
            </button>
          );
        })}
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map(u => (
          <div key={u.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-sm">{u.full_name || "—"}</p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-0.5">
                  {u.email && <span>{u.email}</span>}
                  {u.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{u.location}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {u.subscription_tier && (
                  <Badge className="text-[10px] bg-primary/10 text-primary capitalize">{u.subscription_tier}</Badge>
                )}
                <Badge className={`text-xs capitalize ${statusColor(u.approval_status)}`}>{u.approval_status}</Badge>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Joined {new Date(u.created_at).toLocaleDateString()} · {u.role}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Drill-down: Subscriptions ───
const SubscriptionsDrillDown = ({ users }: { users: Profile[] }) => {
  const [tierFilter, setTierFilter] = useState<string>("all");
  const tiers = ["all", "elite", "pro", "basic", "free"];
  const filtered = users.filter(u => {
    if (tierFilter === "all") return true;
    if (tierFilter === "free") return !u.subscription_tier;
    return u.subscription_tier === tierFilter;
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
        {tiers.map(t => {
          const count = users.filter(u => t === "all" || (t === "free" ? !u.subscription_tier : u.subscription_tier === t)).length;
          return (
            <button key={t} onClick={() => setTierFilter(t)}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${tierFilter === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t} ({count})
            </button>
          );
        })}
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map(u => (
          <div key={u.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground text-sm">{u.full_name || "—"}</p>
              <p className="text-xs text-muted-foreground">{u.email} · {u.location || "No location"}</p>
            </div>
            <Badge className={`capitalize text-xs ${
              u.subscription_tier === "elite" ? "bg-accent/20 text-accent-foreground" :
              u.subscription_tier === "pro" ? "bg-primary/10 text-primary" :
              u.subscription_tier === "basic" ? "bg-secondary text-secondary-foreground" :
              "bg-muted text-muted-foreground"
            }`}>
              {u.subscription_tier || "Free"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Drill-down: Categories ───
const CategoriesDrillDown = ({ data }: { data: { name: string; count: number; revenue: number }[] }) => (
  <div className="space-y-3">
    <div className="h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" width={90} />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
          />
          <Bar dataKey="count" name="Jobs" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className="space-y-2">
      {data.map((cat, i) => (
        <div key={cat.name} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="text-sm font-medium text-foreground capitalize">{cat.name}</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{cat.count} jobs</span>
            <span className="font-semibold text-foreground">${cat.revenue.toFixed(2)} revenue</span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─── Drill-down: Payouts ───
const PayoutsDrillDown = ({ jobs }: { jobs: Job[] }) => {
  const [filter, setFilter] = useState<string>("all");
  const statuses = ["all", "escrow", "payout_pending", "released", "refunded"];
  const filtered = filter === "all" ? jobs : jobs.filter(j => j.payment_status === filter);

  const statusLabel: Record<string, string> = {
    escrow: "In Escrow",
    payout_pending: "Payout Pending",
    released: "Released",
    refunded: "Refunded",
    cancelled: "Cancelled",
  };

  const statusDot: Record<string, string> = {
    escrow: "bg-amber-500",
    payout_pending: "bg-blue-500",
    released: "bg-emerald-500",
    refunded: "bg-red-500",
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap bg-secondary/50 rounded-lg p-1">
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${filter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {s === "all" ? `All (${jobs.length})` : `${statusLabel[s] || s} (${jobs.filter(j => j.payment_status === s).length})`}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Total for filter ({filtered.length} jobs)</span>
        <span className="text-lg font-bold text-foreground">
          ${filtered.reduce((s, j) => s + (j.budget || 0), 0).toFixed(2)}
        </span>
      </div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map(j => (
          <div key={j.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-sm truncate">{j.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{j.location} · {new Date(j.date_needed).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className={`w-2 h-2 rounded-full ${statusDot[j.payment_status || ""] || "bg-muted"}`} />
                <span className="text-xs text-muted-foreground capitalize">{statusLabel[j.payment_status || ""] || j.payment_status}</span>
              </div>
            </div>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span>Budget: ${j.budget}</span>
              <span>Fee: ${j.platform_fee_amount || 0}</span>
              <span>Payout: ${j.budget - (j.platform_fee_amount || 0)}</span>
              {j.payout_scheduled_at && <span>Scheduled: {new Date(j.payout_scheduled_at).toLocaleString()}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Drill-down: Jobs (existing, cleaned up) ───
const JobsDrillDown = ({ jobs, showFinancials, showFees }: { jobs: Job[]; showFinancials: boolean; showFees: boolean }) => {
  const [filter, setFilter] = useState<string>("all");
  const statusOptions = ["all", "open", "accepted", "in_progress", "completed", "cancelled"];
  const filtered = filter === "all" ? jobs : jobs.filter(j => j.status === filter);
  const total = filtered.reduce((s, j) => s + (showFees ? (j.platform_fee_amount || 0) : j.budget), 0);

  const statusColor: Record<string, string> = {
    open: "bg-primary/10 text-primary",
    accepted: "bg-accent/20 text-accent-foreground",
    in_progress: "bg-accent/20 text-accent-foreground",
    completed: "bg-secondary text-secondary-foreground",
    cancelled: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap bg-secondary/50 rounded-lg p-1">
        {statusOptions.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${filter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {s === "all" ? `All (${jobs.length})` : `${s.replace("_", " ")} (${jobs.filter(j => j.status === s).length})`}
          </button>
        ))}
      </div>

      {showFinancials && (
        <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{showFees ? "Total Fees" : "Total Revenue"} ({filtered.length} jobs)</span>
          <span className="text-lg font-bold text-foreground">${total.toFixed(2)}</span>
        </div>
      )}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map(j => (
          <div key={j.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-sm truncate">{j.title}</p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{j.location}</span>
                  <span className="capitalize">{j.category?.replace("_", " ")}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge className={`text-xs capitalize ${statusColor[j.status] || ""}`}>{j.status.replace("_", " ")}</Badge>
                <span className="text-sm font-semibold text-foreground">${j.budget}</span>
              </div>
            </div>
            {showFinancials && (
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span>Budget: ${j.budget}</span>
                <span>Fee: ${j.platform_fee_amount || 0}</span>
                <span>Payout: ${j.budget - (j.platform_fee_amount || 0)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminAnalytics;
