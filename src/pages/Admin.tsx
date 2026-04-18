import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Users, Briefcase, Settings, BarChart3, ClipboardCheck,
  AlertTriangle, CheckCircle2, DollarSign, ShieldAlert, Megaphone,
  BellRing, Headphones, Gift, Crown, TrendingUp, TrendingDown, Activity,
  X, Banknote, MapPin, Award, ChevronRight, Menu, ShieldCheck,
  Shield, MessageSquare, LogOut, ArrowLeft,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lazy, Suspense } from "react";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import AdminSidebar, { AdminNavItem } from "@/components/admin/AdminSidebar";
import AdminParishActivity from "@/components/admin/AdminParishActivity";
import NotificationPanel from "@/components/NotificationPanel";
import ThemeToggle from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";

const AdminUsers = lazy(() => import("@/components/admin/AdminUsers"));
const AdminJobs = lazy(() => import("@/components/admin/AdminJobs"));
const AdminSettings = lazy(() => import("@/components/admin/AdminSettings"));
const AdminAnalytics = lazy(() => import("@/components/admin/AdminAnalytics"));
const AdminDisputes = lazy(() => import("@/components/admin/AdminDisputes"));
const AdminBroadcasts = lazy(() => import("@/components/admin/AdminBroadcasts"));
const AdminNotifications = lazy(() => import("@/components/admin/AdminNotifications"));
const AdminReports = lazy(() => import("@/components/admin/AdminReports"));
const AdminSupport = lazy(() => import("@/components/admin/AdminSupport"));
const AdminReferrals = lazy(() => import("@/components/admin/AdminReferrals"));
const AdminSubscriptions = lazy(() => import("@/components/admin/AdminSubscriptions"));
const AdminFraudDashboard = lazy(() => import("@/components/admin/AdminFraudDashboard"));
const AdminAuditLog = lazy(() => import("@/components/admin/AdminAuditLog"));
const AdminHealth = lazy(() => import("@/components/admin/AdminHealth"));
const AdminExport = lazy(() => import("@/components/admin/AdminExport"));
const AdminSocialPost = lazy(() => import("@/components/admin/AdminSocialPost"));
const AdminPayoutBatches = lazy(() => import("@/components/admin/AdminPayoutBatches"));
const AdminParishTaxRates = lazy(() => import("@/components/admin/AdminParishTaxRates"));
const AdminHelperTiers = lazy(() => import("@/components/admin/AdminHelperTiers"));
const AdminIDVQueue = lazy(() => import("@/components/admin/AdminIDVQueue"));
const AdminNotificationLogs = lazy(() => import("@/components/admin/AdminNotificationLogs"));

type View = "home" | "analytics" | "people" | "jobs" | "settings" | "disputes" | "broadcasts" | "notifications" | "notiflogs" | "reports" | "support" | "referrals" | "subscriptions" | "fraud" | "audit" | "health" | "export" | "social" | "payouts" | "parishtax" | "tiers" | "idv" | "geography";

const SEEN_KEY_PREFIX = "admin_seen_";
const getSeenTimestamp = (section: string): string | null => localStorage.getItem(`${SEEN_KEY_PREFIX}${section}`);
const markSeen = (section: string) => localStorage.setItem(`${SEEN_KEY_PREFIX}${section}`, new Date().toISOString());

const navGroups: { title: string; items: AdminNavItem[] }[] = [
  {
    title: "Overview",
    items: [{ id: "analytics", label: "Analytics", icon: BarChart3 }],
  },
  {
    title: "Operations",
    items: [
      { id: "people", label: "Users", icon: Users },
      { id: "idv", label: "Identity Verify", icon: ShieldCheck },
      { id: "jobs", label: "Jobs", icon: Briefcase },
      { id: "geography", label: "Geography", icon: MapPin },
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
      { id: "payouts", label: "Payout Batches", icon: Banknote },
      { id: "parishtax", label: "Parish Tax", icon: MapPin },
      { id: "tiers", label: "Helper Tiers", icon: Award },
    ],
  },
  {
    title: "Engagement",
    items: [
      { id: "broadcasts", label: "Broadcasts", icon: Megaphone },
      { id: "notifications", label: "Notifications", icon: BellRing },
      { id: "notiflogs", label: "Notification Logs", icon: ClipboardCheck },
      { id: "social", label: "Social Post", icon: TrendingUp },
    ],
  },
  {
    title: "System",
    items: [
      { id: "settings", label: "Settings", icon: Settings },
      { id: "audit", label: "Audit Log", icon: ClipboardCheck },
      { id: "health", label: "Health", icon: Activity },
      { id: "export", label: "Export", icon: DollarSign },
    ],
  },
];

interface Stats {
  totalUsers: number; pendingApprovals: number; openReports: number;
  supportTickets: number; activeJobs: number; completedJobs: number;
  totalRevenue: number; totalFees: number;
  disputedJobs: number; activeSubscriptions: number;
  lateCancellationRevenue: number;
  newUsers7d: number; newUsersPrev7d: number;
  revenue30d: number; revenuePrev30d: number;
}

const Admin = () => {
  const { loading } = useAdminAuth();
  usePageTitle("Admin — Helpr");
  const navigate = useNavigate();
  const [view, setView] = useState<View>("home");
  const [notifLogsInitialSearch, setNotifLogsInitialSearch] = useState<string>("");
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0, pendingApprovals: 0, openReports: 0, supportTickets: 0,
    activeJobs: 0, completedJobs: 0, totalRevenue: 0, totalFees: 0,
    disputedJobs: 0, activeSubscriptions: 0, lateCancellationRevenue: 0,
    newUsers7d: 0, newUsersPrev7d: 0, revenue30d: 0, revenuePrev30d: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [unreadMessages, setUnreadMessages] = useState(0);
  const { user } = useCurrentUser();

  useEffect(() => {
    if (!user) return;
    const loadUnread = () => {
      supabase.from("messages").select("*", { count: "exact", head: true })
        .eq("receiver_id", user.id).eq("read", false)
        .then(({ count }) => setUnreadMessages(count || 0));
    };
    loadUnread();
    const channel = supabase.channel(`admin-header-unread-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` }, () => loadUnread())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const loadUnreadCounts = useCallback(async () => {
    const sections: { key: View; table: string; dateCol: string; filter?: Record<string, any>; notFilter?: Record<string, any> }[] = [
      // Only flag pending users who have verified their email — matches the
      // "Pending Review" rule in AdminUsers (Stripe-flagged or unprocessed,
      // but always email-verified first).
      { key: "people", table: "profiles", dateCol: "created_at", filter: { approval_status: "pending", email_verified: true } },
      { key: "jobs", table: "jobs", dateCol: "created_at" },
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

  const handleViewChange = useCallback((newView: string) => {
    const v = newView as View;
    if (v !== "home") {
      markSeen(v);
      setUnreadCounts(prev => { const next = { ...prev }; delete next[v]; return next; });
    }
    setView(v);
  }, []);

  const loadStats = async () => {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 86400000).toISOString();
    const d14 = new Date(now.getTime() - 14 * 86400000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
    const d60 = new Date(now.getTime() - 60 * 86400000).toISOString();

    const [
      profilesRes, pendingRes, reportsRes, supportRes, activeRes, completedRes, disputesRes,
      paymentsRes, subsRes, lateCancelRes,
      newUsers7Res, newUsersPrev7Res, rev30Res, revPrev30Res,
    ] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approval_status", "pending").eq("email_verified", true),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").neq("reported_type", "support"),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").eq("reported_type", "support"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["open", "accepted", "in_progress"]),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "disputed" as any),
      supabase.from("jobs").select("budget, platform_fee_amount, customer_fee_amount").in("payment_status", ["escrow", "payout_pending", "released"]).neq("status", "cancelled" as any),
      supabase.from("profiles").select("id", { count: "exact", head: true }).not("subscription_tier", "is", null),
      supabase.from("jobs").select("budget, platform_fee_amount, customer_fee_amount, cancellation_fee").eq("status", "cancelled" as any).in("payment_status", ["refunded", "cancelled", "escrow", "payout_pending", "released"]),
      // New users in last 7 days
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", d7),
      // New users in previous 7-day window (7-14 days ago)
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", d14).lt("created_at", d7),
      // Revenue from completed payments in last 30 days
      supabase.from("jobs").select("platform_fee_amount, customer_fee_amount, updated_at")
        .in("payment_status", ["escrow", "payout_pending", "released"])
        .neq("status", "cancelled" as any)
        .gte("updated_at", d30),
      // Revenue from previous 30-day window (30-60 days ago)
      supabase.from("jobs").select("platform_fee_amount, customer_fee_amount, updated_at")
        .in("payment_status", ["escrow", "payout_pending", "released"])
        .neq("status", "cancelled" as any)
        .gte("updated_at", d60).lt("updated_at", d30),
    ]);
    const paymentRows = paymentsRes.data || [];
    const cancelledPaidRows = lateCancelRes.data || [];
    const lateCancellationRevenue = cancelledPaidRows.filter((j: any) => j.cancellation_fee > 0).reduce((s, j) => {
      return s + ((j as any).cancellation_fee || 0);
    }, 0);
    const sumFees = (rows: any[] | null) =>
      (rows || []).reduce((s, j) => s + ((j as any).platform_fee_amount || 0) + ((j as any).customer_fee_amount || 0), 0);

    setStats({
      totalUsers: profilesRes.count || 0,
      pendingApprovals: pendingRes.count || 0,
      openReports: reportsRes.count || 0,
      supportTickets: supportRes.count || 0,
      activeJobs: activeRes.count || 0,
      completedJobs: completedRes.count || 0,
      totalRevenue: paymentRows.reduce((s, j) => s + (j.budget || 0), 0),
      totalFees: paymentRows.reduce((s, j) => s + ((j as any).platform_fee_amount || 0) + ((j as any).customer_fee_amount || 0), 0),
      disputedJobs: disputesRes.count || 0,
      activeSubscriptions: subsRes.count || 0,
      lateCancellationRevenue,
      newUsers7d: newUsers7Res.count || 0,
      newUsersPrev7d: newUsersPrev7Res.count || 0,
      revenue30d: sumFees(rev30Res.data),
      revenuePrev30d: sumFees(revPrev30Res.data),
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loading]);

  useEffect(() => {
    if (view === "home" && !loading) { loadStats(); loadUnreadCounts(); }
  }, [view]);

  // Listen for "View History" requests from AdminUsers
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const search = detail.email || detail.userId || "";
      setNotifLogsInitialSearch(search);
      handleViewChange("notiflogs");
    };
    window.addEventListener("admin:view-user-history", handler as EventListener);
    return () => window.removeEventListener("admin:view-user-history", handler as EventListener);
  }, [handleViewChange]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const getBadge = (id: string): number | undefined => {
    const uc = unreadCounts[id];
    if (uc && uc > 0) return uc;
    if (id === "people" && stats.pendingApprovals > 0) return stats.pendingApprovals;
    if (id === "disputes" && stats.disputedJobs > 0) return stats.disputedJobs;
    if (id === "reports" && stats.openReports > 0) return stats.openReports;
    if (id === "support" && stats.supportTickets > 0) return stats.supportTickets;
    return undefined;
  };

  const getBadgeColor = (id: string): string => {
    if (["disputes", "reports"].includes(id)) return "bg-destructive text-destructive-foreground";
    if (["people", "support"].includes(id)) return "bg-accent text-accent-foreground";
    return "bg-primary text-primary-foreground";
  };

  const viewLabels: Record<View, string> = {
    home: "Dashboard", analytics: "Analytics", people: "Users",
    jobs: "Jobs", settings: "Settings", disputes: "Disputes", broadcasts: "Broadcasts",
    notifications: "Notifications", notiflogs: "Notification Logs",
    reports: "Reports", support: "Support",
    referrals: "Referrals", subscriptions: "Subscriptions", fraud: "Fraud",
    audit: "Audit Log", health: "Health", export: "Export", social: "Social Post",
    payouts: "Payout Batches", parishtax: "Parish Tax", tiers: "Helper Tiers",
    idv: "Identity Verify", geography: "Geography",
  };

  const renderContent = () => {
    switch (view) {
      case "analytics": return <AdminAnalytics />;
      case "people": return <AdminUsers />;
      case "jobs": return <AdminJobs />;
      case "settings": return <AdminSettings />;
      case "disputes": return <AdminDisputes />;
      case "broadcasts": return <AdminBroadcasts />;
      case "notifications": return <AdminNotifications />;
      case "notiflogs": return <AdminNotificationLogs initialSearch={notifLogsInitialSearch} />;
      case "reports": return <AdminReports />;
      case "support": return <AdminSupport />;
      case "referrals": return <AdminReferrals />;
      case "subscriptions": return <AdminSubscriptions />;
      case "fraud": return <AdminFraudDashboard />;
      case "audit": return <AdminAuditLog />;
      case "health": return <AdminHealth />;
      case "export": return <AdminExport />;
      case "social": return <AdminSocialPost />;
      case "payouts": return <AdminPayoutBatches />;
      case "parishtax": return <AdminParishTaxRates />;
      case "tiers": return <AdminHelperTiers />;
      case "idv": return <AdminIDVQueue />;
      case "geography": return <AdminParishActivity />;
      default: return <DashboardHome stats={stats} statsLoading={statsLoading} onNavigate={handleViewChange} />;
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AdminSidebar
          navGroups={navGroups}
          activeView={view}
          onSelect={handleViewChange}
          getBadge={getBadge}
          getBadgeColor={getBadgeColor}
          onLogout={() => setShowLogoutDialog(true)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar — matches user-facing DashboardHeader */}
          <header className="sticky top-0 z-40 glass border-b border-border/30" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="container mx-auto flex items-center justify-between h-14 px-4">
              <div className="flex items-center gap-2 min-w-0">
                <Link to="/dashboard" className="flex items-center gap-2 group" aria-label="Go to Helpr">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md transition-transform duration-200 group-hover:scale-105">
                    <span className="text-primary-foreground font-bold text-sm">H</span>
                  </div>
                  <span className="text-lg font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                    Helpr
                  </span>
                </Link>
              </div>
              <div className="flex items-center gap-1">
                {/* Admin badge — click to open/close sidebar */}
                <AdminBadgeToggle />


                <ThemeToggle />
                <NotificationPanel />
                <Button variant="ghost" size="icon" onClick={() => setShowLogoutDialog(true)} className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-xl h-9 w-9" aria-label="Log out">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 p-3 md:p-6 lg:p-8 overflow-auto">
            {view !== "home" && (
              <div className="mb-4 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleViewChange("home")}
                  className="h-9 w-9 rounded-xl -ml-2 hover:bg-muted"
                  aria-label="Back to admin dashboard"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <h1 className="text-xl font-display font-bold text-foreground truncate">
                  {viewLabels[view]}
                </h1>
              </div>
            )}
            <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
              {renderContent()}
            </Suspense>
          </main>
        </div>

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
    </SidebarProvider>
  );
};

/* ─── Admin badge that toggles the sidebar ─── */
const AdminBadgeToggle = () => {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label="Toggle admin menu"
      className="flex items-center gap-1.5 px-2 h-9 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 mr-1 btn-press"
    >
      <Shield className="w-3.5 h-3.5" />
      <span className="text-[11px] font-bold uppercase tracking-wide">Admin</span>
    </button>
  );
};

/* ─── Dashboard Home ─── */

interface DashboardHomeProps {
  stats: Stats;
  statsLoading: boolean;
  onNavigate: (v: string) => void;
}

const computeTrend = (current: number, previous: number): { pct: number; up: boolean } | null => {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { pct: 100, up: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct: Math.abs(pct), up: pct >= 0 };
};

const KpiCard = ({ label, value, icon: Icon, trend, accent, onClick }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: { pct: number; up: boolean } | null;
  accent: "primary" | "accent" | "destructive";
  onClick?: () => void;
}) => {
  const accentClasses = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent-foreground",
    destructive: "bg-destructive/10 text-destructive",
  }[accent];

  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-border bg-card p-2.5 sm:p-5 text-left hover:border-primary/30 hover:shadow-md transition-all group w-full"
    >
      <div className="flex items-center justify-between mb-1.5 sm:mb-3">
        <div className={cn("w-7 h-7 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center", accentClasses)}>
          <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </div>
        {trend && (
          <span className={cn(
            "text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded-md flex items-center gap-0.5",
            trend.up ? "text-primary bg-primary/10" : "text-destructive bg-destructive/10"
          )}>
            {trend.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend.pct}%
          </span>
        )}
      </div>
      <p className="text-lg sm:text-2xl font-bold text-foreground tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 leading-tight">{label}</p>
    </button>
  );
};

const PriorityAlert = ({ label, count, color, onClick }: {
  label: string; count: number; color: "destructive" | "accent"; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-2.5 rounded-xl border p-2.5 sm:p-3.5 text-left transition-all w-full hover:shadow-sm",
      color === "destructive"
        ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
        : "border-accent/30 bg-accent/5 hover:bg-accent/10"
    )}
  >
    <span className={cn(
      "w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold tabular-nums shrink-0",
      color === "destructive" ? "bg-destructive/15 text-destructive" : "bg-accent/15 text-accent-foreground"
    )}>
      {count}
    </span>
    <span className="text-xs sm:text-sm font-semibold text-foreground flex-1 leading-tight">{label}</span>
    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
  </button>
);

const DashboardHome = ({ stats, statsLoading, onNavigate }: DashboardHomeProps) => {
  const v = (val: number | string) => statsLoading ? "—" : val;
  const hasAlerts = stats.pendingApprovals > 0 || stats.disputedJobs > 0 || stats.openReports > 0 || stats.supportTickets > 0;
  const userTrend = computeTrend(stats.newUsers7d, stats.newUsersPrev7d);
  const revenueTrend = computeTrend(stats.revenue30d, stats.revenuePrev30d);

  return (
    <div className="space-y-3 sm:space-y-6 max-w-7xl">
      {/* Greeting — desktop only, mobile saves space */}
      <div className="hidden sm:block">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-display font-bold text-foreground">Welcome back</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">Here's what's happening on the platform today.</p>
      </div>

      {/* KPI Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <KpiCard
          label="Total Users"
          value={v(stats.totalUsers.toLocaleString())}
          icon={Users}
          trend={userTrend}
          accent="primary"
          onClick={() => onNavigate("people")}
        />
        <KpiCard
          label="Active Jobs"
          value={v(stats.activeJobs.toLocaleString())}
          icon={Briefcase}
          accent="primary"
          onClick={() => onNavigate("jobs")}
        />
        <KpiCard
          label="Revenue (30d)"
          value={v(`$${stats.revenue30d.toFixed(0)}`)}
          icon={DollarSign}
          trend={revenueTrend}
          accent="accent"
          onClick={() => onNavigate("analytics")}
        />
        <KpiCard
          label="Pending Disputes"
          value={v(stats.disputedJobs)}
          icon={ShieldAlert}
          accent="destructive"
          onClick={() => onNavigate("disputes")}
        />
      </div>

      {/* Priority alerts */}
      {hasAlerts && (
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent-foreground" />
            <p className="text-[10px] sm:text-xs font-semibold text-foreground uppercase tracking-widest">Priority Alerts</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {stats.pendingApprovals > 0 && (
              <PriorityAlert label="Pending helper approvals" count={stats.pendingApprovals} color="accent" onClick={() => onNavigate("people")} />
            )}
            {stats.disputedJobs > 0 && (
              <PriorityAlert label="Active disputes" count={stats.disputedJobs} color="destructive" onClick={() => onNavigate("disputes")} />
            )}
            {stats.openReports > 0 && (
              <PriorityAlert label="Open reports" count={stats.openReports} color="destructive" onClick={() => onNavigate("reports")} />
            )}
            {stats.supportTickets > 0 && (
              <PriorityAlert label="Support tickets" count={stats.supportTickets} color="accent" onClick={() => onNavigate("support")} />
            )}
          </div>
        </div>
      )}

      {/* Financial Health — full width */}
      <div className="space-y-1.5 sm:space-y-2">
        <p className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-widest">Financial Health</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <KpiCard label="Captured Revenue (all-time)" value={v(`$${stats.totalRevenue.toFixed(2)}`)} icon={DollarSign} accent="primary" onClick={() => onNavigate("analytics")} />
          <KpiCard label="Platform Profit" value={v(`$${stats.totalFees.toFixed(2)}`)} icon={TrendingUp} accent="primary" onClick={() => onNavigate("analytics")} />
          <KpiCard label="Active Subscriptions" value={v(stats.activeSubscriptions)} icon={Crown} accent="accent" onClick={() => onNavigate("subscriptions")} />
          <KpiCard label="Completed Jobs" value={v(stats.completedJobs)} icon={CheckCircle2} accent="primary" onClick={() => onNavigate("analytics")} />
          {stats.lateCancellationRevenue > 0 && (
            <KpiCard label="Late Cancel Revenue" value={v(`$${stats.lateCancellationRevenue.toFixed(2)}`)} icon={X} accent="destructive" onClick={() => onNavigate("analytics")} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
