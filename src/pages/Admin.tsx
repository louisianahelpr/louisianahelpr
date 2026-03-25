import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  LogOut, Users, Briefcase, Settings, BarChart3, ClipboardCheck,
  AlertTriangle, CheckCircle2, DollarSign, ShieldAlert, Megaphone,
  BellRing, Headphones, Gift, Crown, Menu, X, TrendingUp, Activity,
} from "lucide-react";
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
import AdminFraudDashboard from "@/components/admin/AdminFraudDashboard";
import AdminAuditLog from "@/components/admin/AdminAuditLog";
import AdminHealth from "@/components/admin/AdminHealth";
import AdminExport from "@/components/admin/AdminExport";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { cn } from "@/lib/utils";

type View = "home" | "analytics" | "reviews" | "people" | "jobs" | "settings" | "disputes" | "broadcasts" | "notifications" | "reports" | "support" | "referrals" | "subscriptions" | "fraud" | "audit" | "health" | "export";

const SEEN_KEY_PREFIX = "admin_seen_";
const getSeenTimestamp = (section: string): string | null => localStorage.getItem(`${SEEN_KEY_PREFIX}${section}`);
const markSeen = (section: string) => localStorage.setItem(`${SEEN_KEY_PREFIX}${section}`, new Date().toISOString());

interface NavItem {
  id: View;
  label: string;
  icon: React.ElementType;
}

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { id: "home", label: "Dashboard", icon: Activity },
      { id: "analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Operations",
    items: [
      { id: "people", label: "Users", icon: Users },
      { id: "jobs", label: "Jobs", icon: Briefcase },
      { id: "fraud", label: "Fraud", icon: ShieldAlert },
      { id: "disputes", label: "Disputes", icon: ShieldAlert },
      { id: "reports", label: "Reports", icon: AlertTriangle },
      { id: "support", label: "Support", icon: Headphones },
    ],
  },
  {
    title: "Revenue",
    items: [
      { id: "subscriptions", label: "Subscriptions", icon: Crown },
      { id: "referrals", label: "Referrals", icon: Gift },
    ],
  },
  {
    title: "Engagement",
    items: [
      { id: "reviews", label: "Reviews", icon: ClipboardCheck },
      { id: "broadcasts", label: "Broadcasts", icon: Megaphone },
      { id: "notifications", label: "Notifications", icon: BellRing },
    ],
  },
  {
    title: "System",
    items: [
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const Admin = () => {
  const { loading } = useAdminAuth();
  usePageTitle("Admin — Helpr");
  const navigate = useNavigate();
  const [view, setView] = useState<View>("home");
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState({
    totalUsers: 0, pendingApprovals: 0, openReports: 0, supportTickets: 0,
    activeJobs: 0, completedJobs: 0, totalRevenue: 0, totalFees: 0,
    pendingReviews: 0, disputedJobs: 0, activeSubscriptions: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);
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
      if (lastSeen) query = query.gt(s.dateCol, lastSeen);
      if (s.filter) {
        for (const [col, val] of Object.entries(s.filter)) {
          if (val === "not_null") query = query.not(col, "is", null);
          else query = query.eq(col, val);
        }
      }
      if (s.notFilter) {
        for (const [col, val] of Object.entries(s.notFilter)) query = query.neq(col, val);
      }
      const { count } = await query;
      if (count && count > 0) counts[s.key] = count;
    }));
    setUnreadCounts(counts);
  }, []);

  const handleViewChange = useCallback((newView: View) => {
    if (newView !== "home") {
      markSeen(newView);
      setUnreadCounts(prev => { const next = { ...prev }; delete next[newView]; return next; });
    }
    setView(newView);
    setSidebarOpen(false);
  }, []);

  const loadStats = async () => {
    const [profilesRes, pendingRes, reportsRes, supportRes, activeRes, completedRes, disputesRes, reviewsRes, feesRes, subsRes] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").neq("reported_type", "support"),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").eq("reported_type", "support"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["open", "accepted", "in_progress"]),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "disputed" as any),
      supabase.from("reviews").select("id", { count: "exact", head: true }),
      supabase.from("jobs").select("budget, platform_fee_amount").eq("status", "completed"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).not("subscription_tier", "is", null),
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
      activeSubscriptions: subsRes.count || 0,
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
    if (view === "home" && !loading) { loadStats(); loadUnreadCounts(); }
  }, [view]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const getBadge = (id: View): number | undefined => {
    const uc = unreadCounts[id];
    if (uc && uc > 0) return uc;
    if (id === "people" && stats.pendingApprovals > 0) return stats.pendingApprovals;
    if (id === "disputes" && stats.disputedJobs > 0) return stats.disputedJobs;
    if (id === "reports" && stats.openReports > 0) return stats.openReports;
    if (id === "support" && stats.supportTickets > 0) return stats.supportTickets;
    return undefined;
  };

  const getBadgeColor = (id: View): string => {
    if (["disputes", "reports"].includes(id)) return "bg-destructive text-destructive-foreground";
    if (["people", "support"].includes(id)) return "bg-accent text-accent-foreground";
    return "bg-primary text-primary-foreground";
  };

  // Sidebar content (shared between desktop sidebar & mobile drawer)
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 pb-6 border-b border-border/50">
        <Link to="/dashboard" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-bold text-sm">H</span>
          </div>
          <div>
            <span className="text-base font-display font-bold text-foreground block leading-tight">Helpr</span>
            <span className="text-[10px] font-medium text-destructive uppercase tracking-wider">Admin</span>
          </div>
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-3 mb-2">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = view === item.id;
                const badge = getBadge(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleViewChange(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4 flex-shrink-0", isActive && "text-primary")} />
                    <span className="flex-1 text-left">{item.label}</span>
                    {badge !== undefined && (
                      <span className={cn(
                        "text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-bold px-1",
                        getBadgeColor(item.id)
                      )}>
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="p-3 border-t border-border/50 space-y-1">
        <button
          onClick={() => setShowLogoutDialog(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
        >
          <LogOut className="w-4 h-4" />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );

  const viewLabels: Record<View, string> = {
    home: "Dashboard", analytics: "Analytics", reviews: "Reviews", people: "Users",
    jobs: "Jobs", settings: "Settings", disputes: "Disputes", broadcasts: "Broadcasts",
    notifications: "Notifications", reports: "Reports", support: "Support",
    referrals: "Referrals", subscriptions: "Subscriptions",
  };

  const renderContent = () => {
    switch (view) {
      case "analytics": return <AdminAnalytics />;
      case "reviews": return <AdminReviews />;
      case "people": return <AdminUsers />;
      case "jobs": return <AdminJobs />;
      case "settings": return <AdminSettings />;
      case "disputes": return <AdminDisputes />;
      case "broadcasts": return <AdminBroadcasts />;
      case "notifications": return <AdminNotifications />;
      case "reports": return <AdminReports />;
      case "support": return <AdminSupport />;
      case "referrals": return <AdminReferrals />;
      case "subscriptions": return <AdminSubscriptions />;
      default: return <DashboardHome stats={stats} statsLoading={statsLoading} onNavigate={handleViewChange} />;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top nav bar with menu trigger */}
      <DashboardHeader title="Admin" onMenuClick={() => setSidebarOpen(true)} />




      <div className="flex flex-1">
        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
            {renderContent()}
          </main>
        </div>

        {/* Desktop sidebar — RIGHT side */}
        <aside className="hidden lg:flex w-60 border-l border-border/50 bg-card/50 flex-col flex-shrink-0 sticky top-[57px] h-[calc(100vh-57px)]">
          {sidebarContent}
        </aside>
      </div>

      {/* Mobile drawer overlay — slides from RIGHT */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute right-0 top-0 bottom-0 w-64 bg-card border-l border-border shadow-xl flex flex-col">
            <div className="absolute top-3 right-3">
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="h-8 w-8 rounded-lg">
                <X className="w-4 h-4" />
              </Button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Logout dialog */}
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to log out of your account?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { await supabase.auth.signOut(); navigate("/"); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/* ─── Dashboard Home ─── */

interface DashboardHomeProps {
  stats: {
    totalUsers: number; pendingApprovals: number; openReports: number;
    supportTickets: number; activeJobs: number; completedJobs: number;
    totalRevenue: number; totalFees: number; pendingReviews: number;
    disputedJobs: number; activeSubscriptions: number;
  };
  statsLoading: boolean;
  onNavigate: (v: View) => void;
}

const StatCard = ({ label, value, icon: Icon, trend, onClick }: {
  label: string; value: string | number; icon: React.ElementType; trend?: string; onClick?: () => void;
}) => (
  <button
    onClick={onClick}
    className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary/20 hover:shadow-sm transition-all group w-full"
  >
    <div className="flex items-center justify-between mb-3">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      {trend && (
        <span className="text-[11px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
          <TrendingUp className="w-3 h-3" /> {trend}
        </span>
      )}
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{label}</p>
  </button>
);

const AlertBanner = ({ label, count, color, onClick }: {
  label: string; count: number; color: "destructive" | "accent"; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all w-full",
      color === "destructive"
        ? "border-destructive/20 bg-destructive/5 hover:bg-destructive/10"
        : "border-accent/20 bg-accent/5 hover:bg-accent/10"
    )}
  >
    <span className={cn(
      "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold",
      color === "destructive" ? "bg-destructive/10 text-destructive" : "bg-accent/10 text-accent-foreground"
    )}>
      {count}
    </span>
    <span className="text-sm font-medium text-foreground flex-1">{label}</span>
    <span className="text-xs text-muted-foreground">View →</span>
  </button>
);

const DashboardHome = ({ stats, statsLoading, onNavigate }: DashboardHomeProps) => {
  const v = (val: number | string) => statsLoading ? "—" : val;
  const hasAlerts = stats.pendingApprovals > 0 || stats.disputedJobs > 0 || stats.openReports > 0 || stats.supportTickets > 0;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Greeting */}
      <div>
        <h2 className="text-2xl font-display font-bold text-foreground">Welcome back</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Here's what's happening on the platform today.</p>
      </div>

      {/* Attention needed */}
      {hasAlerts && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Needs attention</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {stats.pendingApprovals > 0 && (
              <AlertBanner label="Pending approvals" count={stats.pendingApprovals} color="accent" onClick={() => onNavigate("people")} />
            )}
            {stats.disputedJobs > 0 && (
              <AlertBanner label="Active disputes" count={stats.disputedJobs} color="destructive" onClick={() => onNavigate("disputes")} />
            )}
            {stats.openReports > 0 && (
              <AlertBanner label="Open reports" count={stats.openReports} color="destructive" onClick={() => onNavigate("reports")} />
            )}
            {stats.supportTickets > 0 && (
              <AlertBanner label="Support tickets" count={stats.supportTickets} color="accent" onClick={() => onNavigate("support")} />
            )}
          </div>
        </div>
      )}

      {/* Key metrics */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Key metrics</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Pending Accounts" value={v(stats.pendingApprovals)} icon={Users} onClick={() => onNavigate("people")} />
          <StatCard label="Active Subscriptions" value={v(stats.activeSubscriptions)} icon={Crown} onClick={() => onNavigate("subscriptions")} />
          <StatCard label="Open Reports" value={v(stats.openReports)} icon={AlertTriangle} onClick={() => onNavigate("reports")} />
          <StatCard label="Support Tickets" value={v(stats.supportTickets)} icon={Headphones} onClick={() => onNavigate("support")} />
          <StatCard label="Active Disputes" value={v(stats.disputedJobs)} icon={ShieldAlert} onClick={() => onNavigate("disputes")} />
          <StatCard label="Active Jobs" value={v(stats.activeJobs)} icon={Briefcase} onClick={() => onNavigate("jobs")} />
          
          <StatCard label="Platform Revenue" value={v(`$${stats.totalFees.toFixed(2)}`)} icon={DollarSign} onClick={() => onNavigate("analytics")} />
        </div>
      </div>
    </div>
  );
};

export default Admin;
