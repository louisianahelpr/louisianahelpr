import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { PostgrestError } from "@supabase/supabase-js";
import { subscribeWithRecovery } from "@/lib/realtimeRecovery";
import { lazy } from "react";
import { AdminFrame } from "./AdminFrame";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardHome } from "@/components/admin/dashboard/DashboardHome";
import { homeStanding } from "@/components/admin/dashboard/homeStanding";
import { useSeriousOpenAlertCount } from "@/components/admin/adminHealth/useOpenAlerts";
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
const AdminNotifications = lazy(() => import("@/components/admin/AdminNotifications"));
const AdminReports = lazy(() => import("@/components/admin/AdminReports"));
const AdminSupport = lazy(() => import("@/components/admin/AdminSupport"));
const AdminReferrals = lazy(() => import("@/components/admin/AdminReferrals"));
const AdminGrowthLinks = lazy(() => import("@/components/admin/AdminGrowthLinks"));
const AdminSubscriptions = lazy(() => import("@/components/admin/AdminSubscriptions"));
const AdminFraudDashboard = lazy(() => import("@/components/admin/AdminFraudDashboard"));
const AdminAuditLog = lazy(() => import("@/components/admin/AdminAuditLog"));
const AdminHealth = lazy(() => import("@/components/admin/AdminHealth"));
const AdminExport = lazy(() => import("@/components/admin/AdminExport"));

const AdminPayoutBatches = lazy(() => import("@/components/admin/AdminPayoutBatches"));
const AdminHelperTiers = lazy(() => import("@/components/admin/AdminHelperTiers"));
const AdminNotificationLogs = lazy(() => import("@/components/admin/AdminNotificationLogs"));
const AdminMarketing = lazy(() => import("@/components/admin/AdminMarketing"));
const AdminIDVReview = lazy(() => import("@/components/admin/AdminIDVReview"));
const AdminCredentialQueue = lazy(() => import("@/components/admin/AdminCredentialQueue"));
const AdminExceptionQueue = lazy(() => import("@/components/admin/AdminExceptionQueue"));
const AdminBanReview = lazy(() => import("@/components/admin/AdminBanReview"));
const AdminSocialPosts = lazy(() => import("@/components/admin/AdminSocialPosts"));
const AdminStalledJobs = lazy(() => import("@/components/admin/AdminStalledJobs"));
const AdminShopsOrders = lazy(() => import("@/components/admin/AdminShopsOrders"));

type View = "home" | "analytics" | "people" | "jobs" | "settings" | "disputes" | "notifications" | "notiflogs" | "reports" | "support" | "referrals" | "subscriptions" | "fraud" | "audit" | "health" | "export" | "payouts" | "tiers" | "marketing" | "social" | "idvreview" | "credentials" | "exceptions" | "banreview" | "stalled" | "shops" | "growth";

import { safeStorage } from "@/lib/safeStorage";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { publishAdminBadges } from "@/components/admin/adminBadgeStore";
import { ADMIN_QUEUE_IDS, adminBadgeFor, useAdminPendingCounts } from "@/components/admin/adminRailBadges";
import { useQueryClient } from "@tanstack/react-query";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { CAPTURED_PAYMENT_STATUSES, isCapturedPayment, withGiftCardPaid } from "@/lib/capturedPayment";
import { loadGiftCardPaidJobIds } from "@/components/admin/giftCardPaidJobIds";
import { sparklineBuckets } from "@/components/admin/dashboard/sparklineBuckets";

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
    jobs: "Jobs", settings: "Settings", disputes: "Disputes",
    notifications: "Notifications", notiflogs: "Notification logs",
    reports: "Reports", support: "Support",
    referrals: "Referrals", subscriptions: "Subscriptions", fraud: "Fraud",
    audit: "Audit log", health: "Health", export: "Export",
    payouts: "Payout batches", tiers: "Helpr tiers", marketing: "Marketing",
    social: "Social posts",
    idvreview: "Identity review",
    credentials: "License & insurance",
    exceptions: "Exception queue",
    banreview: "Ban review",
    stalled: "Stuck Jobs",
    shops: "Shops orders",
    growth: "Growth links",
  };

const Admin = () => {
  // Which chrome this page owns — see the two render sites below.
  const isWebDesktop = useIsWebDesktop();
  const navigate = useNavigate();
  // ?view= deep-links from notifications (e.g. /admin?view=people&user=<id>).
  // Notifications fanned out by triggers point here so admins land on the
  // right sub-view in one tap. ?user= is forwarded into AdminUsers so it
  // can openProfile() automatically.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawInitialView = (searchParams.get("view") as View) || "home";
  // A stale deep-link to a view that no longer exists — from an old admin
  // notification or a bookmark — must not half-render a screen. Parish Tax
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
  const initialView: View = !isRealView(rawInitialView) ? "home" : rawInitialView;
  // The URL is the source of truth for the current view — switching sections
  // used to setState only, leaving the address bar at bare /admin, so a
  // refresh dumped the admin back on Dashboard and browser-Back exited admin
  // entirely instead of stepping back a section (caught by the 2026-08-24
  // interactive click-audit; the owner reported it as "buttons don't work").
  // `initialView` re-derives from searchParams every render, so back/forward
  // and deep links all resolve through the same coercion above.
  const view = initialView;
  // One title per view, the same way Profile.tsx titles its 18 tabs: all 27
  // admin screens used to report "Admin — Helpr", so history, bookmarks and
  // the tab bar could not tell Disputes from Payout Batches. `VIEW_LABELS` is
  // already the h1 source, so the title follows it. Home keeps the plain title
  // rather than repeating itself (Profile does the same for its landing tab).
  usePageTitle(view === "home" ? "Admin — Helpr" : `${VIEW_LABELS[view]} — Admin — Helpr`);
  const [notifLogsInitialSearch, setNotifLogsInitialSearch] = useState<string>("");
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    activeJobs: 0, completedJobs: 0, totalRevenue: 0, totalFees: 0,
    lateCancellationRevenue: 0,
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
  // Q1071 / Q1691 / owner 2026-10-27: every queue's open count
  // (src/components/admin/adminRailBadges.ts). The SAME hook feeds the left
  // nav's red counts on every page and the Dashboard's Priority Alerts below.
  const pendingCounts = useAdminPendingCounts(!loading);
  const openQueues = pendingCounts.data;
  const { data: seriousAlertCount, isError: seriousAlertsFailed } = useSeriousOpenAlertCount(!loading);
  const qc = useQueryClient();

  const loadUnreadCounts = useCallback(async () => {
    // `excludeSeed` marks the sections whose table HAS an is_seed column, which
    // is only `profiles` and `jobs` — `reports` and `referrals` do not have one
    // and a blanket filter would fail them with 42703 (undefined_column) and
    // blank those badges entirely.
    //
    // WHY THIS FLAG EXISTS. `loadStats` filters is_seed = false on every query
    // it can, and this function filtered it on NONE. So the sidebar badge and
    // the dashboard number sitting next to it counted different populations:
    // the badge included demo rows, the dashboard excluded them. Two counts of
    // the same fact that disagree is worse than one wrong count, because
    // neither can be trusted and nothing says which is which. It also gets
    // WORSE at launch, not better — the moment seed_jobs_hidden_publicly()
    // hides demo jobs from every user-facing surface, these badges would have
    // gone on counting them, so admin would be the last place still showing
    // numbers the rest of the app had stopped believing.
    const sections: { key: View; table: "profiles" | "jobs" | "referrals"; dateCol: string; filter?: Record<string, string | boolean>; excludeSeed?: boolean }[] = [
      // No "people" entry: it counted approval_status='pending' accounts, a
      // review queue retired in Q193 (owner 2026-09-23).
      // No disputes / reports / support entries (owner 2026-10-27): a queue's
      // number is its OPEN count (useAdminPendingCounts), which a visit does
      // not clear. Their "new since you looked" counts hid a waiting ticket the
      // moment the screen was opened once.
      { key: "jobs", table: "jobs", dateCol: "created_at", excludeSeed: true },
      { key: "referrals", table: "referrals", dateCol: "created_at" },
      { key: "subscriptions", table: "profiles", dateCol: "updated_at", filter: { subscription_tier: "not_null" }, excludeSeed: true },
    ];
    const counts: Record<string, number> = {};
    let hadError = false;
    await Promise.all(sections.map(async (s) => {
      const lastSeen = getSeenTimestamp(s.key);
      let query = supabase.from(s.table).select("id", { count: "exact", head: true });
      // `is_seed` exists only on profiles/jobs (the rows flagged excludeSeed),
      // not on every table in the union, so it is addressed as a dynamic
      // column name like the filter keys below.
      if (s.excludeSeed) query = query.eq("is_seed" as string, false);
      if (lastSeen) query = query.gt(s.dateCol, lastSeen);
      if (s.filter) {
        for (const [col, val] of Object.entries(s.filter)) {
          if (val === "not_null") query = query.not(col, "is", null);
          else query = query.eq(col, val);
        }
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
    // Write the view into the URL (preserving unrelated params like ?user=)
    // rather than into state — see the source-of-truth note at `view` above.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === "home") next.delete("view");
      else next.set("view", v);
      return next;
    });
  }, [setSearchParams]);

  const loadStats = async (windowDays: number) => {
    const now = new Date();
    const dStart = new Date(now.getTime() - windowDays * 86400000).toISOString();
    const dPrevStart = new Date(now.getTime() - 2 * windowDays * 86400000).toISOString();
    // Start of the current calendar quarter — used by the tax-reserve
    // tracker so the admin can see fee revenue accrued toward the next
    // estimated-tax payment.
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString();

    const [
      profilesRes, activeRes, completedRes,
      paymentsRes, lateCancelRes,
      newUsersInRangeRows, newUsersPrevRows,
      revInRangeRows, revPrevRows,
      completedInRangeRows, completedPrevRows,
      activeJobsInRangeRows,
      quarterRes,
      giftCardPaidRes,
    ] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_seed", false),
      supabase.from("jobs").select("id", { count: "exact", head: true }).not("status", "in", "(completed,cancelled)").in("payment_status", ["escrow", "payout_pending"]).eq("is_seed", false), // Active = paid + unfinished, as Jobs → Active (isActivePaidJob)
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed").eq("is_seed", false),
      supabase.from("jobs").select("id, payment_status, stripe_payment_intent_id, budget, platform_fee_amount, customer_fee_amount").in("payment_status", [...CAPTURED_PAYMENT_STATUSES]).neq("status", "cancelled").eq("is_seed", false),
      supabase.from("jobs").select("budget, platform_fee_amount, customer_fee_amount, cancellation_fee").eq("status", "cancelled").in("payment_status", ["refunded", "cancelled", "escrow", "payout_pending", "released"]).eq("is_seed", false),
      // New users by created_at — rows so we can bucket into a sparkline.
      supabase.from("profiles").select("created_at").gte("created_at", dStart).eq("is_seed", false),
      supabase.from("profiles").select("created_at").gte("created_at", dPrevStart).lt("created_at", dStart).eq("is_seed", false),
      // Revenue rows in current window
      supabase.from("jobs").select("id, payment_status, stripe_payment_intent_id, platform_fee_amount, customer_fee_amount, updated_at")
        .in("payment_status", [...CAPTURED_PAYMENT_STATUSES])
        .neq("status", "cancelled")
        .gte("updated_at", dStart).eq("is_seed", false),
      // Revenue rows in previous window
      supabase.from("jobs").select("id, payment_status, stripe_payment_intent_id, platform_fee_amount, customer_fee_amount, updated_at")
        .in("payment_status", [...CAPTURED_PAYMENT_STATUSES])
        .neq("status", "cancelled")
        .gte("updated_at", dPrevStart).lt("updated_at", dStart).eq("is_seed", false),
      // Completed jobs in current window
      supabase.from("jobs").select("updated_at").eq("status", "completed").gte("updated_at", dStart).eq("is_seed", false),
      // Completed jobs in previous window
      supabase.from("jobs").select("updated_at").eq("status", "completed").gte("updated_at", dPrevStart).lt("updated_at", dStart).eq("is_seed", false),
      // Active-job creation pulse for sparkline (created_at within window)
      supabase.from("jobs").select("created_at").not("status", "in", "(completed,cancelled)").in("payment_status", ["escrow", "payout_pending"]).gte("created_at", dStart).eq("is_seed", false),
      // Platform-fee revenue accrued this calendar quarter — feeds the
      // tax-reserve tracker's "this quarter" figure.
      supabase.from("jobs").select("id, payment_status, stripe_payment_intent_id, platform_fee_amount, customer_fee_amount, updated_at")
        .in("payment_status", [...CAPTURED_PAYMENT_STATUSES])
        .neq("status", "cancelled")
        .gte("updated_at", quarterStart).eq("is_seed", false),
      // Q443: which held jobs a gift card paid (they carry no job PI).
      loadGiftCardPaidJobIds(),
    ]);

    // Surface any failed query instead of silently rendering a misleading
    // "0" / healthy-looking fallback — a single bad query among the 20
    // above must not be indistinguishable from a genuinely healthy
    // platform. The other, successful queries still render normally.
    const namedResults: [string, { error: PostgrestError | null }][] = [
      ["profiles", profilesRes],
      ["active", activeRes], ["completed", completedRes],
      ["payments", paymentsRes], ["lateCancel", lateCancelRes],
      ["newUsersInRange", newUsersInRangeRows], ["newUsersPrev", newUsersPrevRows],
      ["revInRange", revInRangeRows], ["revPrev", revPrevRows],
      ["completedInRange", completedInRangeRows], ["completedPrev", completedPrevRows],
      ["activeJobsInRange", activeJobsInRangeRows], ["quarter", quarterRes],
      ["giftCardPaid", giftCardPaidRes],
    ];
    const failed = namedResults.filter(([, res]) => res.error);
    if (failed.length > 0) {
      for (const [name, res] of failed) {
        report(res.error, { tags: { source: `Admin.loadStats.${name}` } });
      }
    }
    setStatsLoadError(failed.length > 0);

    // The four held-status reads above return every held row; a payment counts
    // only with a job PI or a gift card behind it (Q233, Q443).
    const captured = <R extends { id: string; payment_status: string | null; stripe_payment_intent_id: string | null }>(rows: R[] | null) =>
      withGiftCardPaid(rows, giftCardPaidRes.ids).filter(isCapturedPayment);
    const paymentRows = captured(paymentsRes.data);
    const revInRange = captured(revInRangeRows.data);
    const cancelledPaidRows = lateCancelRes.data || [];
    // `null > 0` is false in JS, the same result as `0 > 0`, so reading the
    // nullable column as a number here states the runtime comparison exactly.
    const lateCancellationRevenue = cancelledPaidRows.filter((j) => (j.cancellation_fee as number) > 0).reduce((s, j) => {
      return s + (j.cancellation_fee || 0);
    }, 0);
    const sumFees = (rows: Pick<Tables<"jobs">, "platform_fee_amount" | "customer_fee_amount">[] | null) =>
      (rows || []).reduce((s, j) => s + (j.platform_fee_amount || 0) + (j.customer_fee_amount || 0), 0);

    const bucket10 = <R extends { ts?: string | null }>(rows: R[] | undefined | null, valueFn?: (row: R) => number) => sparklineBuckets(rows, now, windowDays, valueFn);

    const newUsersSeries = bucket10(
      (newUsersInRangeRows.data || []).map((r) => ({ ts: r.created_at })),
    );
    const revenueSeries = bucket10(
      revInRange.map((r) => ({
        ts: r.updated_at,
        platform_fee_amount: r.platform_fee_amount,
        customer_fee_amount: r.customer_fee_amount,
      })),
      (row) => (row.platform_fee_amount || 0) + (row.customer_fee_amount || 0),
    );
    const completedJobsSeries = bucket10(
      (completedInRangeRows.data || []).map((r) => ({ ts: r.updated_at })),
    );
    const activeJobsSeries = bucket10(
      (activeJobsInRangeRows.data || []).map((r) => ({ ts: r.created_at })),
    );

    setStats({
      totalUsers: profilesRes.count || 0,
      activeJobs: activeRes.count || 0,
      completedJobs: completedRes.count || 0,
      // Gross, the same way Analytics defines "Payments Collected": what the
      // poster was actually charged (budget + their service fee). Summing the
      // budget alone put $5709.99 on this tile beside $5751.99 on Analytics,
      // one click apart, under the same label — the tiles had been unified
      // visually and the number had not (measured 2026-09-07).
      totalRevenue: paymentRows.reduce((s, j) => s + (j.budget || 0) + (j.customer_fee_amount || 0), 0),
      totalFees: paymentRows.reduce((s, j) => s + (j.platform_fee_amount || 0) + (j.customer_fee_amount || 0), 0),
      lateCancellationRevenue,
      newUsersInRange: (newUsersInRangeRows.data || []).length,
      newUsersPrev: (newUsersPrevRows.data || []).length,
      revenueInRange: sumFees(revInRange),
      revenuePrev: sumFees(captured(revPrevRows.data)),
      completedJobsInRange: (completedInRangeRows.data || []).length,
      completedJobsPrev: (completedPrevRows.data || []).length,
      feesThisQuarter: sumFees(captured(quarterRes.data)),
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

  // `view` as a ref, read inside the effect below WITHOUT being a dependency.
  // That effect owns the admin realtime subscription; adding `view` to its deps
  // would tear down and re-open the channel on every sidebar click, which is
  // both wasteful and a good way to trip the reused-channel-name rule.
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (loading) return;
    // Only the HOME dashboard renders these stats, and computing them costs 20
    // PostgREST queries. This effect fired them on every admin page load
    // regardless of which view was open, so opening People or Disputes paid for
    // a dashboard the admin could not see — measured on /admin?view=people:
    // 49 REST calls, 20 of them for the hidden home screen, plus 4 that were
    // byte-identical duplicates of `loadUnreadCounts`' own queries.
    //
    // The badge counts below are NOT gated: they drive the sidebar, which is on
    // screen in every view.
    if (viewRef.current === "home") loadStats(activeWindowDays);
    loadUnreadCounts();
    // Debounce realtime-triggered reloads — admin tables (jobs, profiles,
    // reports) can receive bursts of writes (e.g. a batch import or a job
    // lifecycle transition touching multiple rows). Without a debounce each
    // write fires a full stats reload; 500 ms collapses a burst into one.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        // Same gate as the initial load: a write burst must not recompute a
        // dashboard nobody is looking at. Navigating to home re-runs loadStats
        // via the `view === "home"` effect below, so nothing goes stale.
        if (viewRef.current === "home") loadStats(activeWindowDays);
        loadUnreadCounts();
        // A job or report write can open or close a dispute, report or ticket:
        // refresh the shared open counts (left nav, Priority Alerts, pills).
        void qc.invalidateQueries({ queryKey: ["admin-disputes", "open-count"] });
        void qc.invalidateQueries({ queryKey: ["admin-reports"] });
        void qc.invalidateQueries({ queryKey: ["admin-support"] });
      }, 500);
    };
    // Deliberately NOT user-scoped: unlike user-facing channels (which MUST be
    // user-scoped per the realtime rule), the admin dashboard's whole job is
    // to reflect platform-wide activity. The debounce above keeps a burst sane.
    //
    // `jobs` IS filtered to `is_seed=eq.false` (Q104/Q105): every stat and
    // badge on this screen excludes seed rows, so a seed write cannot change
    // anything it shows — and CI test data is meant to be seed rows (CLAUDE.md;
    // not checked here that every spec marks its jobs). Unfiltered, every job
    // write anywhere fired a ~25-query reload in every open admin session (one
    // press-run admin session made 18,035 REST calls in 29 min, Q104). Cost of the filter: a hard DELETE of a real job (its payload
    // carries only the id) no longer reloads live; the manual refresh does.
    // `reports` has no is_seed column and is low volume.
    //
    // There is NO `profiles` binding here, and adding one would break the other
    // two. `profiles` was dropped from the `supabase_realtime` publication by
    // migration 20260423164103 to stop broadcasting PII, and a binding on an
    // unpublished table poisons its ENTIRE channel — so the `profiles` line
    // that used to sit between these two was silently taking `jobs` and
    // `reports` down with it, leaving this whole dashboard without the live
    // reload it appears to have. (SF-017.) The pending-people count still
    // refreshes via loadUnreadCounts() on view change and on the manual
    // refresh, which is now the honest path rather than an implied live one.
    const sub = subscribeWithRecovery(
      (name) => supabase
      .channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'is_seed=eq.false' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, debouncedReload),
      { name: "admin-realtime", onRecovered: debouncedReload },
    );
    return () => { if (debounce) clearTimeout(debounce); sub.close(); };
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

  // AM-011: the desktop sidebar (DesktopSidebarNav) shows these same counts.
  // It reads every queue's open count itself (useAdminPendingCounts, on every
  // page); what only this page knows is the "new since you looked" numbers.
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const g of adminNavGroups) for (const { id } of g.items) {
      const n = adminBadgeFor(id, unreadCounts, openQueues);
      if (n) next[id] = n;
    }
    publishAdminBadges(next);
  }, [unreadCounts, openQueues]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-premium-page">
        <HelprSpinner size={36} />
      </div>
    );
  }

  const getBadge = (id: string): number | undefined => adminBadgeFor(id, unreadCounts, openQueues);

  // Work waiting on a person is red, like the desktop nav's counts (owner
  // 2026-10-27); a "new since you looked" number keeps the quieter primary.
  const getBadgeColor = (id: string): string =>
    (ADMIN_QUEUE_IDS as readonly string[]).includes(id)
      ? "bg-destructive text-destructive-foreground"
      : "bg-primary text-primary-foreground";

  const viewLabels = VIEW_LABELS;

  const renderContent = () => {
    const homeDataError = statsLoadError || unreadCountsError || pendingCounts.isError || seriousAlertsFailed;
    switch (view) {
      case "analytics": return <AdminAnalytics />;
      case "people": return <AdminUsers />;
      case "jobs": return <AdminJobs />;
      case "settings": return <AdminSettings />;
      case "disputes": return <AdminDisputes />;
      case "notifications": return <AdminNotifications />;
      case "notiflogs": return <AdminNotificationLogs initialSearch={notifLogsInitialSearch} />;
      case "reports": return <AdminReports />;
      case "support": return <AdminSupport />;
      case "referrals": return <AdminReferrals />;
      case "growth": return <AdminGrowthLinks />;
      case "subscriptions": return <AdminSubscriptions />;
      case "fraud": return <AdminFraudDashboard />;
      case "audit": return <AdminAuditLog />;
      case "health": return <AdminHealth />;
      case "export": return <AdminExport />;
      case "payouts": return <AdminPayoutBatches />;
      case "tiers": return <AdminHelperTiers />;
      case "idvreview": return <AdminIDVReview />;
      case "credentials": return <AdminCredentialQueue />;
      case "exceptions": return <AdminExceptionQueue />;
      // The human half of the message-scanner ladder — deep-linked from the
      // "Ban review needed" admin notification (20260825160000).
      case "banreview": return <AdminBanReview />;
      // Jobs stuck `in_progress` past +48h with escrow held and nobody marking
      // them done — escalated by the stalled-completion sweep for a HUMAN
      // decision. Deep-linked from the `admin_alert` that escalation raises.
      case "stalled": return <AdminStalledJobs />;
      // Shops M4: problems, refunds, payouts and Shops strikes (20261019071055).
      case "shops": return <AdminShopsOrders />;
      case "marketing": return <AdminMarketing />;
      case "social": return <AdminSocialPosts />;
      default: return (
        <DashboardHome
          // The three Priority Alerts are the shared open counts, the same
          // numbers as the left nav's badges and each screen's Pending tab.
          stats={{
            ...stats,
            disputedJobs: openQueues.disputes ?? 0,
            openReports: openQueues.reports ?? 0,
            supportTickets: openQueues.support ?? 0,
          }}
          statsLoading={statsLoading}
          onNavigate={handleViewChange}
          dateRange={dateRange}
          setDateRange={setDateRange}
          customDays={customDays}
          setCustomDays={setCustomDays}
          rangeLabel={activeRangeLabel}
          prevLabel={activePrevLabel}
          dataError={homeDataError}
          seriousAlerts={seriousAlertCount}
          standing={homeStanding({
            queues: openQueues,
            seriousAlerts: seriousAlertCount,
            dataError: homeDataError,
          })}
        />
      );
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-premium-page">
        <AdminFrame
          isWebDesktop={isWebDesktop}
          view={view}
          viewLabels={viewLabels}
          handleViewChange={handleViewChange}
          navGroups={navGroups}
          getBadge={getBadge}
          getBadgeColor={getBadgeColor}
          showLogoutDialog={showLogoutDialog}
          setShowLogoutDialog={setShowLogoutDialog}
          navigate={navigate}
        >
          {renderContent()}
        </AdminFrame>
      </div>
    </SidebarProvider>
  );
};
export default Admin;
