import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LogOut, Users, Briefcase, Settings, BarChart3, ClipboardCheck, ArrowRight, AlertTriangle, CheckCircle2, Clock, DollarSign, ArrowLeft, ShieldAlert, Megaphone, BellRing, Headphones, Gift, Crown } from "lucide-react";
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
import AdminReferrals from "@/components/admin/AdminReferrals";
import AdminSubscriptions from "@/components/admin/AdminSubscriptions";

type View = "home" | "analytics" | "reviews" | "people" | "jobs" | "settings" | "disputes" | "broadcasts" | "notifications" | "reports" | "support" | "referrals" | "subscriptions";

// Keys for localStorage timestamps tracking when admin last visited each section
const SEEN_KEY_PREFIX = "admin_seen_";
const getSeenTimestamp = (section: string): string | null => localStorage.getItem(`${SEEN_KEY_PREFIX}${section}`);
const markSeen = (section: string) => localStorage.setItem(`${SEEN_KEY_PREFIX}${section}`, new Date().toISOString());

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

  // Unread badge counts — items created since last visit
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const loadUnreadCounts = useCallback(async () => {
    const sections: { key: View; table: string; dateCol: string; filter?: Record<string, any>; notFilter?: Record<string, any> }[] = [
      { key: "people", table: "profiles", dateCol: "created_at", filter: { approval_status: "pending" } },
      { key: "jobs", table: "jobs", dateCol: "created_at" },
      { key: "reviews", table: "reviews", dateCol: "created_at" },
      { key: "disputes", table: "jobs", dateCol: "disputed_at", filter: { status: "disputed" } },
      { key: "reports", table: "reports", dateCol: "created_at", filter: { status: "pending" }, notFilter: { reported_type: "support" } },
      { key: "support", table: "reports", dateCol: "created_at", filter: { status: "pending", reported_type: "support" } },
      { key: "referrals", table: "referrals", dateCol: "created_at" },
      { key: "subscriptions", table: "profiles", dateCol: "updated_at", filter: { subscription_tier: "not_null" } },
    ];

    const counts: Record<string, number> = {};

    await Promise.all(sections.map(async (s) => {
      const lastSeen = getSeenTimestamp(s.key);
      let query = supabase.from(s.table as any).select("id", { count: "exact", head: true });

      if (lastSeen) {
        query = query.gt(s.dateCol, lastSeen);
      }

      if (s.filter) {
        for (const [col, val] of Object.entries(s.filter)) {
          if (val === "not_null") {
            query = query.not(col, "is", null);
          } else {
            query = query.eq(col, val);
          }
        }
      }
      if (s.notFilter) {
        for (const [col, val] of Object.entries(s.notFilter)) {
          query = query.neq(col, val);
        }
      }

      const { count } = await query;
      if (count && count > 0) counts[s.key] = count;
    }));

    setUnreadCounts(counts);
  }, []);

  const handleViewChange = useCallback((newView: View) => {
    if (newView !== "home") {
      markSeen(newView);
      setUnreadCounts(prev => {
        const next = { ...prev };
        delete next[newView];
        return next;
      });
    }
    setView(newView);
  }, []);

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
    loadUnreadCounts();

    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => { loadStats(); loadUnreadCounts(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { loadStats(); loadUnreadCounts(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => { loadStats(); loadUnreadCounts(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => { loadStats(); loadUnreadCounts(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loading]);

  useEffect(() => {
    if (view === "home" && !loading) {
      loadStats();
      loadUnreadCounts();
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
    referrals: "Referrals", subscriptions: "Subscriptions",
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
        <Button variant="ghost" size="icon" onClick={() => setShowLogoutDialog(true)} className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-xl h-9 w-9">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );

  const logoutDialog = (
    <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Log out?</AlertDialogTitle>
          <AlertDialogDescription>Are you sure you want to log out of your account?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={async () => { await supabase.auth.signOut(); navigate("/"); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Log out</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const subHeader = view !== "home" && (
    <div className="container mx-auto px-4 pt-4 pb-2 flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={() => handleViewChange("home")} className="rounded-xl h-9 w-9">
        <ArrowLeft className="w-4 h-4" />
      </Button>
      <h2 className="text-lg font-display font-bold text-foreground">{viewLabels[view]}</h2>
    </div>
  );

  if (view !== "home") {
    return (
      <div className="min-h-screen bg-background">
        {header}
        {logoutDialog}
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
          {view === "referrals" && <AdminReferrals />}
          {view === "subscriptions" && <AdminSubscriptions />}
        </div>
      </div>
    );
  }

  const quickActions: { id: View; label: string; description: string; icon: React.ReactNode; badge?: number; badgeColor?: string }[] = [
    {
      id: "people", label: "Users", description: "Manage accounts & approvals",
      icon: <Users className="w-5 h-5" />,
      badge: (unreadCounts.people || 0) > 0 ? unreadCounts.people : (stats.pendingApprovals > 0 ? stats.pendingApprovals : undefined),
      badgeColor: "bg-accent/10 text-accent-foreground",
    },
    {
      id: "jobs", label: "Jobs", description: "All tasks & listings",
      icon: <Briefcase className="w-5 h-5" />,
      badge: unreadCounts.jobs || undefined,
      badgeColor: "bg-primary/10 text-primary",
    },
    {
      id: "disputes", label: "Disputes", description: "Review disputed jobs & payments",
      icon: <ShieldAlert className="w-5 h-5" />,
      badge: (unreadCounts.disputes || 0) > 0 ? unreadCounts.disputes : (stats.disputedJobs > 0 ? stats.disputedJobs : undefined),
      badgeColor: "bg-destructive/10 text-destructive",
    },
    {
      id: "analytics", label: "Analytics", description: "Revenue, stats & breakdowns",
      icon: <BarChart3 className="w-5 h-5" />,
    },
    {
      id: "reviews", label: "Reviews", description: "Ratings & feedback",
      icon: <ClipboardCheck className="w-5 h-5" />,
      badge: unreadCounts.reviews || undefined,
      badgeColor: "bg-primary/10 text-primary",
    },
    {
      id: "reports", label: "Reports", description: "User & content reports",
      icon: <AlertTriangle className="w-5 h-5" />,
      badge: (unreadCounts.reports || 0) > 0 ? unreadCounts.reports : (stats.openReports > 0 ? stats.openReports : undefined),
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
      badge: (unreadCounts.support || 0) > 0 ? unreadCounts.support : (stats.supportTickets > 0 ? stats.supportTickets : undefined),
      badgeColor: "bg-accent/10 text-accent-foreground",
    },
    {
      id: "subscriptions", label: "Subscriptions", description: "Active tiers, expiry & purchase tracking",
      icon: <Crown className="w-5 h-5" />,
      badge: unreadCounts.subscriptions || undefined,
      badgeColor: "bg-primary/10 text-primary",
    },
    {
      id: "referrals", label: "Referrals", description: "Codes, credits & payout tracking",
      icon: <Gift className="w-5 h-5" />,
      badge: unreadCounts.referrals || undefined,
      badgeColor: "bg-primary/10 text-primary",
    },
    {
      id: "settings", label: "Settings", description: "Platform configuration",
      icon: <Settings className="w-5 h-5" />,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {header}
      {logoutDialog}
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
                onClick={() => handleViewChange("people")}
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
                onClick={() => handleViewChange("disputes")}
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
                onClick={() => handleViewChange("reports")}
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
            { label: "Pending Accounts", value: statsLoading ? "…" : stats.pendingApprovals, icon: Users, onClick: () => handleViewChange("people") },
            { label: "Active Jobs", value: statsLoading ? "…" : stats.activeJobs, icon: Briefcase, onClick: () => handleViewChange("jobs") },
            { label: "Completed", value: statsLoading ? "…" : stats.completedJobs, icon: CheckCircle2, onClick: () => handleViewChange("analytics") },
            { label: "Platform Revenue", value: statsLoading ? "…" : `$${stats.totalFees.toFixed(2)}`, icon: DollarSign, onClick: () => handleViewChange("analytics") },
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
                onClick={() => handleViewChange(action.id)}
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
