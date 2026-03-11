import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Briefcase, DollarSign, TrendingUp, ArrowLeft, MapPin, Star, Calendar } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

type DrillDown = "users" | "jobs" | "revenue" | "fees" | null;

const AdminAnalytics = () => {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalJobs: 0, openJobs: 0, completedJobs: 0, inProgressJobs: 0, cancelledJobs: 0,
    totalRevenue: 0, totalFees: 0,
  });
  const [loading, setLoading] = useState(true);
  const [drillDown, setDrillDown] = useState<DrillDown>(null);

  // Drill-down data
  const [users, setUsers] = useState<Profile[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [profilesRes, jobsRes] = await Promise.all([
        supabase.from("profiles").select("role"),
        supabase.from("jobs").select("status, budget, payment_status, platform_fee_amount"),
      ]);
      const profiles = profilesRes.data || [];
      const allJobs = jobsRes.data || [];
      const completedJobs = allJobs.filter((j) => j.status === "completed");

      setStats({
        totalUsers: profiles.length,
        totalJobs: allJobs.length,
        openJobs: allJobs.filter((j) => j.status === "open").length,
        completedJobs: completedJobs.length,
        inProgressJobs: allJobs.filter((j) => j.status === "in_progress" || j.status === "accepted").length,
        cancelledJobs: allJobs.filter((j) => j.status === "cancelled").length,
        totalRevenue: completedJobs.reduce((sum, j) => sum + (j.budget || 0), 0),
        totalFees: completedJobs.reduce((sum, j) => sum + (j.platform_fee_amount || 0), 0),
      });
      setLoading(false);
    };
    load();
  }, []);

  const openDrillDown = async (type: DrillDown) => {
    setDrillDown(type);
    setDrillLoading(true);

    if (type === "users") {
      const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      setUsers(data || []);
    } else if (type === "jobs" || type === "revenue" || type === "fees") {
      const query = supabase.from("jobs").select("*").order("created_at", { ascending: false });
      if (type === "revenue" || type === "fees") query.eq("status", "completed");
      const { data } = await query;
      setJobs(data || []);
    }
    setDrillLoading(false);
  };

  if (loading) return <p className="text-muted-foreground">Loading analytics…</p>;

  const cards = [
    { key: "users" as DrillDown, label: "Total Users", value: stats.totalUsers, sub: `${stats.totalCustomers} customers · ${stats.totalHelpers} helpers`, icon: Users },
    { key: "jobs" as DrillDown, label: "Total Jobs", value: stats.totalJobs, sub: `${stats.openJobs} open · ${stats.inProgressJobs} active · ${stats.completedJobs} done`, icon: Briefcase },
    { key: "revenue" as DrillDown, label: "Total Revenue", value: `$${stats.totalRevenue.toFixed(2)}`, sub: `From ${stats.completedJobs} completed jobs`, icon: DollarSign },
    { key: "fees" as DrillDown, label: "Platform Fees", value: `$${stats.totalFees.toFixed(2)}`, sub: "Helpr's earnings", icon: TrendingUp },
  ];

  if (drillDown) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setDrillDown(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-display font-bold text-foreground">
            {drillDown === "users" ? "All Users" : drillDown === "jobs" ? "All Jobs" : drillDown === "revenue" ? "Revenue Breakdown" : "Fee Breakdown"}
          </h2>
        </div>

        {drillLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : drillDown === "users" ? (
          <UsersDrillDown users={users} />
        ) : (
          <JobsDrillDown jobs={jobs} showFinancials={drillDown === "revenue" || drillDown === "fees"} showFees={drillDown === "fees"} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-display font-bold text-foreground">Analytics</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <button
            key={card.label}
            onClick={() => openDrillDown(card.key)}
            className="rounded-xl border border-border bg-card p-5 text-left hover:bg-secondary/30 hover:border-primary/30 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{card.label}</span>
              <card.icon className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
            </div>
            <p className="text-2xl font-bold text-foreground">{card.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
            <p className="text-[10px] text-primary mt-2 opacity-0 group-hover:opacity-100 transition-opacity">Click to view details →</p>
          </button>
        ))}
      </div>

      {/* Summary row */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Quick Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Avg Job Value</p>
            <p className="font-semibold text-foreground">{stats.completedJobs > 0 ? `$${(stats.totalRevenue / stats.completedJobs).toFixed(2)}` : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Avg Fee/Job</p>
            <p className="font-semibold text-foreground">{stats.completedJobs > 0 ? `$${(stats.totalFees / stats.completedJobs).toFixed(2)}` : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Completion Rate</p>
            <p className="font-semibold text-foreground">{stats.totalJobs > 0 ? `${((stats.completedJobs / stats.totalJobs) * 100).toFixed(1)}%` : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Cancellation Rate</p>
            <p className="font-semibold text-foreground">{stats.totalJobs > 0 ? `${((stats.cancelledJobs / stats.totalJobs) * 100).toFixed(1)}%` : "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Drill-down: Users ---
const UsersDrillDown = ({ users }: { users: Profile[] }) => {
  const [roleFilter, setRoleFilter] = useState<"all" | "customer" | "helper">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "denied">("all");

  const filtered = users
    .filter((u) => roleFilter === "all" || u.role === roleFilter)
    .filter((u) => statusFilter === "all" || u.approval_status === statusFilter);

  const statusColor = (status: string) => {
    if (status === "approved") return "bg-primary/10 text-primary";
    if (status === "denied") return "bg-destructive/10 text-destructive";
    return "bg-accent/20 text-accent-foreground";
  };

  const statusOptions = ["all", "pending", "approved", "denied"] as const;

  return (
    <div className="space-y-3">
      {/* Role filter */}
      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
        {(["all", "customer", "helper"] as const).map((f) => (
          <button key={f} onClick={() => setRoleFilter(f)}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${roleFilter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {f} {f === "all" ? `(${users.length})` : `(${users.filter(u => u.role === f).length})`}
          </button>
        ))}
      </div>

      {/* Approval status filter */}
      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
        {statusOptions.map((s) => {
          const count = users
            .filter((u) => roleFilter === "all" || u.role === roleFilter)
            .filter((u) => s === "all" || u.approval_status === s).length;
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${statusFilter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {s} ({count})
            </button>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} users</div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map((u) => (
          <div key={u.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-sm">{u.full_name || "—"}</p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-0.5">
                  {(u as any).email && <span>{(u as any).email}</span>}
                  {u.phone && <span>{u.phone}</span>}
                  {u.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{u.location}</span>}
                </div>
                {u.skills && <p className="text-xs text-muted-foreground mt-1">Skills: {u.skills}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge className={`text-xs capitalize ${statusColor(u.approval_status)}`}>{u.approval_status}</Badge>
                <Badge variant="secondary" className="text-xs capitalize">{u.role}</Badge>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Joined {new Date(u.created_at).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Drill-down: Jobs ---
const JobsDrillDown = ({ jobs, showFinancials, showFees }: { jobs: Job[]; showFinancials: boolean; showFees: boolean }) => {
  const [filter, setFilter] = useState<string>("all");

  const statusOptions = ["all", "open", "accepted", "in_progress", "completed", "cancelled"];
  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  const statusColor: Record<string, string> = {
    open: "bg-primary/10 text-primary",
    accepted: "bg-accent/20 text-accent-foreground",
    in_progress: "bg-accent/20 text-accent-foreground",
    completed: "bg-secondary text-secondary-foreground",
    cancelled: "bg-destructive/10 text-destructive",
    revision_requested: "bg-destructive/10 text-destructive",
  };

  const total = filtered.reduce((s, j) => s + (showFees ? (j.platform_fee_amount || 0) : j.budget), 0);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap bg-secondary/50 rounded-lg p-1">
        {statusOptions.map((s) => (
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

      <div className="text-xs text-muted-foreground">{filtered.length} jobs</div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map((j) => (
          <div key={j.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-sm truncate">{j.title}</p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{j.location}</span>
                  <span className="flex items-center gap-0.5"><Calendar className="w-3 h-3" />{new Date(j.date_needed).toLocaleDateString()}</span>
                  <span className="capitalize">{j.category.replace("_", " ")}</span>
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
                <span>Helper payout: ${j.budget - (j.platform_fee_amount || 0)}</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1.5">Created {new Date(j.created_at).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminAnalytics;
