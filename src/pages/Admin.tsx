import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import {
  Users, Briefcase, Settings, BarChart3, ClipboardCheck,
  AlertTriangle, CheckCircle2, DollarSign, ShieldAlert, Megaphone,
  BellRing, Headphones, Gift, Crown, TrendingUp, TrendingDown, Activity,
  X, Banknote, MapPin, Award, ChevronRight, ShieldCheck,
  Shield, LogOut, Mail, Building2, Landmark, ClipboardList,
} from "lucide-react";
import BackButton from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { lazy, Suspense } from "react";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import AdminSidebar, { AdminNavItem } from "@/components/admin/AdminSidebar";
import AdminParishActivity from "@/components/admin/AdminParishActivity";
import NotificationPanel from "@/components/NotificationPanel";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import HelprMark from "@/components/HelprMark";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
const KpiSparkline = lazy(() => import("@/components/admin/KpiSparkline"));

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

const AdminPayoutBatches = lazy(() => import("@/components/admin/AdminPayoutBatches"));
const AdminParishTaxRates = lazy(() => import("@/components/admin/AdminParishTaxRates"));
const AdminHelperTiers = lazy(() => import("@/components/admin/AdminHelperTiers"));
const AdminIDVQueue = lazy(() => import("@/components/admin/AdminIDVQueue"));
const AdminNotificationLogs = lazy(() => import("@/components/admin/AdminNotificationLogs"));
const AdminMarketing = lazy(() => import("@/components/admin/AdminMarketing"));
const AdminCredentialQueue = lazy(() => import("@/components/admin/AdminCredentialQueue"));
const AdminBusinessVerificationQueue = lazy(() => import("@/components/admin/AdminBusinessVerificationQueue"));
const AdminBusinessAccounts = lazy(() => import("@/components/admin/AdminBusinessAccounts"));
const AdminExceptionQueue = lazy(() => import("@/components/admin/AdminExceptionQueue"));
const AdminPartnerApplications = lazy(() => import("@/components/admin/AdminPartnerApplications"));

type View = "home" | "analytics" | "people" | "jobs" | "settings" | "disputes" | "broadcasts" | "notifications" | "notiflogs" | "reports" | "support" | "referrals" | "subscriptions" | "fraud" | "audit" | "health" | "export" | "payouts" | "parishtax" | "tiers" | "idv" | "geography" | "marketing" | "credentials" | "business_verify" | "business_accounts" | "exceptions" | "partner_applications";

import { safeStorage } from "@/lib/safeStorage";

const SEEN_KEY_PREFIX = "admin_seen_";
const getSeenTimestamp = (section: string): string | null => safeStorage.getItem(`${SEEN_KEY_PREFIX}${section}`);
const markSeen = (section: string) => safeStorage.setItem(`${SEEN_KEY_PREFIX}${section}`, new Date().toISOString());

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
      { id: "credentials", label: "License & Insurance", icon: ShieldCheck },
      { id: "exceptions", label: "Exception Queue", icon: ClipboardList },
      { id: "business_verify", label: "Business Verification", icon: Building2 },
      { id: "business_accounts", label: "Business Accounts", icon: Building2 },
      { id: "partner_applications", label: "Partner Applications", icon: Users },
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
      { id: "tiers", label: "Helpr Tiers", icon: Award },
    ],
  },
  {
    title: "Engagement",
    items: [
      { id: "broadcasts", label: "Broadcasts", icon: Megaphone },
      { id: "notifications", label: "Notifications", icon: BellRing },
      { id: "notiflogs", label: "Notification Logs", icon: ClipboardCheck },
      { id: "marketing", label: "Marketing", icon: Mail },
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
  newUsersInRange: number; newUsersPrev: number;
  revenueInRange: number; revenuePrev: number;
  completedJobsInRange: number; completedJobsPrev: number;
  feesThisQuarter: number;
  // 10-point sparkline series, ranged by the selector. Newest at the end.
  newUsersSeries: number[];
  revenueSeries: number[];
  completedJobsSeries: number[];
  activeJobsSeries: number[];
}

type DateRange = "7d" | "30d" | "90d" | "custom";

interface RangeWindow {
  /** Range in days. Custom defaults to its current days. */
  days: number;
  label: string;
  prevLabel: string;
}

const RANGE_PRESETS: Record<Exclude<DateRange, "custom">, RangeWindow> = {
  "7d": { days: 7, label: "last 7d", prevLabel: "prior 7d" },
  "30d": { days: 30, label: "last 30d", prevLabel: "prior 30d" },
  "90d": { days: 90, label: "last 90d", prevLabel: "prior 90d" },
};

const Admin = () => {
  usePageTitle("Admin — Helpr");
  const navigate = useNavigate();
  // ?view= deep-links from notifications (e.g. /admin?view=people&user=<id>).
  // Notifications fanned out by triggers point here so admins land on the
  // right sub-view in one tap. ?user= is forwarded into AdminUsers so it
  // can openProfile() automatically.
  const [searchParams] = useSearchParams();
  const initialView = (searchParams.get("view") as View) || "home";
  const [view, setView] = useState<View>(initialView);
  const [notifLogsInitialSearch, setNotifLogsInitialSearch] = useState<string>("");
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0, pendingApprovals: 0, openReports: 0, supportTickets: 0,
    activeJobs: 0, completedJobs: 0, totalRevenue: 0, totalFees: 0,
    disputedJobs: 0, activeSubscriptions: 0, lateCancellationRevenue: 0,
    newUsersInRange: 0, newUsersPrev: 0, revenueInRange: 0, revenuePrev: 0,
    completedJobsInRange: 0, completedJobsPrev: 0,
    feesThisQuarter: 0,
    newUsersSeries: [], revenueSeries: [], completedJobsSeries: [], activeJobsSeries: [],
  });
  // Dashboard date-range selector (persisted across renders only — no need
  // for a localStorage key; the choice is ephemeral session UI).
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [customDays, setCustomDays] = useState<number>(14);
  const [statsLoading, setStatsLoading] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  // <AdminRoute> already gates this page on isAdmin; useCurrentUser here
  // supplies the shared loading flag (the redundant useAdminAuth redirect
  // hook has been removed).
  const { isLoading: loading } = useCurrentUser();

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

  const loadStats = async (windowDays: number) => {
    const now = new Date();
    const dStart = new Date(now.getTime() - windowDays * 86400000).toISOString();
    const dPrevStart = new Date(now.getTime() - 2 * windowDays * 86400000).toISOString();
    // Start of the current calendar quarter — used by the tax-reserve
    // tracker so the admin can see fee revenue accrued toward the next
    // estimated-tax payment.
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString();

    const [
      profilesRes, pendingRes, reportsRes, supportRes, activeRes, completedRes, disputesRes,
      paymentsRes, subsRes, lateCancelRes,
      newUsersInRangeRows, newUsersPrevRows,
      revInRangeRows, revPrevRows,
      completedInRangeRows, completedPrevRows,
      activeJobsInRangeRows,
      quarterRes,
    ] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approval_status", "pending").eq("email_verified", true),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").neq("reported_type", "support"),
      supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending").eq("reported_type", "support"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["open", "accepted", "in_progress"]),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "disputed"),
      supabase.from("jobs").select("budget, platform_fee_amount, customer_fee_amount").in("payment_status", ["escrow", "payout_pending", "released"]).neq("status", "cancelled"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).not("subscription_tier", "is", null),
      supabase.from("jobs").select("budget, platform_fee_amount, customer_fee_amount, cancellation_fee").eq("status", "cancelled").in("payment_status", ["refunded", "cancelled", "escrow", "payout_pending", "released"]),
      // New users by created_at — rows so we can bucket into a sparkline.
      supabase.from("profiles").select("created_at").gte("created_at", dStart),
      supabase.from("profiles").select("created_at").gte("created_at", dPrevStart).lt("created_at", dStart),
      // Revenue rows in current window
      supabase.from("jobs").select("platform_fee_amount, customer_fee_amount, updated_at")
        .in("payment_status", ["escrow", "payout_pending", "released"])
        .neq("status", "cancelled")
        .gte("updated_at", dStart),
      // Revenue rows in previous window
      supabase.from("jobs").select("platform_fee_amount, customer_fee_amount, updated_at")
        .in("payment_status", ["escrow", "payout_pending", "released"])
        .neq("status", "cancelled")
        .gte("updated_at", dPrevStart).lt("updated_at", dStart),
      // Completed jobs in current window
      supabase.from("jobs").select("updated_at").eq("status", "completed").gte("updated_at", dStart),
      // Completed jobs in previous window
      supabase.from("jobs").select("updated_at").eq("status", "completed").gte("updated_at", dPrevStart).lt("updated_at", dStart),
      // Active-job creation pulse for sparkline (created_at within window)
      supabase.from("jobs").select("created_at").in("status", ["open", "accepted", "in_progress"]).gte("created_at", dStart),
      // Platform-fee revenue accrued this calendar quarter — feeds the
      // tax-reserve tracker's "this quarter" figure.
      supabase.from("jobs").select("platform_fee_amount, customer_fee_amount, updated_at")
        .in("payment_status", ["escrow", "payout_pending", "released"])
        .neq("status", "cancelled")
        .gte("updated_at", quarterStart),
    ]);
    const paymentRows = paymentsRes.data || [];
    const cancelledPaidRows = lateCancelRes.data || [];
    const lateCancellationRevenue = cancelledPaidRows.filter((j: any) => j.cancellation_fee > 0).reduce((s, j) => {
      return s + (j.cancellation_fee || 0);
    }, 0);
    const sumFees = (rows: any[] | null) =>
      (rows || []).reduce((s, j) => s + (j.platform_fee_amount || 0) + (j.customer_fee_amount || 0), 0);

    // Build a 10-point sparkline series across the current window. Rows
    // outside the window or with no usable timestamp are silently
    // dropped — the bucket math is forgiving so a few bad rows don't
    // skew the chart.
    const bucket10 = (rows: { ts?: string | null }[] | undefined | null, valueFn?: (row: any) => number): number[] => {
      const buckets = Array(10).fill(0);
      if (!rows) return buckets;
      const nowMs = now.getTime();
      const startMs = nowMs - windowDays * 86400000;
      const span = windowDays * 86400000;
      for (const r of rows) {
        const ts = r.ts;
        if (!ts) continue;
        const t = new Date(ts).getTime();
        if (!Number.isFinite(t) || t < startMs || t > nowMs) continue;
        const idx = Math.min(9, Math.max(0, Math.floor(((t - startMs) / span) * 10)));
        buckets[idx] += valueFn ? valueFn(r) : 1;
      }
      return buckets;
    };

    const newUsersSeries = bucket10(
      (newUsersInRangeRows.data || []).map((r: any) => ({ ts: r.created_at })),
    );
    const revenueSeries = bucket10(
      (revInRangeRows.data || []).map((r: any) => ({
        ts: r.updated_at,
        platform_fee_amount: r.platform_fee_amount,
        customer_fee_amount: r.customer_fee_amount,
      })),
      (row) => (row.platform_fee_amount || 0) + (row.customer_fee_amount || 0),
    );
    const completedJobsSeries = bucket10(
      (completedInRangeRows.data || []).map((r: any) => ({ ts: r.updated_at })),
    );
    const activeJobsSeries = bucket10(
      (activeJobsInRangeRows.data || []).map((r: any) => ({ ts: r.created_at })),
    );

    setStats({
      totalUsers: profilesRes.count || 0,
      pendingApprovals: pendingRes.count || 0,
      openReports: reportsRes.count || 0,
      supportTickets: supportRes.count || 0,
      activeJobs: activeRes.count || 0,
      completedJobs: completedRes.count || 0,
      totalRevenue: paymentRows.reduce((s, j) => s + (j.budget || 0), 0),
      totalFees: paymentRows.reduce((s, j) => s + (j.platform_fee_amount || 0) + (j.customer_fee_amount || 0), 0),
      disputedJobs: disputesRes.count || 0,
      activeSubscriptions: subsRes.count || 0,
      lateCancellationRevenue,
      newUsersInRange: (newUsersInRangeRows.data || []).length,
      newUsersPrev: (newUsersPrevRows.data || []).length,
      revenueInRange: sumFees(revInRangeRows.data),
      revenuePrev: sumFees(revPrevRows.data),
      completedJobsInRange: (completedInRangeRows.data || []).length,
      completedJobsPrev: (completedPrevRows.data || []).length,
      feesThisQuarter: sumFees(quarterRes.data),
      newUsersSeries,
      revenueSeries,
      completedJobsSeries,
      activeJobsSeries,
    });
    setStatsLoading(false);
  };

  // Resolve the active window (in days) for the current selector.
  const activeWindowDays = dateRange === "custom" ? customDays : RANGE_PRESETS[dateRange].days;
  const activeRangeLabel = dateRange === "custom"
    ? `last ${customDays}d`
    : RANGE_PRESETS[dateRange].label;
  const activePrevLabel = dateRange === "custom"
    ? `prior ${customDays}d`
    : RANGE_PRESETS[dateRange].prevLabel;

  useEffect(() => {
    if (loading) return;
    loadStats(activeWindowDays);
    loadUnreadCounts();
    // Debounce realtime-triggered reloads — admin tables (jobs, profiles,
    // reports) can receive bursts of writes (e.g. a batch import or a job
    // lifecycle transition touching multiple rows). Without a debounce each
    // write fires a full stats reload; 500 ms collapses a burst into one.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { loadStats(activeWindowDays); loadUnreadCounts(); }, 500);
    };
    // Deliberately unfiltered: unlike user-facing channels (which MUST be
    // user-scoped per the realtime rule), the admin dashboard's whole job is
    // to reflect platform-wide activity, so it watches every write to these
    // tables. The debounce above keeps the resulting reload burst sane.
    const channel = supabase
      .channel(`admin-realtime-${channelNonce()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, debouncedReload)
      .subscribe();
    return () => { if (debounce) clearTimeout(debounce); supabase.removeChannel(channel); };
  }, [loading, activeWindowDays]);

  useEffect(() => {
    if (view === "home" && !loading) { loadStats(activeWindowDays); loadUnreadCounts(); }
  }, [view, activeWindowDays]);

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
      <div className="min-h-screen flex items-center justify-center bg-premium-page">
        <HelprSpinner size={36} />
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
    audit: "Audit Log", health: "Health", export: "Export",
    payouts: "Payout Batches", parishtax: "Parish Tax", tiers: "Helpr Tiers",
    idv: "Identity Verify", geography: "Geography", marketing: "Marketing",
    credentials: "License & Insurance",
    exceptions: "Exception Queue",
    business_verify: "Business Verification",
    business_accounts: "Business Accounts",
    partner_applications: "Partner Applications",
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
      case "payouts": return <AdminPayoutBatches />;
      case "parishtax": return <AdminParishTaxRates />;
      case "tiers": return <AdminHelperTiers />;
      case "idv": return <AdminIDVQueue />;
      case "credentials": return <AdminCredentialQueue />;
      case "exceptions": return <AdminExceptionQueue />;
      case "business_verify": return <AdminBusinessVerificationQueue />;
      case "business_accounts": return <AdminBusinessAccounts />;
      case "partner_applications": return <AdminPartnerApplications />;
      case "geography": return <AdminParishActivity />;
      case "marketing": return <AdminMarketing />;
      default: return (
        <DashboardHome
          stats={stats}
          statsLoading={statsLoading}
          onNavigate={handleViewChange}
          dateRange={dateRange}
          setDateRange={setDateRange}
          customDays={customDays}
          setCustomDays={setCustomDays}
          rangeLabel={activeRangeLabel}
          prevLabel={activePrevLabel}
        />
      );
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-premium-page">
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
                <HelprMark to="/dashboard" size="sm" />
              </div>
              <div className="flex items-center gap-1">
                {/* Admin badge — click to open/close sidebar */}
                <AdminBadgeToggle />

                <NotificationPanel />
                <Button variant="ghost" size="icon" onClick={() => setShowLogoutDialog(true)} className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-ds-md h-10 w-10" aria-label="Log out">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </header>

          <main
            className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]"
          >
            {view !== "home" && (
              <div className="mb-5 sm:mb-6 flex items-start gap-2">
                <BackButton onClick={() => handleViewChange("home")} />
                <div className="flex flex-col leading-none min-w-0">
                  <span
                    className="font-serif italic uppercase text-[0.62rem]"
                    style={{
                      color: "hsl(var(--burnt-sienna) / 0.78)",
                      letterSpacing: "0.18em",
                    }}
                  >
                    Operations
                  </span>
                  <h1
                    className="font-display italic font-bold leading-tight mt-1 truncate"
                    style={{
                      fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.85rem)",
                      color: "hsl(var(--ink-deep))",
                      letterSpacing: "-0.025em",
                    }}
                  >
                    {viewLabels[view]}
                  </h1>
                </div>
              </div>
            )}
            <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
              {renderContent()}
            </Suspense>
          </main>
        </div>

        <BrandConfirmDialog
          open={showLogoutDialog}
          onOpenChange={setShowLogoutDialog}
          title="See you soon?"
          description="You'll need to sign back in next time. Your posts and messages stay safe."
          primaryLabel="Log out"
          primaryTone="bark"
          primaryHaptic="medium"
          onPrimary={async () => { await supabase.auth.signOut(); navigate("/"); }}
          secondaryLabel="Stay logged in"
        />
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
      className="flex items-center gap-1.5 px-2 h-9 rounded-ds-md bg-destructive/10 text-destructive hover:bg-destructive/20 mr-1 btn-press"
    >
      <Shield className="w-3.5 h-3.5" />
      <span className="text-ds-11 font-bold uppercase tracking-wide">Admin</span>
    </button>
  );
};

/* ─── Dashboard Home ─── */

interface DashboardHomeProps {
  stats: Stats;
  statsLoading: boolean;
  onNavigate: (v: string) => void;
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  customDays: number;
  setCustomDays: (n: number) => void;
  rangeLabel: string;
  prevLabel: string;
}

const computeTrend = (current: number, previous: number): { pct: number; up: boolean } | null => {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { pct: 100, up: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct: Math.abs(pct), up: pct >= 0 };
};

const KpiCard = ({ label, value, icon: Icon, trend, accent, onClick, sparkline, compareLabel }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: { pct: number; up: boolean } | null;
  accent: "primary" | "accent" | "destructive";
  onClick?: () => void;
  sparkline?: number[];
  compareLabel?: string;
}) => {
  // Icon tint mirrors the metric color. Note: `accent` uses `text-accent`
  // (burnt sienna), NOT `text-accent-foreground` (which is white and was
  // rendering near-invisible on the light `bg-accent/10` tile).
  const accentClasses = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/15 text-accent",
    destructive: "bg-destructive/10 text-destructive",
  }[accent];

  return (
    <button
      onClick={onClick}
      className="rounded-ds-md liquid-glass p-3 sm:p-4 text-left hover:border-primary/30 hover:shadow-md transition-all group w-full"
    >
      <div className="flex items-center justify-between mb-1.5 sm:mb-2">
        <div className={cn("w-8 h-8 sm:w-9 sm:h-9 rounded-ds-sm flex items-center justify-center", accentClasses)}>
          <Icon className="w-4 h-4 sm:w-[1.125rem] sm:h-[1.125rem]" strokeWidth={2.25} />
        </div>
        {trend && (
          <span className={cn(
            "text-ds-10 sm:text-ds-11 font-semibold px-1.5 py-0.5 rounded-md flex items-center gap-0.5",
            trend.up ? "text-primary bg-primary/10" : "text-destructive bg-destructive/10"
          )}>
            {trend.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend.pct}%
          </span>
        )}
      </div>
      <p className="text-ds-17 sm:text-ds-20 font-bold text-foreground tabular-nums leading-tight">{value}</p>
      <p className="text-ds-11 text-muted-foreground mt-0.5 leading-tight">{label}</p>
      {trend && compareLabel && (
        <p className={cn(
          "text-ds-10 tabular-nums mt-0.5 leading-tight",
          trend.up ? "text-primary/80" : "text-destructive/80",
        )}>
          {trend.up ? "+" : "−"}{trend.pct}% {compareLabel}
        </p>
      )}
      {sparkline && sparkline.length > 0 && (
        <Suspense fallback={<div className="h-7 mt-2" aria-hidden />}>
          <KpiSparkline data={sparkline} tone={accent} />
        </Suspense>
      )}
    </button>
  );
};

const PriorityAlert = ({ label, count, color, onClick }: {
  label: string; count: number; color: "destructive" | "accent"; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-2.5 rounded-ds-md border p-2.5 sm:p-3.5 text-left transition-all w-full hover:shadow-sm",
      color === "destructive"
        ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
        : "border-accent/30 bg-accent/5 hover:bg-accent/10"
    )}
  >
    <span className={cn(
      "w-8 h-8 sm:w-9 sm:h-9 rounded-ds-sm flex items-center justify-center text-ds-11 sm:text-ds-13 font-bold tabular-nums shrink-0",
      color === "destructive" ? "bg-destructive/15 text-destructive" : "bg-accent/20 text-accent"
    )}>
      {count}
    </span>
    <span className="text-ds-11 sm:text-ds-13 font-semibold text-foreground flex-1 leading-tight">{label}</span>
    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
  </button>
);

// IRS estimated-tax quarterly due dates (standard schedule). Returns the
// next deadline after `now` so the admin always sees the upcoming one.
const nextEstimatedTaxDate = (now: Date): Date => {
  const y = now.getFullYear();
  const dates = [
    new Date(y, 3, 15),       // Apr 15 — Q1
    new Date(y, 5, 15),       // Jun 15 — Q2
    new Date(y, 8, 15),       // Sep 15 — Q3
    new Date(y + 1, 0, 15),   // Jan 15 next year — Q4
  ];
  return dates.find((d) => d > now) ?? dates[0];
};

const RESERVE_RATE_KEY = "helpr.admin.taxReserveRate";
const RESERVE_RATE_OPTIONS = [0.2, 0.25, 0.3, 0.35];

/**
 * Tax-reserve tracker — surfaces roughly how much of the platform-fee
 * revenue should be parked for income tax so the owner isn't surprised
 * by an April bill. It does NOT move money; it's a running "set aside
 * about $X" figure plus the next quarterly-estimate due date.
 *
 * The reserve is computed off GROSS platform fees (a deliberately
 * conservative basis — actual taxable profit is lower after Stripe
 * fees + hosting + other deductible expenses, so over-reserving is the
 * safe direction to err). The rate is admin-adjustable and persisted
 * to localStorage.
 */
const TaxReserveCard = ({
  totalFees,
  feesThisQuarter,
  statsLoading,
}: {
  totalFees: number;
  feesThisQuarter: number;
  statsLoading: boolean;
}) => {
  const [rate, setRate] = useState(0.3);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RESERVE_RATE_KEY);
      const parsed = stored ? parseFloat(stored) : NaN;
      if (RESERVE_RATE_OPTIONS.includes(parsed)) setRate(parsed);
    } catch {
      // private mode / quota — fall back to the 30% default
    }
  }, []);

  const setRatePersisted = (next: number) => {
    setRate(next);
    try { window.localStorage.setItem(RESERVE_RATE_KEY, String(next)); } catch { /* ignore */ }
  };

  const reserveAllTime = totalFees * rate;
  const reserveThisQuarter = feesThisQuarter * rate;
  const dueDate = nextEstimatedTaxDate(new Date());
  const dueLabel = dueDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const money = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <div
      className="rounded-ds-md liquid-glass p-4 sm:p-5 space-y-4"
      style={{
        backgroundImage:
          "radial-gradient(80% 90% at 100% 0%, hsl(var(--gold-warm) / 0.10) 0%, transparent 60%)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-ds-sm flex items-center justify-center bg-accent/10 text-accent shrink-0">
            <Landmark className="w-4 h-4 sm:w-5 sm:h-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display italic font-bold leading-tight" style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Tax reserve
            </p>
            <p className="text-ds-11 text-muted-foreground leading-tight">
              Set aside for income tax — not a payment
            </p>
          </div>
        </div>
        {/* Reserve-rate selector — conservative default 30%. */}
        <div className="flex items-center gap-1 shrink-0">
          {RESERVE_RATE_OPTIONS.map((opt) => {
            const active = opt === rate;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setRatePersisted(opt)}
                className={cn(
                  "px-1.5 h-6 rounded-md text-ds-10 font-semibold tabular-nums transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
              >
                {Math.round(opt * 100)}%
              </button>
            );
          })}
        </div>
      </div>

      {/* Big all-time reserve figure */}
      <div>
        <p className="text-ds-24 sm:text-[1.75rem] font-bold tabular-nums leading-none" style={{ color: "hsl(var(--ink-deep))" }}>
          {statsLoading ? "—" : money(reserveAllTime)}
        </p>
        <p className="text-ds-11 text-muted-foreground mt-1 leading-snug">
          {Math.round(rate * 100)}% of {statsLoading ? "—" : money(totalFees)} all-time platform fees.
          A conservative estimate on gross revenue — actual tax owed is lower after expenses.
        </p>
      </div>

      {/* This-quarter row + next due date */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/50">
        <div>
          <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">This quarter</p>
          <p className="text-ds-15 font-bold tabular-nums mt-0.5" style={{ color: "hsl(var(--ink-deep))" }}>
            {statsLoading ? "—" : money(reserveThisQuarter)}
          </p>
          <p className="text-ds-10 text-muted-foreground leading-tight">
            on {statsLoading ? "—" : money(feesThisQuarter)} in fees
          </p>
        </div>
        <div>
          <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">Next estimate due</p>
          <p className="text-ds-15 font-bold mt-0.5" style={{ color: "hsl(var(--ink-deep))" }}>
            {dueLabel}
          </p>
          <p className="text-ds-10 text-muted-foreground leading-tight">
            IRS quarterly estimated tax
          </p>
        </div>
      </div>

      <p className="text-ds-10 text-muted-foreground leading-snug italic">
        Park this in a separate account as you earn it and pay quarterly estimates — confirm the exact rate with your CPA.
      </p>
    </div>
  );
};

/* ─── Date range bar ─── */
const DateRangeBar = ({
  dateRange, setDateRange, customDays, setCustomDays,
}: {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  customDays: number;
  setCustomDays: (n: number) => void;
}) => {
  const options: { id: DateRange; label: string }[] = [
    { id: "7d", label: "7d" },
    { id: "30d", label: "30d" },
    { id: "90d", label: "90d" },
    { id: "custom", label: "Custom" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="inline-flex items-center rounded-ds-md bg-muted/60 p-0.5">
        {options.map((opt) => {
          const active = dateRange === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setDateRange(opt.id)}
              className={cn(
                "px-2.5 h-7 rounded-md text-ds-11 font-semibold transition-colors tabular-nums",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {dateRange === "custom" && (
        <div className="inline-flex items-center gap-2 rounded-ds-md bg-muted/60 px-2 h-7">
          <label htmlFor="custom-days" className="text-ds-11 text-muted-foreground">
            Days
          </label>
          <input
            id="custom-days"
            type="number"
            min={1}
            max={365}
            value={customDays}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n > 0 && n <= 365) setCustomDays(n);
            }}
            className="w-14 h-6 px-1.5 text-ds-11 font-semibold tabular-nums rounded-sm bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}
    </div>
  );
};

const DashboardHome = ({
  stats, statsLoading, onNavigate,
  dateRange, setDateRange, customDays, setCustomDays,
  rangeLabel, prevLabel,
}: DashboardHomeProps) => {
  const v = (val: number | string) => statsLoading ? "—" : val;
  const hasAlerts = stats.pendingApprovals > 0 || stats.disputedJobs > 0 || stats.openReports > 0 || stats.supportTickets > 0;
  const revenueTrend = computeTrend(stats.revenueInRange, stats.revenuePrev);
  const newUsersTrend = computeTrend(stats.newUsersInRange, stats.newUsersPrev);
  const completedTrend = computeTrend(stats.completedJobsInRange, stats.completedJobsPrev);
  const compareCopy = `vs ${prevLabel}`;

  return (
    <div className="space-y-4 sm:space-y-5 w-full">
      {/* Date range selector — top of the dashboard. Drives every
          range-sensitive tile (revenue, new users, completed jobs) and
          the sparklines under each. */}
      <DateRangeBar
        dateRange={dateRange}
        setDateRange={setDateRange}
        customDays={customDays}
        setCustomDays={setCustomDays}
      />

      {/* Greeting — editorial 3-line header on its own glass plate.
          Matches the dashboard / activity / messages top-box pattern. */}
      <div
        className="liquid-glass relative overflow-hidden px-5 py-4 sm:px-6 sm:py-5"
        style={{
          backgroundImage:
            "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
            "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04), " +
            "0 1px 2px hsl(var(--olivewood) / 0.05), " +
            "0 8px 18px -6px hsl(var(--olivewood) / 0.1), " +
            "0 18px 32px -10px hsl(var(--olivewood) / 0.12)",
        }}
      >
        <span
          className="font-serif italic uppercase text-[0.62rem] block"
          style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
        >
          Operations
        </span>
        <h1
          className="font-display italic font-bold leading-tight mt-1"
          style={{ fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.85rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
        >
          Welcome back
        </h1>
        <p className="font-serif italic mt-0.5 text-[0.78rem]" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          {hasAlerts ? "There are items needing attention today." : "Everything looks calm on the platform."}
        </p>
      </div>

      {/* KPI Summary cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">

        <KpiCard
          label={`New Users (${rangeLabel})`}
          value={v(stats.newUsersInRange.toLocaleString())}
          icon={Users}
          accent="accent"
          trend={newUsersTrend}
          compareLabel={compareCopy}
          sparkline={stats.newUsersSeries}
          onClick={() => onNavigate("people")}
        />
        <KpiCard
          label="Active Jobs"
          value={v(stats.activeJobs.toLocaleString())}
          icon={Briefcase}
          accent="primary"
          sparkline={stats.activeJobsSeries}
          onClick={() => onNavigate("jobs")}
        />
        <KpiCard
          label={`Revenue (${rangeLabel})`}
          value={v(`$${stats.revenueInRange.toFixed(0)}`)}
          icon={DollarSign}
          trend={revenueTrend}
          compareLabel={compareCopy}
          sparkline={stats.revenueSeries}
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
        <div className="space-y-2 sm:space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
            <p className="text-ds-10 sm:text-ds-11 font-semibold text-foreground uppercase tracking-widest">Priority Alerts</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5 sm:gap-3">
            {stats.pendingApprovals > 0 && (
              <PriorityAlert label="Pending helpr approvals" count={stats.pendingApprovals} color="accent" onClick={() => onNavigate("people")} />
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
      <div className="space-y-2 sm:space-y-3">
        <p className="text-ds-10 sm:text-ds-11 font-semibold text-muted-foreground uppercase tracking-widest">Financial Health</p>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          <KpiCard label="Captured Revenue (all-time)" value={v(`$${stats.totalRevenue.toFixed(2)}`)} icon={DollarSign} accent="primary" onClick={() => onNavigate("analytics")} />
          <KpiCard label="Platform Profit" value={v(`$${stats.totalFees.toFixed(2)}`)} icon={TrendingUp} accent="primary" onClick={() => onNavigate("analytics")} />
          <KpiCard label="Active Subscriptions" value={v(stats.activeSubscriptions)} icon={Crown} accent="accent" onClick={() => onNavigate("subscriptions")} />
          <KpiCard
            label={`Completed Jobs (${rangeLabel})`}
            value={v(stats.completedJobsInRange)}
            icon={CheckCircle2}
            accent="primary"
            trend={completedTrend}
            compareLabel={compareCopy}
            sparkline={stats.completedJobsSeries}
            onClick={() => onNavigate("analytics")}
          />
          {stats.lateCancellationRevenue > 0 && (
            <KpiCard label="Late Cancel Revenue" value={v(`$${stats.lateCancellationRevenue.toFixed(2)}`)} icon={X} accent="destructive" onClick={() => onNavigate("analytics")} />
          )}
        </div>
      </div>

      {/* Tax obligations — running reserve estimate so the platform-fee
          income tax never lands as an April surprise. */}
      <div className="space-y-2 sm:space-y-3">
        <p className="text-ds-10 sm:text-ds-11 font-semibold text-muted-foreground uppercase tracking-widest">Tax Obligations</p>
        <TaxReserveCard
          totalFees={stats.totalFees}
          feesThisQuarter={stats.feesThisQuarter}
          statsLoading={statsLoading}
        />
      </div>
    </div>
  );
};

export default Admin;
