import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LogOut, Users, Briefcase, Settings, BarChart3, ClipboardCheck, ArrowRight, AlertTriangle, CheckCircle2, Clock, DollarSign, ArrowLeft, ShieldAlert, Megaphone, BellRing, Headphones } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AdminUsers from "@/components/admin/AdminUsers";
import AdminJobs from "@/components/admin/AdminJobs";
import AdminSettings from "@/components/admin/AdminSettings";
import AdminAnalytics from "@/components/admin/AdminAnalytics";
import AdminReviews from "@/components/admin/AdminReviews";
import AdminDisputes from "@/components/admin/AdminDisputes";
import AdminBroadcasts from "@/components/admin/AdminBroadcasts";
import AdminNotifications from "@/components/admin/AdminNotifications";
import AdminReports from "@/components/admin/AdminReports";
import AdminSupport from "@/components/admin/AdminSupport";

type View = "home" | "analytics" | "reviews" | "people" | "jobs" | "settings" | "disputes" | "broadcasts" | "notifications" | "reports" | "support";

const Admin = () => {
  const { loading } = useAdminAuth();
  usePageTitle("Admin — Helpr");
  const navigate = useNavigate();
  const [view, setView] = useState<View>("home");
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [stats, setStats] = useState({
    totalUsers: 0, pendingApprovals: 0, openReports: 0, supportTickets: 0,
    activeJobs: 0, completedJobs: 0, totalRevenue: 0, totalFees: 0,
    pendingReviews: 0, disputedJobs: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = async () => {
    const [profilesRes, pendingRes, reportsRes, supportRes, activeRes, completedRes, disputesRes, reviewsRes, feesRes] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").neq("reported_type", "support"),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").eq("reported_type", "support"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["open", "accepted", "in_progress"]),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "disputed" as any),
      supabase.from("reviews").select("id", { count: "exact", head: true }),
      supabase.from("jobs").select("budget, platform_fee_amount").eq("status", "completed"),
    ]);
    const feeRows = feesRes.data || [];
    setStats({
      totalUsers: profilesRes.count || 0,
      pendingApprovals: pendingRes.count || 0,
      openReports: reportsRes.count || 0,
      supportTickets: supportRes.count || 0,
      activeJobs: activeRes.count || 0,
      completedJobs: completedRes.count || 0,
      totalRevenue: feeRows.reduce((s, j) => s + (j.budget || 0), 0),
      totalFees: feeRows.reduce((s, j) => s + ((j as any).platform_fee_amount || 0), 0),
      pendingReviews: reviewsRes.count || 0,
      disputedJobs: disputesRes.count || 0,
    });
    setStatsLoading(false);
  };

  useEffect(() => {
    if (loading) return;
    loadStats();
  }, [loading]);

  // Refresh stats when returning to the home view
  useEffect(() => {
    if (view === "home" && !loading) {
      loadStats();
    }
  }, [view]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const viewLabels: Record<View, string> = {
    home: "Admin", analytics: "Analytics", reviews: "Reviews", people: "Users",
    jobs: "Jobs", settings: "Settings", disputes: "Disputes", broadcasts: "Broadcasts",
    notifications: "Notifications", reports: "Reports", support: "Support Tickets",
  };

  const header = (
    <header className="sticky top-0 z-40 glass border-b border-border/30">
      <div className="container mx-auto flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2">
          <Link to="/dashboard" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md transition-transform duration-200 group-hover:scale-105">
              <span className="text-primary-foreground font-bold text-sm">H</span>
            </div>
            <span className="text-lg font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              Helpr
            </span>
          </Link>
          <span className="text-[10px] font-medium bg-destructive/10 text-destructive px-2 py-0.5 rounded-full uppercase tracking-wide">Admin</span>
        </div>
        <Button variant="ghost" size="icon" onClick={async () => { await supabase.auth.signOut(); navigate("/"); }} className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-xl h-9 w-9">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );

  const subHeader = view !== "home" && (
    <div className="container mx-auto px-4 pt-4 pb-2 flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={() => setView("home")} className="rounded-xl h-9 w-9">
        <ArrowLeft className="w-4 h-4" />
      </Button>
      <h2 className="text-lg font-display font-bold text-foreground">{viewLabels[view]}</h2>
    </div>
  );

  if (view !== "home") {
    return (
      <div className="min-h-screen bg-background">
        {header}
        {subHeader}
        <div className="container mx-auto px-4 py-4">
          {view === "analytics" && <AdminAnalytics />}
          {view === "reviews" && <AdminReviews />}
          {view === "people" && <AdminUsers />}
          {view === "jobs" && <AdminJobs />}
          {view === "settings" && <AdminSettings />}
          {view === "disputes" && <AdminDisputes />}
          {view === "broadcasts" && <AdminBroadcasts />}
          {view === "notifications" && <AdminNotifications />}
          {view === "reports" && <AdminReports />}
          {view === "support" && <AdminSupport />}
        </div>
      </div>
    );
  }

  const quickActions: { id: View; label: string; description: string; icon: React.ReactNode; badge?: number; badgeColor?: string }[] = [
    {
      id: "jobs", label: "Jobs", description: "All tasks & listings",
      icon: <Briefcase className="w-5 h-5" />,
    },
    {
      id: "disputes", label: "Disputes", description: "Review disputed jobs & payments",
      icon: <ShieldAlert className="w-5 h-5" />,
      badge: stats.disputedJobs > 0 ? stats.disputedJobs : undefined,
      badgeColor: "bg-destructive/10 text-destructive",
    },
    {
      id: "analytics", label: "Analytics", description: "Revenue, stats & breakdowns",
      icon: <BarChart3 className="w-5 h-5" />,
    },
    {
      id: "reviews", label: "Reviews", description: "Ratings & feedback",
      icon: <ClipboardCheck className="w-5 h-5" />,
    },
    {
      id: "reports", label: "Reports", description: "User & content reports",
      icon: <AlertTriangle className="w-5 h-5" />,
      badge: stats.openReports > 0 ? stats.openReports : undefined,
      badgeColor: "bg-destructive/10 text-destructive",
    },
    {
      id: "broadcasts", label: "Broadcasts", description: "Send announcements to all users",
      icon: <Megaphone className="w-5 h-5" />,
    },
    {
      id: "notifications", label: "Notifications", description: "Choose which alerts you receive",
      icon: <BellRing className="w-5 h-5" />,
    },
    {
      id: "support", label: "Support Tickets", description: "Messages, suggestions & help requests",
      icon: <Headphones className="w-5 h-5" />,
      badge: stats.supportTickets > 0 ? stats.supportTickets : undefined,
      badgeColor: "bg-accent/10 text-accent-foreground",
    },
    {
      id: "settings", label: "Settings", description: "Platform configuration",
      icon: <Settings className="w-5 h-5" />,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {header}
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Welcome */}
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">Platform overview and management</p>
        </div>

        {/* Alerts */}
        {(stats.pendingApprovals > 0 || stats.openReports > 0 || stats.disputedJobs > 0) && (
          <div className="flex flex-col sm:flex-row gap-3">
            {stats.pendingApprovals > 0 && (
              <button
                onClick={() => setView("people")}
                className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4 flex-1 text-left hover:bg-accent/10 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-accent-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{stats.pendingApprovals} pending approval{stats.pendingApprovals !== 1 ? "s" : ""}</p>
                  <p className="text-xs text-muted-foreground">Review new signups</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            {stats.disputedJobs > 0 && (
              <button
                onClick={() => setView("disputes")}
                className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex-1 text-left hover:bg-destructive/10 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5 text-destructive" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{stats.disputedJobs} active dispute{stats.disputedJobs !== 1 ? "s" : ""}</p>
                  <p className="text-xs text-muted-foreground">Payment on hold</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            {stats.openReports > 0 && (
              <button
                onClick={() => setView("reports")}
                className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex-1 text-left hover:bg-destructive/10 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{stats.openReports} open report{stats.openReports !== 1 ? "s" : ""}</p>
                  <p className="text-xs text-muted-foreground">Needs attention</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
        )}

        {/* Stats overview */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Pending Accounts", value: statsLoading ? "…" : stats.pendingApprovals, icon: Users, onClick: () => setView("people") },
            { label: "Active Jobs", value: statsLoading ? "…" : stats.activeJobs, icon: Briefcase, onClick: () => setView("jobs") },
            { label: "Completed", value: statsLoading ? "…" : stats.completedJobs, icon: CheckCircle2, onClick: () => setView("analytics") },
            { label: "Platform Fees", value: statsLoading ? "…" : `$${stats.totalFees.toFixed(0)}`, icon: DollarSign, onClick: () => setView("analytics") },
          ].map((card) => (
            <button
              key={card.label}
              onClick={card.onClick}
              className="rounded-xl border border-border bg-card p-5 text-left hover:bg-secondary/30 hover:border-primary/20 transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{card.label}</span>
                <card.icon className="w-4 h-4 text-primary opacity-60 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-2xl font-bold text-foreground">{card.value}</p>
            </button>
          ))}
        </div>

        {/* Navigation cards */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Manage</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {quickActions.map((action) => (
              <button
                key={action.id}
                onClick={() => setView(action.id)}
                className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 text-left hover:bg-secondary/20 hover:border-primary/20 transition-all group"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary/15 transition-colors flex-shrink-0">
                  {action.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground">{action.label}</p>
                    {action.badge && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${action.badgeColor}`}>
                        {action.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;
