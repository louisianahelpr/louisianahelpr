import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";
import {
  Users, Briefcase, Settings, BarChart3, ClipboardCheck,
  AlertTriangle, DollarSign, ShieldAlert, Megaphone,
  BellRing, Headphones, Gift, Crown, Activity,
  Banknote, MapPin, Award, ShieldCheck,
  Mail, Building2, ClipboardList,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { channelNonce } from "@/lib/realtimeChannel";
import { lazy, Suspense } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import AdminSidebar, { AdminNavItem } from "@/components/admin/AdminSidebar";
import AdminTopBar from "@/components/admin/AdminTopBar";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import { DashboardHome } from "@/components/admin/dashboard/DashboardHome";
import type { Stats, DateRange } from "@/components/admin/dashboard/types";
import { RANGE_PRESETS } from "@/components/admin/dashboard/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { report } from "@/lib/errorLogger";

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
const AdminHelperTiers = lazy(() => import("@/components/admin/AdminHelperTiers"));
const AdminIDVQueue = lazy(() => import("@/components/admin/AdminIDVQueue"));
const AdminNotificationLogs = lazy(() => import("@/components/admin/AdminNotificationLogs"));
const AdminMarketing = lazy(() => import("@/components/admin/AdminMarketing"));
const AdminCredentialQueue = lazy(() => import("@/components/admin/AdminCredentialQueue"));
const AdminBusinessVerificationQueue = lazy(() => import("@/components/admin/AdminBusinessVerificationQueue"));
const AdminBusinessAccounts = lazy(() => import("@/components/admin/AdminBusinessAccounts"));
const AdminExceptionQueue = lazy(() => import("@/components/admin/AdminExceptionQueue"));

type View = "home" | "analytics" | "people" | "jobs" | "settings" | "disputes" | "broadcasts" | "notifications" | "notiflogs" | "reports" | "support" | "referrals" | "subscriptions" | "fraud" | "audit" | "health" | "export" | "payouts" | "tiers" | "idv" | "marketing" | "credentials" | "business_verify" | "business_accounts" | "exceptions";

import { safeStorage } from "@/lib/safeStorage";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

const SEEN_KEY_PREFIX = "admin_seen_";
const getSeenTimestamp = (section: string): string | null => safeStorage.getItem(`${SEEN_KEY_PREFIX}${section}`);
const markSeen = (section: string) => safeStorage.setItem(`${SEEN_KEY_PREFIX}${section}`, new Date().toISOString());


const navGroups = adminNavGroups;

/** Every view /admin actually renders, and its title. Also the source of
 *  truth for "is this a real view?" — see `isRealView` below, which is what
 *  makes a deep link to a DELETED view (parishtax, geography) land on home
 *  rather than stacking an empty <h1> on the dashboard. */
const VIEW_LABELS: Record<View, string> = {
    home: "Dashboard", analytics: "Analytics", people: "Users",
    jobs: "Jobs", settings: "Settings", disputes: "Disputes", broadcasts: "Broadcasts",
    notifications: "Notifications", notiflogs: "Notification Logs",
    reports: "Reports", support: "Support",
    referrals: "Referrals", subscriptions: "Subscriptions", fraud: "Fraud",
    audit: "Audit Log", health: "Health", export: "Export",
    payouts: "Payout Batches", tiers: "Helpr Tiers",
    idv: "Identity Verify", marketing: "Marketing",
    credentials: "License & Insurance",
    exceptions: "Exception Queue",
    // Unreachable while BUSINESS_ENABLED is false — the nav rows are not
    // rendered and `?view=business_*` is coerced to "home" — but kept so the
    // map stays exhaustive over `View`.
    business_verify: "Business Verification",
    business_accounts: "Business Accounts",
  };

const Admin = () => {
  usePageTitle("Admin — Helpr");
  // Which chrome this page owns — see the two render sites below.
  const isWebDesktop = useIsWebDesktop();
  const navigate = useNavigate();
  // ?view= deep-links from notifications (e.g. /admin?view=people&user=<id>).
  // Notifications fanned out by triggers point here so admins land on the
  // right sub-view in one tap. ?user= is forwarded into AdminUsers so it
  // can openProfile() automatically.
  const [searchParams] = useSearchParams();
  const rawInitialView = (searchParams.get("view") as View) || "home";
  // A stale `?view=business_verify` / `?view=business_accounts` deep-link — from
  // an old admin notification or a bookmark — must not reopen a Business screen
  // while the product is hidden. Coerced to the dashboard home instead, which
  // is also what makes the two `renderContent` cases below unreachable.
  //
  // The SAME coercion has to cover any view that no longer exists. Parish Tax
  // and Geography were deleted at the owner's request, and a `?view=parishtax`
  // link (a bookmark, an old notification, the UI sweep) then rendered the
  // dashboard home WITH an AdminSectionHeader whose title was `undefined` —
  // an empty <h1> stacked on the home screen's own, which the sweep caught as
  // "expected exactly 1 <h1>, found 2 [ | Welcome back]".
  //
  // So the guard is now "is this a view we actually render?" rather than a
  // hardcoded pair, and a stale link lands cleanly on home instead of a
  // half-rendered screen. `viewLabels` is the list of real views, which makes
  // this self-maintaining: delete a view, its label goes with it, and its old
  // deep links coerce automatically.
  const isRealView = (v: string): v is View =>
    v === "home" || Object.prototype.hasOwnProperty.call(VIEW_LABELS, v);
  const initialView: View =
    !isRealView(rawInitialView) ||
    (!BUSINESS_ENABLED && (rawInitialView === "business_verify" || rawInitialView === "business_accounts"))
      ? "home"
      : rawInitialView;
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
  const [statsLoadError, setStatsLoadError] = useState(false);
  const [unreadCountsError, setUnreadCountsError] = useState(false);
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
    let hadError = false;
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
      const { count, error } = await query;
      if (error) {
        hadError = true;
        report(error, { tags: { source: `Admin.loadUnreadCounts.${s.key}` } });
        return;
      }
      if (count && count > 0) counts[s.key] = count;
    }));
    setUnreadCounts(counts);
    setUnreadCountsError(hadError);
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

    // Surface any failed query instead of silently rendering a misleading
    // "0" / healthy-looking fallback — a single bad query among the 18
    // above must not be indistinguishable from a genuinely healthy
    // platform. The other, successful queries still render normally.
    const namedResults: [string, { error: any }][] = [
      ["profiles", profilesRes], ["pending", pendingRes], ["reports", reportsRes], ["support", supportRes],
      ["active", activeRes], ["completed", completedRes], ["disputes", disputesRes],
      ["payments", paymentsRes], ["subs", subsRes], ["lateCancel", lateCancelRes],
      ["newUsersInRange", newUsersInRangeRows], ["newUsersPrev", newUsersPrevRows],
      ["revInRange", revInRangeRows], ["revPrev", revPrevRows],
      ["completedInRange", completedInRangeRows], ["completedPrev", completedPrevRows],
      ["activeJobsInRange", activeJobsInRangeRows], ["quarter", quarterRes],
    ];
    const failed = namedResults.filter(([, res]) => res.error);
    if (failed.length > 0) {
      for (const [name, res] of failed) {
        report(res.error, { tags: { source: `Admin.loadStats.${name}` } });
      }
    }
    setStatsLoadError(failed.length > 0);

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

  const viewLabels = VIEW_LABELS;

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
      case "tiers": return <AdminHelperTiers />;
      case "idv": return <AdminIDVQueue />;
      case "credentials": return <AdminCredentialQueue />;
      case "exceptions": return <AdminExceptionQueue />;
      case "business_verify":
        return BUSINESS_ENABLED ? <AdminBusinessVerificationQueue /> : null;
      case "business_accounts":
        return BUSINESS_ENABLED ? <AdminBusinessAccounts /> : null;
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
          dataError={statsLoadError || unreadCountsError}
        />
      );
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-premium-page">
        {/* Top padding ONLY below `lg`, where admin renders its own fixed bar.
            On the desktop website the global bar's height is already reserved
            by `html.web-desktop.desktop-rail:not(.app-shell) #root
            { padding-top: 3.5rem }` — /admin is a document-scroll route — so a
            pt-14 here would stack a second 56px on top of it. */}
        <div className={`flex-1 flex flex-col min-w-0 ${isWebDesktop ? "" : "pt-14"}`}>
          {/* NO SECOND TOP BAR ON THE DESKTOP WEBSITE.
              App.tsx mounts DesktopTopNav and DesktopSidebarNav unconditionally
              for every signed-in user, and neither hides on /admin — so this
              page was rendering TWO top bars and TWO rails stacked on top of
              each other. That is the actual reason the admin chrome kept
              reading as wrong no matter how many times its own bar was
              adjusted: the bar being fixed was not the bar being seen.

              Below `lg` the global pair is `hidden lg:flex`, so admin still
              needs its own — hence the split rather than a plain delete. */}
          {!isWebDesktop && <AdminTopBar />}

          <main
            className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 pb-[calc(2rem_+_var(--safe-area-bottom,0px))]"
          >
            {view !== "home" && (
              <AdminSectionHeader title={viewLabels[view]} onBack={() => handleViewChange("home")} />
            )}
            <Suspense fallback={<div role="status" aria-label="Loading…" className="flex items-center justify-center py-12"><div className="motion-safe:animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
              {renderContent()}
            </Suspense>
          </main>
        </div>

        {/* Same split as the top bar. On the desktop website the GLOBAL side
            panel carries admin — "Admin" with every section nested under it
            (owner: "the side panel should be identical to a non-admin user,
            just add the admin sections under the Admin in the sidebar"), so a
            second rail here is the other half of the double chrome.
            Below `lg` this is the only rail there is, and it keeps its own
            Back to App / Sign Out rows. */}
        {!isWebDesktop && <AdminSidebar
          navGroups={navGroups}
          activeView={view}
          onSelect={handleViewChange}
          getBadge={getBadge}
          getBadgeColor={getBadgeColor}
          onLogout={() => setShowLogoutDialog(true)}
        />}

        {/* ONE verb: "sign out". The app says Sign Out on nine screens
            (Profile settings, Security, Account Pending/Denied/Banned,
            Complete Profile, the blocked-dashboard state) and "log out" on
            almost nothing, so the odd ones out were the two confirm dialogs and
            the admin sidebar that opens this one — the control read "Log Out",
            the dialog said "Log out", and the cancel offered "Stay logged in",
            while every other surface in the product said sign. Title Case per
            the app-wide Apple-HIG rule for buttons and alert titles. */}
        <BrandConfirmDialog
          open={showLogoutDialog}
          onOpenChange={setShowLogoutDialog}
          title="Sign Out?"
          description="You'll need to sign back in next time. Your posts and messages stay safe."
          primaryLabel="Sign Out"
          primaryTone="bark"
          primaryHaptic="medium"
          onPrimary={async () => { await signOutWithPushCleanup(); navigate("/"); }}
          secondaryLabel="Stay Signed In"
        />
      </div>
    </SidebarProvider>
  );
};
export default Admin;
