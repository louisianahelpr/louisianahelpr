import { useState, useCallback, useEffect, useRef, lazy, Suspense, useMemo, type SetStateAction } from "react";
import type { FeedDensity } from "@/components/dashboard/feedDensity";

import { motion } from "framer-motion";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { Button } from "@/components/ui/button";
import AppShell from "@/components/AppShell";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock, XCircle, Star, X, Search, CloudLightning } from "lucide-react";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { DashboardSkeleton, DashboardTitleSkeleton } from "@/components/SkeletonLoaders";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";
import { YourHelpersRow } from "@/components/dashboard/YourHelpersRow";
import BroadcastBanner from "@/components/BroadcastBanner";
import type { EnrichedJob } from "@/components/dashboard/types";

// Dialogs and overlays — none are visible on first paint. Each is code-split
// and only the dialogs the user actually opens get fetched, keeping the
// Dashboard route chunk small.
const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));
const JobQuickActionSheet = lazy(() => import("@/components/dashboard/JobQuickActionSheet").then(m => ({ default: m.JobQuickActionSheet })));
const ApplyConfirmDialog = lazy(() => import("@/components/dashboard/ApplyConfirmDialog").then(m => ({ default: m.ApplyConfirmDialog })));
const ReportDialog = lazy(() => import("@/components/ReportDialog"));
const PayoutSetupDialog = lazy(() => import("@/components/PayoutSetupDialog"));
const OnboardingTour = lazy(() => import("@/components/OnboardingTour"));
const BirthdayPopup = lazy(() => import("@/components/BirthdayPopup"));
const JitVerifySheet = lazy(() => import("@/components/dashboard/JitVerifySheet").then(m => ({ default: m.JitVerifySheet })));
const JobMapView = lazy(() => import("@/components/dashboard/JobMapView").then(m => ({ default: m.JobMapView })));
const WelcomeModal = lazy(() => import("@/components/dashboard/WelcomeModal"));
import SectionBoundary from "@/components/SectionBoundary";
import { recordJobActionForPermissionPrompt } from "@/hooks/useNotificationPermissionPrompt";
import { useDashboardData } from "@/hooks/useDashboardData";
import { usePrefetchUserData } from "@/hooks/usePrefetchUserData";
import { assertWritable } from "@/hooks/useImpersonation";
import { track, AhaEvent } from "@/lib/analytics";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { requireOnline } from "@/lib/requireOnline";
import { safeStorage } from "@/lib/safeStorage";
import { usePersistedBrowseView } from "@/hooks/usePersistedBrowseView";
import { queryKeys } from "@/lib/queryKeys";
import { checkApplicationRate, recordApplicationAttempt } from "@/lib/applyRateLimit";
import { getActiveTriggers, type TriggerContext } from "@/lib/lifeEventTriggers";
import { LifeEventCard } from "@/components/dashboard/LifeEventCard";
import { AutopilotReminderCard } from "@/components/dashboard/AutopilotReminderCard";
import { JobsForYou } from "@/components/dashboard/JobsForYou";

// Quick Apply handler for notification deep links
const QuickApplyHandler = ({ searchParams, user, allJobs, onApply }: {
  searchParams: URLSearchParams;
  user: SupaUser | null;
  allJobs: EnrichedJob[];
  onApply: (jobId: string) => void;
}) => {
  const [shown, setShown] = useState(false);
  const quickApplyId = searchParams.get("quickApply");

  useEffect(() => {
    if (quickApplyId && user && allJobs.length > 0 && !shown) {
      setShown(true);
      const job = allJobs.find(j => j.id === quickApplyId);
      if (job && job.customer_id !== user.id) {
        toast(
          `Quick Apply: "${job.title}" ($${job.budget})`,
          {
            action: { label: "Apply now", onClick: () => onApply(quickApplyId) },
            duration: 10000,
          }
        );
      }
    }
  }, [quickApplyId, user, allJobs, shown, onApply]);

  return null;
};


const Dashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  usePageTitle("Dashboard — Helpr");
  const [searchParams] = useSearchParams();

  const {
    user, profile, isAdmin, loading, helprTier, allJobs, platformFee,
    helperAvailability, recommendedJobs, refresh, loadError, isRefreshing,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useDashboardData();

  // Sentinel for infinite scroll — fires fetchNextPage when ~80% of the list is in view.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      // rootMargin pulls the trigger ~20% of viewport early (~80% scroll point)
      { root: null, rootMargin: "0px 0px 20% 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, allJobs.length]);

  const { containerRef, pullDistance, refreshing, isPulling } = usePullToRefresh({
    onRefresh: refresh,
  });

  useRealtimePush(user?.id ?? null);
  // Warm Referral / Activity / Jobs caches in the background — makes the next tap feel instant.
  usePrefetchUserData(user?.id);

  const filters = useDashboardFilters({
    allJobs, userId: user?.id, profile, helprTier, helperAvailability: helperAvailability as any,
  });

  // The greeting card's "stat of the day" line was removed — it added a
  // third line to the title card and pushed the job feed down. The
  // headline job count it surfaced still shows in the date eyebrow.

  // First-run welcome modal — shown once for accounts < 7 days old that
  // haven't dismissed it yet. Computed lazily from localStorage + profile
  // so it's stable after the first render; profile?.created_at is checked
  // below in a separate effect to re-evaluate once the profile loads.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (loading) return; // wait for profile to resolve
    if (typeof window === "undefined") return;
    if (localStorage.getItem("helpr_welcomed")) return;
    if (!profile?.created_at) return;
    const ageDays =
      (Date.now() - new Date(profile.created_at).getTime()) / 86_400_000;
    if (ageDays < 7) setShowWelcome(true);
  }, [loading, profile?.created_at]);

  const handleWelcomeDismiss = useCallback(() => {
    try { localStorage.setItem("helpr_welcomed", "1"); } catch { /* private-browsing / quota — ignore */ }
    setShowWelcome(false);
  }, []);

  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  // Quick-action sheet — opened by a long-press on a JobCard. Lets the
  // helpr save / hide / share / report without committing to opening
  // the full detail dialog. Null = sheet closed.
  const [quickActionJobId, setQuickActionJobId] = useState<string | null>(null);
  // Scroll-position snapshot — captured the moment a detail dialog opens,
  // then restored to the same scrollTop on close. Without it the dashboard
  // feed silently snaps back to the top when the user dismisses the dialog,
  // which feels broken on a long-scroll session. The container is the
  // PullToRefreshWrapper's div (PageScaffold panel scroll surface) so the
  // restore lands on the same surface the user was scrolling.
  const detailScrollSnapshotRef = useRef<number | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // List vs Map view. The map shows the same open jobs as the list,
  // pinned to neighborhood-rounded coords (privacy via the
  // get_open_jobs_for_map RPC). Toggle persists for the session only —
  // resetting to "list" on next mount matches user expectation that
  // the default landing surface is the curated feed.
  const [view, setView] = usePersistedBrowseView("list");

  // Feed density — comfortable (full cards) or compact (48px rows).
  // Persisted to localStorage so the user's preference survives sessions.
  const [density, setDensityState] = useState<FeedDensity>(() => {
    try {
      const stored = window.localStorage.getItem("job-feed-density");
      return stored === "compact" || stored === "comfortable" ? stored : "comfortable";
    } catch { return "comfortable"; }
  });
  const setDensity = useCallback((next: FeedDensity) => {
    setDensityState(next);
    try { window.localStorage.setItem("job-feed-density", next); } catch { /* ignore */ }
  }, []);

  // Desktop split-screen hover sync — hovering a list card scales up the
  // corresponding map pin. null = no card hovered.
  const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);

  const [confirmApplyJobId, setConfirmApplyJobId] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyFiles, setApplyFiles] = useState<File[]>([]);
  const [stakeAmount, setStakeAmount] = useState<number | null>(null);
  // Proposed bid price — only populated for accept_bids jobs.
  const [bidPrice, setBidPrice] = useState("");
  // JIT verify gate — shown on first-ever Apply tap (has_applied_before=false).
  // pendingJobIdForVerify holds the job they tapped Apply on so we can
  // proceed once they dismiss the sheet.
  const [jitVerifyOpen, setJitVerifyOpen] = useState(false);
  const [pendingJobIdForVerify, setPendingJobIdForVerify] = useState<string | null>(null);
  const [payoutSetupDialogOpen, setPayoutSetupDialogOpen] = useState(false);
  const confirmApplyJob = allJobs.find((j) => j.id === confirmApplyJobId) || null;
  const [confirmDismissJobId, setConfirmDismissJobId] = useState<string | null>(null);
  const confirmDismissJob = allJobs.find((j) => j.id === confirmDismissJobId) || null;
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  // Top saved search (most-recently-created) — surfaced on the greeting
  // when there are 0 jobs nearby, so the empty state feels intentional
  // ("we're watching for X") rather than confusing. Cached via React
  // Query so it isn't re-fetched on every Dashboard mount.
  const { data: topSavedSearch = null } = useQuery({
    queryKey: queryKeys.dashboard.savedSearches(user?.id),
    queryFn: async () => {
      const data = unwrap(await supabase
        .from("saved_searches")
        .select("name")
        .eq("user_id", user!.id)
        .eq("notify_enabled", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle());
      return data ? { name: data.name } : null;
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  // Pay It Forward — count of available credits in the user's parish.
  // Shown as a teaser banner above the community teaser when > 0.
  // PGRST202-safe: table may not be on prod yet between merge + db push.
  const userParish = profile?.parish ?? null;
  const { data: pifCount = 0 } = useQuery({
    queryKey: ["pif-count", userParish],
    queryFn: async () => {
      if (!userParish) return 0;
      try {
        const { count, error } = await supabase
          .from("pif_credits" as never)
          .select("id", { count: "exact", head: true })
          .eq("status", "available")
          .eq("parish", userParish);
        if (error && (error as any).code === "PGRST202") return 0;
        if (error) return 0;
        return count ?? 0;
      } catch { return 0; }
    },
    enabled: !!userParish,
    staleTime: 5 * 60 * 1000,
  });

  // Profile-completion is no longer nudged on the home feed — the full
  // "Finish your profile" card pushed the job feed below the fold. The
  // completion checklist / progress meter lives on the Profile landing
  // screen instead (ProfileLanding's completion meter), which is the
  // surface the user navigates to in order to act on it.

  // Inactive subscriber nudge — if a paid helper hasn't applied to
  // anything in 7+ days, surface a gentle "your sub is paying for
  // itself when you apply" banner. Caps the cost-justification at the
  // moment the user is checking the feed.
  //
  // Only paid, non-expired subscribers should trigger the lookup — that
  // gate becomes the query's `enabled` flag so free/expired users never
  // pay for the `applications` fetch.
  const subTier = (profile?.subscription_tier ?? "free") as string;
  const subExpiresAt = profile?.subscription_expires_at ?? null;
  const subActive = subExpiresAt ? new Date(subExpiresAt) > new Date() : false;
  const isPaidSubscriber = !!profile && subActive && subTier !== "free";
  const { data: hasPets = false } = useQuery({
    queryKey: ["pet_profiles_count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("pet_profiles")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user!.id);
      if (error) return false;
      return (count ?? 0) > 0;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });


  const { data: lastApplicationAt } = useQuery({
    queryKey: queryKeys.dashboard.lastApplication(user?.id),
    queryFn: async () => {
      const data = unwrap(await supabase
        .from("applications")
        .select("created_at")
        .eq("helper_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle());
      return data?.created_at ?? null;
    },
    enabled: !!user?.id && isPaidSubscriber,
    staleTime: 60 * 1000,
  });
  const inactiveNudgeEligible = (() => {
    if (!isPaidSubscriber || lastApplicationAt === undefined) return false;
    const last = lastApplicationAt ? new Date(lastApplicationAt).getTime() : 0;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return !last || Date.now() - last > sevenDaysMs;
  })();
  // Dismissed per-session — once the user closes the banner it stays
  // hidden even though the query data still says they're eligible.
  const [inactiveNudgeDismissed, setInactiveNudgeDismissed] = useState(false);
  const inactiveNudge = inactiveNudgeEligible && !inactiveNudgeDismissed;

  // Hurricane season banner — active June–November (months 5–10, 0-indexed).
  // Dismissal persists for the calendar day via localStorage; resets each
  // new day so repeat visitors see it again without a full daily annoyance.
  const isHurricaneSeason = useMemo(() => {
    const month = new Date().getMonth(); // 0-indexed
    return month >= 5 && month <= 10;   // June (5) through November (10)
  }, []);
  const [stormBannerDismissed, setStormBannerDismissed] = useState(() => {
    try {
      return safeStorage.getItem("storm-banner-dismissed") === new Date().toDateString();
    } catch { return false; }
  });
  const showStormBanner = isHurricaneSeason && !stormBannerDismissed;

  // Early-access upsell banner — shown once (dismissible, localStorage key
  // "early-access-banner-dismissed") to free-tier helpers so they know
  // Pro/Elite subscribers see new jobs 10 minutes sooner. Tapping "Learn more"
  // navigates to /subscription.
  const isFreeTierHelper = !isPaidSubscriber;
  const [earlyAccessBannerDismissed, setEarlyAccessBannerDismissed] = useState(() => {
    try {
      return safeStorage.getItem("early-access-banner-dismissed") === "1";
    } catch { return false; }
  });
  const showEarlyAccessBanner = isFreeTierHelper && !earlyAccessBannerDismissed;

  // Life-event trigger — personalized contextual prompt above the storm banner.
  // Re-computed from stable profile + jobs data; dismissed via localStorage.
  // Re-keyed on dismiss so the card animates out via AnimatePresence.
  const [lifeEventDismissedAt, setLifeEventDismissedAt] = useState(0);
  const activeTrigger = useMemo(() => {
    const ctx: TriggerContext = {
      recentJobCategories: (allJobs as any[])
        .filter((j) => (j as any).customer_id === user?.id)
        .slice(0, 10)
        .map((j) => (j as any).category ?? ""),
      isHurricaneSeason: [5, 6, 7, 8, 9, 10].includes(new Date().getMonth()),
      hasPostedBefore: (allJobs as any[]).some((j) => (j as any).customer_id === user?.id),
      accountAgeDays: profile?.created_at
        ? Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86_400_000)
        : 0,
      completedJobsAsHelper: (profile as any)?.completed_jobs ?? 0,
      lastJobPostedDaysAgo: (() => {
        const myJobs = (allJobs as any[]).filter((j) => (j as any).customer_id === user?.id);
        if (!myJobs.length) return null;
        const latest = myJobs[0]?.created_at;
        if (!latest) return null;
        return Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000);
      })(),
      profileHasCity: !!(profile?.location || profile?.parish),
      hasPets,
    };
    // lifeEventDismissedAt in deps re-runs this after a dismiss clears localStorage.
    void lifeEventDismissedAt;
    return getActiveTriggers(ctx)[0] ?? null;
  }, [user?.id, allJobs, profile?.created_at, profile?.location, profile?.parish, lifeEventDismissedAt]);


  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(() => {
    try {
      const stored = safeStorage.getItem("helpr_dismissed_jobs");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Prune stale dismissed IDs that no longer correspond to any live job.
  // Stops the "I dismissed this 6 months ago and now it's silently hiding
  // a new feed" failure mode AND keeps localStorage from growing forever.
  // Runs once `allJobs` is populated.
  useEffect(() => {
    if (allJobs.length === 0 || dismissedJobIds.size === 0) return;
    const liveIds = new Set(allJobs.map((j) => j.id));
    const pruned = new Set<string>();
    let didPrune = false;
    for (const id of dismissedJobIds) {
      if (liveIds.has(id)) {
        pruned.add(id);
      } else {
        didPrune = true;
      }
    }
    if (didPrune) {
      setDismissedJobIds(pruned);
      safeStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...pruned]));
    }
     
  }, [allJobs.length]);

  const effectiveFee = platformFee;

  // Load saved job IDs — cached via React Query so the lookup isn't
  // re-run on every Dashboard mount. The result seeds the local
  // `savedJobIds` state (below), which handleToggleSave mutates
  // optimistically as the user saves/unsaves jobs.
  const { data: savedJobsData } = useQuery({
    queryKey: queryKeys.dashboard.savedJobs(user?.id),
    queryFn: async () => {
      const data = unwrap(await supabase
        .from("saved_jobs")
        .select("job_id")
        .eq("user_id", user!.id));
      return (data ?? []).map((d: { job_id: string }) => d.job_id);
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });
  useEffect(() => {
    if (savedJobsData) setSavedJobIds(new Set(savedJobsData));
  }, [savedJobsData]);

  // Home-autopilot: maintenance reminders due in the next 7 days.
  // Degrades gracefully via PGRST202 handling (table not yet deployed).
  const { data: dueReminders = [] } = useQuery({
    queryKey: ["due-reminders", user?.id],
    queryFn: async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const nextWeek = new Date(Date.now() + 7 * 86400_000).toISOString().split("T")[0];
        const { data, error } = await supabase
          .from("home_maintenance_reminders")
          .select("*")
          .eq("user_id", user!.id)
          .eq("is_active", true)
          .lte("next_reminder_date", nextWeek)
          .gte("next_reminder_date", today);
        // PGRST202 = table not deployed yet — hide section silently.
        if (error && (error as any).code === "PGRST202") return [];
        if (error) return [];
        return (data ?? []) as Array<{
          id: string;
          category: string;
          last_completed_date: string | null;
          next_reminder_date: string | null;
          reminder_interval_days: number;
        }>;
      } catch {
        return [];
      }
    },
    enabled: !!user?.id,
    staleTime: 300_000,
  });
  // Most overdue = earliest next_reminder_date
  const topReminder = dueReminders.length > 0
    ? [...dueReminders].sort((a, b) =>
        (a.next_reminder_date ?? "").localeCompare(b.next_reminder_date ?? ""),
      )[0]
    : null;

  // Save / un-save a job. Optimistic: the heart flips the instant the
  // user taps, both in local state and in the cached `savedJobs` query,
  // so the action feels sub-100ms. On failure we roll the snapshot back
  // and surface a small toast — no full refetch on success, because the
  // optimistic state is already correct.
  const saveJobMutation = useMutation({
    mutationFn: async ({ jobId, saved, userId }: { jobId: string; saved: boolean; userId: string }) => {
      if (saved) {
        // upsert avoids a 23505 unique-violation if the row already exists
        // (e.g. a stale local state desyncs from the server).
        const { error } = await supabase
          .from("saved_jobs")
          .upsert({ user_id: userId, job_id: jobId }, { onConflict: "user_id,job_id" });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("saved_jobs")
          .delete()
          .eq("user_id", userId)
          .eq("job_id", jobId);
        if (error) throw error;
      }
    },
    onMutate: async ({ jobId, saved, userId }) => {
      // Cancel any in-flight refetch so it can't overwrite our optimistic
      // value after we've applied it.
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.savedJobs(userId) });
      const previousSavedJobs = queryClient.getQueryData<string[]>(queryKeys.dashboard.savedJobs(userId));
      const previousLocal = savedJobIds;
      queryClient.setQueryData<string[]>(queryKeys.dashboard.savedJobs(userId), (prev) => {
        const current = prev ?? [];
        if (saved) return current.includes(jobId) ? current : [...current, jobId];
        return current.filter((id) => id !== jobId);
      });
      setSavedJobIds((prev) => {
        const next = new Set(prev);
        if (saved) next.add(jobId); else next.delete(jobId);
        return next;
      });
      return { previousSavedJobs, previousLocal };
    },
    onError: (_err, vars, context) => {
      if (context) {
        queryClient.setQueryData(queryKeys.dashboard.savedJobs(vars.userId), context.previousSavedJobs);
        setSavedJobIds(context.previousLocal);
      }
      // Inline Retry action — the optimistic state is already rolled back,
      // so the heart shows un-saved. Tapping Retry re-runs the same toggle
      // with the same target state the user wanted.
      errorToast("Couldn't save that job right now", {
        description: "Tap retry to try again.",
        onRetry: () => saveJobMutation.mutate(vars),
      });
    },
    // No onSuccess refetch: optimistic state is correct; a refetch would
    // briefly toggle the heart back and forth as the cache reconciles.
  });

  const handleToggleSave = useCallback((jobId: string, saved: boolean) => {
    if (!user) { navigate("/login"); return; }
    saveJobMutation.mutate({ jobId, saved, userId: user.id });
  }, [user, navigate, saveJobMutation]);
  const handleApplyRequest = useCallback(async (jobId: string) => {
    if (!requireOnline()) return;
    // Read-only impersonation: when an admin is viewing the app as another
    // user (?impersonate=<id>), block writes so the admin can't accidentally
    // apply on the user's behalf. See useImpersonation.
    if (!assertWritable()) return;
    hapticMedium(); // confirm tap on Apply
    if (!user) { navigate("/login"); return; }
    const job = allJobs.find((j) => j.id === jobId);
    if (job && job.customer_id === user.id) { toast.error("You can't apply to your own post."); return; }

    // JIT verify gate: on the very first Apply tap, check whether the user
    // has applied before. If not AND they haven't been prompted yet, show the
    // identity-nudge sheet before proceeding. This is a soft nudge — not a
    // hard block. If the profile columns don't exist yet (PGRST202), skip
    // the check and proceed normally.
    try {
      const { data: profileSnap, error: profileErr } = await supabase
        .from("profiles")
        .select("has_applied_before, id_verification_status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profileErr && profileSnap) {
        const needsNudge =
          !profileSnap.has_applied_before &&
          profileSnap.id_verification_status === "unverified";
        if (needsNudge) {
          setPendingJobIdForVerify(jobId);
          setJitVerifyOpen(true);
          return;
        }
      }
      // PGRST202 or any other error: fall through silently and proceed.
    } catch {
      // Non-fatal — fall through.
    }

    setConfirmApplyJobId(jobId);
  }, [user, allJobs, navigate]);

  // Optimistic Apply. The moment a helper hits "Apply now" we:
  //   1) close the dialog,
  //   2) optimistically add this job's id to `dashboardContext.appliedJobIds`
  //      so the feed filter (`!appliedJobIds.has(j.id)`) removes the row
  //      across every loaded page of the infinite query — the card vanishes
  //      in the same frame as the tap (no spinner, no Stripe-style wait).
  // The file-upload + insert run in the background; on error we restore
  // the snapshots so the job re-appears and the user can retry.
  type ApplyVars = {
    jobId: string;
    helperId: string;
    message: string;
    files: File[];
    stakeAmt: number | null;
    /** When the poster enabled instant-book, confirm the booking immediately
        after the application INSERT — no poster review required. Reuses the
        same jobs UPDATE path as handleHelperResponse (helper_confirmed_at).
        Treated as false when the column isn't on prod yet (pre-push). */
    isInstantBook?: boolean;
    /** Proposed bid price for accept_bids jobs (null for other pricing modes). */
    proposedPrice?: number | null;
  };
  type ApplySnapshot = {
    previousContext: unknown;
    userId: string;
  };
  const applyMutation = useMutation<void, Error & { code?: string }, ApplyVars, ApplySnapshot>({
    mutationFn: async ({ jobId, helperId, message, files, stakeAmt, isInstantBook, proposedPrice }) => {
      // Server-side rate limit check (10/min, 50/hr, 200/day) BEFORE any
      // attachment uploads — don't waste storage bandwidth on a blocked
      // attempt. The helper falls back to "allowed" if the RPC isn't
      // deployed yet (PGRST202), so this doesn't break apply on prod
      // between merge and the manual supabase db push.
      const gate = await checkApplicationRate({ applicantId: helperId });
      if (gate.allowed === false) {
        throw Object.assign(new Error(gate.message), { code: "RATE_LIMITED" });
      }
      // Upload attachments first (store storage paths; resolve signed URLs at view time).
      const attachmentUrls: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const path = `${helperId}/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("application-attachments")
          .upload(path, file);
        if (uploadErr) {
          // Re-throw with a friendly file-specific message so onError can toast it.
          throw Object.assign(new Error(`Failed to upload ${file.name}`), { code: "UPLOAD_FAILED" });
        }
        attachmentUrls.push(path);
      }
      // Try the apply_to_job RPC first (supports proposed_price for bid-mode jobs).
      // Fall back to a direct INSERT if PGRST202 (function not yet deployed to prod).
      const { data: rpcData, error: rpcError } = await (supabase.rpc as any)("apply_to_job", {
        p_job_id: jobId,
        p_message: message.trim() || null,
        p_proposed_price: proposedPrice ?? null,
      });
      if (rpcError) {
        const errCode = (rpcError as { code?: string }).code;
        if (errCode !== "PGRST202") {
          // Real error (duplicate, job closed, price-required, etc.) — surface it.
          throw rpcError as Error & { code?: string };
        }
        // PGRST202: apply_to_job not deployed yet — fall back to direct INSERT
        // (no proposed_price column yet; no harm, it's not on prod either).
        const { error } = await (supabase.from("applications") as any).insert({
          job_id: jobId,
          helper_id: helperId,
          message: message.trim() || null,
          attachment_urls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
          ...(stakeAmt && stakeAmt > 0 ? { stake_amount: stakeAmt, stake_status: "staked" } : {}),
        });
        if (error) throw error as Error & { code?: string };
      } else {
        void rpcData; // UUID returned but not currently used.
        // Patch attachment_urls onto the new row if needed (RPC doesn't handle attachments).
        if (attachmentUrls.length > 0) {
          await (supabase.from("applications") as any)
            .update({ attachment_urls: attachmentUrls, ...(stakeAmt && stakeAmt > 0 ? { stake_amount: stakeAmt, stake_status: "staked" } : {}) })
            .eq("job_id", jobId)
            .eq("helper_id", helperId);
        } else if (stakeAmt && stakeAmt > 0) {
          await (supabase.from("applications") as any)
            .update({ stake_amount: stakeAmt, stake_status: "staked" })
            .eq("job_id", jobId)
            .eq("helper_id", helperId);
        }
      }
      // Insert succeeded — bump the rate-limit counter. Best-effort: a
      // failed record call shouldn't surface to the user since the apply
      // already landed. PGRST202 is silently no-op'd inside the helper.
      void recordApplicationAttempt({ applicantId: helperId });

      // Instant-book: auto-confirm immediately after applying, mirroring the
      // direct-offer accept path (helper_confirmed_at set, no poster review).
      // Wrapped in try/catch so a failure here (e.g. column not on prod yet)
      // degrades gracefully — the application still lands, the job just needs
      // manual poster acceptance. The `helper_confirmed_at` column is NOT
      // instant_book-specific; it's the same field set in handleHelperResponse.
      if (isInstantBook) {
        try {
          const confirmedAt = new Date().toISOString();
          await supabase
            .from("jobs")
            .update({ helper_confirmed_at: confirmedAt, helper_id: helperId, status: "accepted" as const, response_deadline: null })
            .eq("id", jobId);
        } catch {
          // Best-effort — apply still landed.
        }
      }
    },
    onMutate: async ({ jobId, helperId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.context(helperId) });
      const previousContext = queryClient.getQueryData(queryKeys.dashboard.context(helperId));
      // Optimistically widen appliedJobIds so the feed filter drops this
      // job from every loaded page of the infinite query immediately.
      queryClient.setQueryData(queryKeys.dashboard.context(helperId), (prev: any) => {
        if (!prev) return prev;
        const nextApplied = new Set<string>(prev.appliedJobIds ?? []);
        nextApplied.add(jobId);
        return { ...prev, appliedJobIds: nextApplied };
      });
      return { previousContext, userId: helperId };
    },
    onError: (err, vars, context) => {
      hapticError();
      // Roll the appliedJobIds set back so the card re-appears in the feed.
      if (context) {
        queryClient.setQueryData(queryKeys.dashboard.context(context.userId), context.previousContext);
      }
      const code = (err as { code?: string } | null)?.code;
      if (code === "23505") {
        toast.error("You've already applied.");
      } else if (code === "UPLOAD_FAILED") {
        // Upload errors are usually a flaky-network attachment — Retry is
        // genuinely useful here. The mutation already rolled back the
        // appliedJobIds set, so the apply is in a clean state to re-run.
        errorToast(err.message, {
          onRetry: () => applyMutation.mutate(vars),
        });
      } else if (code === "RATE_LIMITED") {
        // Use the warm, window-specific message from applyRateLimit.
        // No retry — by definition the user has to wait the window out.
        toast.error(err.message);
      } else {
        errorToast("Couldn't send your application through", {
          description: "Tap retry to try again.",
          onRetry: () => applyMutation.mutate(vars),
        });
      }
    },
    onSuccess: async (_data, vars) => {
      hapticSuccess();
      // First job action recorded — gates the deferred notification
      // permission prompt (`useNotificationPermissionPrompt`). The
      // helper is idempotent, so this is safe even on the 100th apply.
      recordJobActionForPermissionPrompt();
      // Funnel: track first application separately for activation analysis.
      track(AhaEvent.JobApplied, { job_id: vars.jobId, instant_book: vars.isInstantBook ?? false });
      const { count } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("helper_id", vars.helperId);
      if ((count ?? 0) <= 1) track(AhaEvent.FirstJobApplication, { job_id: vars.jobId });
      if (vars.isInstantBook) {
        toast.success("You're booked! Check My Jobs for details.", {
          action: { label: "View", onClick: () => navigate("/my-jobs") },
        });
      } else {
        toast.success("Application sent! Track it in My Jobs.", {
          action: { label: "View", onClick: () => navigate("/my-jobs") },
        });
      }
    },
    onSettled: async (_data, _err, vars) => {
      // Reconcile against the server now that the optimistic state has
      // either been confirmed or rolled back. Predicate match catches
      // ["dashboardJobs", userId], ["applications", ...], ["jobs", jobId],
      // etc. without needing every caller to know the exact shape.
      await queryClient.invalidateQueries({
        predicate: (q: Query) => {
          const k = q.queryKey?.[0];
          return k === "dashboardJobs"
            || k === "dashboardContext"
            || k === "applications"
            || k === "jobs"
            || k === "activity";
        },
      });
      void vars;
    },
  });

  const handleApplyConfirm = useCallback(() => {
    if (!user || !confirmApplyJobId || applyLoading) return;
    const jobId = confirmApplyJobId;
    const files = applyFiles;
    const message = applyMessage;
    // Read the instant_book flag from the job in the feed. Cast through
    // `any` because EnrichedJob predates this column; the DB default is
    // false so a missing key is treated the same way.
    const isInstantBook = !!(confirmApplyJob as any)?.instant_book;
    // Capture proposed price for bid-mode jobs (accept_bids pricing_mode).
    const isBidJob = (confirmApplyJob as any)?.pricing_mode === "accept_bids";
    const proposedPrice = isBidJob && bidPrice ? parseFloat(bidPrice) : null;
    // Close the dialog + reset its state synchronously so the next paint
    // already has the optimistic feed. The mutation continues in the
    // background; React Query's onError rolls things back on failure.
    setConfirmApplyJobId(null);
    setApplyMessage("");
    setApplyFiles([]);
    setBidPrice("");
    const stakeAmt = stakeAmount;
    setStakeAmount(null);
    // setApplyLoading flips off on settled (handled below) — we still
    // set it true here so a fast double-tap can't enqueue twice.
    setApplyLoading(true);
    applyMutation.mutate(
      { jobId, helperId: user.id, message, files, stakeAmt, isInstantBook, proposedPrice },
      { onSettled: () => setApplyLoading(false) },
    );
  }, [user, confirmApplyJobId, confirmApplyJob, applyLoading, applyFiles, applyMessage, stakeAmount, bidPrice, setBidPrice, applyMutation]);

  // JIT verify handlers. Both paths (Verify + Later) flip has_applied_before
  // so the nudge never shows again. "Later" also records 'prompted' status
  // so we know the user saw the sheet, then proceeds with the application.
  const handleJitVerifyProceed = useCallback(async (goVerify: boolean) => {
    setJitVerifyOpen(false);
    const jobId = pendingJobIdForVerify;
    setPendingJobIdForVerify(null);
    // Update profile flags in the background — non-blocking. Fall back
    // gracefully if the columns aren't in prod yet (PGRST202).
    if (user) {
      supabase
        .from("profiles")
        .update({
          has_applied_before: true,
          id_verification_status: goVerify ? "submitted" : "prompted",
        })
        .eq("user_id", user.id)
        .then(({ error }) => {
          if (error && (error as { code?: string }).code !== "PGRST202") {
            // Non-fatal — just observe.
          }
        });
    }
    if (goVerify) {
      navigate("/profile");
      return;
    }
    // "Later" — proceed with the application.
    if (jobId) setConfirmApplyJobId(jobId);
  }, [user, pendingJobIdForVerify, navigate]);

  const handleDismissRequest = useCallback((jobId: string) => {
    setConfirmDismissJobId(jobId);
  }, []);

  const handleLongPressCard = useCallback((jobId: string) => {
    setQuickActionJobId(jobId);
  }, []);

  // Open a job detail dialog while snapshotting the feed's scroll position
  // so it can be restored when the dialog closes (see closeDetailJob).
  // Accepts a setter-style arg matching React.Dispatch so the
  // BrowseTasksFeed prop signature (Dispatch<SetStateAction<...>>) keeps
  // its existing call sites untouched.
  const openDetailJob = useCallback((value: SetStateAction<EnrichedJob | null>) => {
    const el = containerRef.current;
    if (el) detailScrollSnapshotRef.current = el.scrollTop;
    setDetailJob(value);
  }, [containerRef]);

  // Close the detail dialog and restore the feed scroll position captured
  // at open time. We restore after a microtask to outlast any layout-shift
  // the closing dialog might cause, and clear the snapshot so a future
  // open captures a fresh value.
  const closeDetailJob = useCallback(() => {
    setDetailJob(null);
    const snapshot = detailScrollSnapshotRef.current;
    detailScrollSnapshotRef.current = null;
    if (snapshot == null) return;
    // Two rAFs: first lets React commit the dialog-close, second runs
    // after the browser paints so the restored scrollTop sticks.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (el) el.scrollTop = snapshot;
      });
    });
  }, [containerRef]);

  const handleDismissConfirm = useCallback(() => {
    if (!confirmDismissJobId) return;
    setDismissedJobIds(prev => {
      const next = new Set(prev);
      next.add(confirmDismissJobId);
      safeStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...next]));
      return next;
    });
    toast.success("Job removed from your feed.");
    setConfirmDismissJobId(null);
  }, [confirmDismissJobId]);

  if (loading) {
    // Loading state mirrors the *exact* loaded layout: the same
    // PageScaffold two-card shell (greeting title card over a raised
    // panel) with skeleton bodies, not a bare AppShell + stack of cards.
    // Sharing the scaffold means the title card and panel keep their
    // size and position, so when the data resolves the greeting and feed
    // settle in place instead of popping in and shoving the feed down.
    return (
      <PageScaffold
        animate
        panelElevation="raised"
        header={<DashboardHeader />}
        titleCard={<DashboardTitleSkeleton />}
      >
        <DashboardSkeleton />
      </PageScaffold>
    );
  }

  // Prefer the profile's stored full name, then auth metadata, then the email
  // local-part — never fall back to the literal word "User" in greetings.
  const rawName =
    (profile?.full_name && profile.full_name.trim()) ||
    (user?.user_metadata?.full_name && String(user.user_metadata.full_name).trim()) ||
    (user?.user_metadata?.name && String(user.user_metadata.name).trim()) ||
    "";
  const emailLocal = user?.email ? user.email.split("@")[0] : "";
  const firstName = (rawName || emailLocal || "there").split(" ")[0];
  const approvalStatus = profile?.approval_status;
  const banStatus = profile?.ban_status || "active";

  // Block banned users
  if (!isAdmin && (banStatus === "permanently_banned" || banStatus === "temp_banned")) {
    // `/dashboard` is a fixed-shell route; an inline `min-h-screen`
    // would be clipped by html.app-shell's overflow:hidden. AppShell
    // gives this short message a 100dvh container with an internal
    // scroll surface so the text never escapes the viewport.
    return (
      <AppShell reserveBottomNav={false} className="bg-premium-page">
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
            <h1 className="text-page-title text-foreground text-ds-24">
              Account {banStatus === "permanently_banned" ? "Permanently Banned" : "Temporarily Suspended"}
            </h1>
            <p className="text-muted-foreground">
              {banStatus === "permanently_banned"
                ? "Your account has been permanently banned for violating platform rules. Contact support if you believe this is an error."
                : "Your account has been temporarily suspended. You'll regain access once the suspension period ends."}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  // Progressive activation: a `pending` user is NOT walled out of the
  // dashboard. They can browse, save and apply while review runs — the
  // verification gate fires only at the moments that genuinely need it
  // (IDV-before-accept in Activity.tsx, payout setup). A non-blocking
  // "under review" banner is rendered in `beforePanel` below instead.
  //
  // `denied` is still a hard stop here as defense-in-depth — ProtectedRoute
  // already redirects denied users to /account-denied before this renders,
  // but if that ever fails to fire we must not leak the feed to them.
  if (!isAdmin && profile && approvalStatus === "denied") {
    const handleSignOut = async () => {
      await supabase.auth.signOut();
      navigate("/login", { replace: true });
    };
    // `/dashboard` is a fixed-shell route — wrap in AppShell so the
    // DashboardHeader carries the safe-area-top inset and the body
    // never spills past html.app-shell's overflow:hidden.
    return (
      <AppShell header={<DashboardHeader />} reserveBottomNav={false} className="bg-premium-page">
        <main className="container mx-auto px-5 py-12">
          <div className="max-w-lg mx-auto text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto"><XCircle className="w-8 h-8 text-destructive" /></div>
            <h1 className="text-page-title text-foreground text-ds-24">Profile not approved</h1>
            <p className="text-muted-foreground">Unfortunately, your profile was not approved. Please contact support.</p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" onClick={handleSignOut} className="rounded-ds-md">
                Sign out
              </Button>
            </div>
          </div>
        </main>
      </AppShell>
    );
  }

  const isPendingReview = !isAdmin && !!profile && approvalStatus === "pending";



  return (
    <>
    <PageScaffold
      animate
      panelElevation="raised"
      header={
        <>
          <DashboardHeader />
          <Suspense fallback={null}>
            <BirthdayPopup dateOfBirth={profile?.date_of_birth} firstName={firstName} />
          </Suspense>
        </>
      }
      aboveTitle={<BroadcastBanner />}
      titleCard={
        <>
            {/* Condensed greeting — the greeting + date eyebrow are folded
                into one tight two-line block (greeting line + a small
                date·jobs eyebrow). The greeting was its own tall line that
                pushed the feed down; the old standalone "stat of the day"
                paragraph (a 3rd line) is dropped — the job count it echoed
                already appears in the eyebrow below. */}
            {/* Canonical page title — same hero size as the Messages /
                Posts / Jobs headers (`.text-page-title`) so the greeting
                matches those tabs exactly. */}
            <h1 className="text-page-title">
              {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"},{" "}
              <em className="signature" style={{ fontStyle: "normal", color: "hsl(var(--burnt-sienna))" }}>{firstName}</em>.
            </h1>
            <p
              className="mt-1 truncate font-sans font-semibold uppercase"
              style={{
                fontSize: "0.62rem",
                letterSpacing: "0.16em",
                color: "hsl(var(--olivewood) / 0.55)",
              }}
            >
              {/* Full date so the eyebrow is informative even when no jobs
                  are nearby (avoids triple "0 jobs" redundancy across the
                  greeting eyebrow, Browse-Tasks header, and empty-state
                  card on quiet days). Job count only appears when > 0. */}
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {filters.filteredJobs.length > 0 && (
                <>
                  {" · "}
                  {filters.filteredJobs.length} {filters.filteredJobs.length === 1 ? "job" : "jobs"} nearby
                  {recommendedJobs.length > 0 && ` · ${recommendedJobs.length} picked for you`}
                </>
              )}
              {/* Stale-while-revalidate signal — a tiny pulsing dot + tag
                  shows up only while a background refetch runs on top of
                  cached data. Proof the feed is syncing without blanking
                  the surface. Hidden during the first load (the skeleton
                  already speaks for that). */}
              {isRefreshing && (
                <span
                  className="ml-2 inline-flex items-center gap-1 normal-case"
                  style={{ letterSpacing: "0.08em" }}
                  aria-live="polite"
                >
                  <span
                    aria-hidden
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: "hsl(var(--burnt-sienna))" }}
                  />
                  <span style={{ color: "hsl(var(--burnt-sienna) / 0.85)" }}>
                    Updating
                  </span>
                </span>
              )}
            </p>
            {/* "Watching for" chip — only shown when 0 jobs nearby and
                the user has an active saved search. Reframes the empty
                state as intentional rather than confusing. */}
            {filters.filteredJobs.length === 0 && topSavedSearch && (
              // Wrapped in a min-w-0 flex container so a long saved-search
              // name truncates instead of forcing the title card wider
              // than its column at large Dynamic Type sizes.
              <div className="mt-2 flex min-w-0 max-w-full">
                <button
                  type="button"
                  onClick={() => navigate("/profile?tab=notifications")}
                  className="inline-flex min-h-[36px] min-w-0 max-w-full items-center gap-1.5 px-3 py-1.5 rounded-full active:opacity-70 transition-opacity"
                  style={{
                    background: "hsl(var(--burnt-sienna) / 0.10)",
                    border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
                  }}
                >
                  <Search className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.25} />
                  <span
                    className="text-[0.7rem] font-sans font-semibold tracking-wide truncate min-w-0"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  >
                    Watching for: {topSavedSearch.name}
                  </span>
                </button>
              </div>
            )}
        </>
      }
      beforePanel={
        <>
          {/* Progressive-activation banner — a pending user can browse,
              save and apply right now; this is a non-blocking progress
              strip, not a wall. Tapping opens the verification center
              (/account-pending) where they can track review status. */}
          {isPendingReview && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="liquid-glass shrink-0 px-4 py-3 flex items-start gap-3"
              style={{
                background:
                  "radial-gradient(70% 90% at 100% 0%, hsl(var(--bark) / 0.10) 0%, transparent 55%)",
                border: "0.5px solid hsl(var(--bark) / 0.32)",
              }}
            >
              <div
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: "hsl(var(--bark) / 0.18)", color: "hsl(var(--bark))" }}
              >
                <Clock className="w-4 h-4" strokeWidth={2.25} />
              </div>
              <button
                type="button"
                onClick={() => navigate("/account-pending")}
                className="flex-1 text-left min-w-0 active:opacity-70 transition-opacity"
              >
                <p className="font-display italic font-bold leading-tight" style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}>
                  Verification in progress — browse and apply now.
                </p>
                <p className="font-serif italic mt-0.5" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.75)" }}>
                  Review usually finishes in 24–48 hours. You'll just need it cleared before you can accept a job. Tap to track status.
                </p>
              </button>
            </motion.div>
          )}

          {/* Quick-rebook strip — the customer's saved helprs, one tap
              from a direct offer. Self-hides when there are none.
              Wrapped in a SectionBoundary so a flaky `saved_helpers`
              query can't red-screen the whole Dashboard tab. */}
          <SectionBoundary label="your helpers">
            <YourHelpersRow />
          </SectionBoundary>
          {/* The "Finish your profile" completion nudge used to render
              here. It moved off the home feed onto the Profile landing
              screen (ProfileLanding's completion meter) so the job feed
              is no longer pushed below the fold. */}

          {/* Life-event trigger — personalized prompt, shown above storm banner
              (more contextual). Max 1 at a time. Dismisses via localStorage. */}
          {activeTrigger && (
            <LifeEventCard
              trigger={activeTrigger}
              onDismiss={() => setLifeEventDismissedAt(Date.now())}
            />
          )}

          {/* Home-autopilot reminder — surfaces the most-overdue maintenance
              task when one is due within the next 7 days. Table degrades
              gracefully before the migration is pushed (returns empty). */}
          {topReminder && (
            <AutopilotReminderCard
              reminder={topReminder}
              onDismiss={() => {
                // Mark locally dismissed by removing from the list until next load
                supabase
                  .from("home_maintenance_reminders")
                  .update({ is_active: false })
                  .eq("id", topReminder.id)
                  .then(() => {});
              }}
              onPostJob={(category) => navigate(`/post-job?category=${category}`)}
            />
          )}

          {/* Hurricane season banner — June–Nov only, dismissible for the day. */}
          {showStormBanner && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="shrink-0 mx-4 mb-1 rounded-ds-md p-3 flex items-center gap-2.5"
              style={{
                background: "hsl(210 25% 15% / 0.85)",
                border: "0.5px solid hsl(210 25% 40% / 0.4)",
                backdropFilter: "blur(12px)",
              }}
            >
              <CloudLightning className="shrink-0 w-5 h-5" style={{ color: "hsl(210 60% 70%)" }} strokeWidth={2} />
              <div className="flex-1 min-w-0">
                <p className="font-display italic font-semibold text-ds-13 leading-tight" style={{ color: "hsl(210 30% 90%)" }}>
                  Hurricane season is active
                </p>
                <p className="font-serif italic text-ds-11 leading-tight mt-0.5" style={{ color: "hsl(210 20% 70%)" }}>
                  Post storm prep work · helpers are ready
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStormBannerDismissed(true);
                  try { safeStorage.setItem("storm-banner-dismissed", new Date().toDateString()); } catch { /* ignore */ }
                }}
                aria-label="Dismiss hurricane season banner"
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full active:opacity-70 hover:bg-white/[0.08]"
                style={{ color: "hsl(210 20% 60%)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* Inactive subscriber nudge — gentle reminder for paid helpers
              who haven't applied in 7+ days. Dismissible per-session. */}
          {inactiveNudge && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="liquid-glass shrink-0 px-4 py-3 flex items-start gap-3"
              style={{
                background:
                  "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.10) 0%, transparent 55%)",
                border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
              }}
            >
              <Star className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.25} fill="currentColor" />
              <div className="flex-1 min-w-0">
                <p className="font-display italic font-bold leading-tight" style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}>
                  Your subscription pays for itself when you apply.
                </p>
                <p className="font-serif italic mt-0.5" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.75)" }}>
                  Plenty of work nearby — see what's open below.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInactiveNudgeDismissed(true)}
                aria-label="Dismiss"
                className="shrink-0 -mt-1 -mr-1 w-9 h-9 flex items-center justify-center rounded-full active:opacity-70 hover:bg-black/[0.04]"
                style={{ color: "hsl(var(--olivewood) / 0.55)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* Early-access upsell — free-tier helpers see this once.
              Explains that Pro/Elite subscribers get a 10-minute head
              start on new jobs. Dismissible to localStorage. */}
          {showEarlyAccessBanner && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="shrink-0 mx-4 mb-1 rounded-ds-md px-3 py-2.5 flex items-center gap-2.5"
              style={{
                background: "hsl(var(--bark) / 0.07)",
                border: "0.5px solid hsl(var(--bark) / 0.20)",
              }}
            >
              <Clock className="shrink-0 w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={2} />
              <p className="flex-1 font-serif italic text-ds-12 leading-snug min-w-0" style={{ color: "hsl(var(--ink-deep) / 0.80)" }}>
                Pro helpers see new jobs 10 min sooner{" "}
                <button
                  type="button"
                  onClick={() => navigate("/subscription")}
                  className="font-sans font-semibold not-italic underline underline-offset-2 active:opacity-70"
                  style={{ color: "hsl(var(--bark))" }}
                >
                  Learn more →
                </button>
              </p>
              <button
                type="button"
                onClick={() => {
                  setEarlyAccessBannerDismissed(true);
                  try { safeStorage.setItem("early-access-banner-dismissed", "1"); } catch { /* ignore */ }
                }}
                aria-label="Dismiss early access banner"
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full active:opacity-70 hover:bg-black/[0.04]"
                style={{ color: "hsl(var(--olivewood) / 0.55)" }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </>
      }
    >
            {/* Personalized "For you" recommendations — shown only to
                approved helpers so pending/denied users don't see it.
                Hides itself when the query returns 0 results or errors. */}
            {approvalStatus === "approved" && (
              <SectionBoundary label="jobs for you">
                <JobsForYou
                  userId={user?.id}
                  profile={profile}
                  effectiveFee={effectiveFee}
                />
              </SectionBoundary>
            )}

            <BrowseTasksToolbar
              filters={filters}
              user={user}
              helperAvailability={helperAvailability}
              view={view}
              setView={setView}
              density={density}
              setDensity={setDensity}
              onClearAllFilters={() => {
                // After clearing filters, snap the feed back to the top
                // so the user lands on the fresh unfiltered head of the
                // list rather than mid-scroll where the old filter ended.
                const el = containerRef.current;
                if (el) el.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />

            {/* Browse-tasks feed is the main scroll surface of the
                dashboard. Wrap so a render error in any job card (rare,
                but cheap insurance) shows an inline retry banner inside
                the panel rather than blanking the entire route. The
                page-level ErrorBoundary above still catches anything
                that escapes this. */}
            <SectionBoundary label="the job feed">
              {/* Split-screen layout on lg+ viewports: job list (420px
                  fixed left) + Leaflet map (right). Completely hidden on
                  mobile — no layout changes touch the Capacitor native
                  app which is always <1024px. */}
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex-1 lg:w-[420px] lg:flex-none lg:border-r lg:border-[hsl(var(--olivewood)/0.1)] min-w-0 overflow-hidden flex flex-col">
                  <BrowseTasksFeed
                    view={view}
                    density={density}
                    filters={filters}
                    user={user}
                    allJobs={allJobs}
                    loadError={loadError}
                    refresh={refresh}
                    recommendedJobs={recommendedJobs}
                    // Reserve the "Picked for you" slot with skeletons while a feed
                    // fetch is in flight and no picks exist yet — recommendations are
                    // derived from loaded pages, so they can arrive a beat after the
                    // feed itself (refresh / next-page), and the empty→filled swap
                    // would otherwise shove the list down (CLS).
                    recommendedLoading={refreshing || isFetchingNextPage}
                    dismissedJobIds={dismissedJobIds}
                    effectiveFee={effectiveFee}
                    handleApplyRequest={handleApplyRequest}
                    handleDismissRequest={handleDismissRequest}
                    handleToggleSave={handleToggleSave}
                    handleLongPressCard={handleLongPressCard}
                    confirmDismissJobId={confirmDismissJobId}
                    expandedCardId={expandedCardId}
                    setExpandedCardId={setExpandedCardId}
                    savedJobIds={savedJobIds}
                    setReportJobId={setReportJobId}
                    setDetailJob={openDetailJob}
                    containerRef={containerRef}
                    pullDistance={pullDistance}
                    refreshing={refreshing}
                    isPulling={isPulling}
                    loadMoreRef={loadMoreRef}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                    hoveredJobId={hoveredJobId}
                    setHoveredJobId={setHoveredJobId}
                  />
                </div>
                {/* Map panel — desktop only. Lazy-loaded so the Leaflet
                    bundle isn't paid for by mobile users. */}
                <div className="hidden lg:flex lg:flex-1 lg:relative min-h-0">
                  <Suspense fallback={<div className="flex-1 bg-muted/20 animate-pulse" />}>
                    <JobMapView
                      jobs={filters.filteredJobs}
                      hoveredJobId={hoveredJobId}
                      onJobClick={openDetailJob}
                    />
                  </Suspense>
                </div>
              </div>
            </SectionBoundary>

            {/* Pay It Forward teaser — only shown when credits exist in the user's parish */}
            {pifCount > 0 && (
              <div
                className="mx-4 mb-3 rounded-ds-md p-3"
                style={{
                  background: "hsl(155 50% 35% / 0.08)",
                  border: "0.5px solid hsl(155 50% 35% / 0.2)",
                }}
              >
                <p
                  className="font-display italic font-semibold text-ds-14"
                  style={{ color: "hsl(155 50% 30%)" }}
                >
                  {pifCount} neighbor{pifCount > 1 ? "s" : ""} paid it forward
                </p>
                <p
                  className="font-serif italic text-ds-12 mt-0.5"
                  style={{ color: "hsl(155 40% 40%)" }}
                >
                  Free job credits available in your parish ·{" "}
                  <Link to="/pay-it-forward" className="underline">
                    See them
                  </Link>
                </p>
              </div>
            )}

            {/* Community teaser — surfaces the feed from the Dashboard so
                users discover it without a new nav tab. Shows up at the
                bottom of the scroll surface, below all job cards. */}
            <div className="px-1 pt-2 pb-4">
              <button
                type="button"
                onClick={() => navigate("/community")}
                className="w-full rounded-ds-sm px-4 py-4 flex items-center gap-3 active:opacity-75 transition-opacity text-left"
                style={{
                  background:
                    "radial-gradient(120% 120% at 20% 20%, hsl(var(--bark) / 0.14) 0%, hsl(45 36% 90% / 0.35) 60%, hsl(var(--parchment) / 0.25) 100%)",
                  border: "0.5px solid hsl(var(--bark) / 0.28)",
                }}
              >
                <span
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ background: "hsl(var(--bark) / 0.18)", fontSize: "1.1rem" }}
                  aria-hidden
                >
                  🏘️
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className="font-display italic font-bold leading-tight"
                    style={{ fontSize: "0.9rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                  >
                    Community feed
                  </p>
                  <p
                    className="font-serif italic mt-0.5 truncate"
                    style={{ fontSize: "0.75rem", color: "hsl(var(--olivewood) / 0.70)" }}
                  >
                    Before &amp; afters, milestones, helper spotlights.
                  </p>
                </div>
                <span style={{ color: "hsl(var(--olivewood) / 0.45)", fontSize: "0.85rem" }}>›</span>
              </button>
            </div>
    </PageScaffold>

      {/* Dialog chunks load on demand — only mounted once the user opens
          them, so the Dashboard route chunk doesn't carry them. */}
      {detailJob && (
        <Suspense fallback={null}>
          <JobDetailDialog
            job={detailJob}
            effectiveFee={effectiveFee}
            allJobs={allJobs}
            isSaved={detailJob ? savedJobIds.has(detailJob.id) : false}
            onToggleSave={handleToggleSave}
            userLat={filters.userLoc?.status === "ready" ? filters.userLoc.lat : null}
            userLng={filters.userLoc?.status === "ready" ? filters.userLoc.lng : null}
            onClose={closeDetailJob}
            onApply={handleApplyRequest}
            onReport={setReportJobId}
            onSelect={openDetailJob}
          />
        </Suspense>
      )}

      {reportJobId && (
        <Suspense fallback={null}>
          <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />
        </Suspense>
      )}

      {/* Long-press quick-action sheet. Lazy-loaded so the small extra
          bundle only ships once a helpr actually long-presses a card. */}
      {quickActionJobId && (() => {
        const qaJob = allJobs.find((j) => j.id === quickActionJobId);
        if (!qaJob) return null;
        return (
          <Suspense fallback={null}>
            <JobQuickActionSheet
              job={{ id: qaJob.id, title: qaJob.title, budget: qaJob.budget, category: qaJob.category }}
              isSaved={savedJobIds.has(qaJob.id)}
              onClose={() => setQuickActionJobId(null)}
              onToggleSave={handleToggleSave}
              onHide={handleDismissRequest}
              onReport={setReportJobId}
            />
          </Suspense>
        );
      })()}

      <Suspense fallback={null}>
        <OnboardingTour profileCreatedAt={profile?.created_at} />
      </Suspense>
      <QuickApplyHandler searchParams={searchParams} user={user} allJobs={allJobs} onApply={handleApplyRequest} />


      {confirmApplyJobId && (
        <Suspense fallback={null}>
          <ApplyConfirmDialog
            open={!!confirmApplyJobId}
            onClose={() => setConfirmApplyJobId(null)}
            confirmApplyJob={confirmApplyJob}
            platformFee={platformFee}
            applyMessage={applyMessage}
            setApplyMessage={setApplyMessage}
            applyFiles={applyFiles}
            setApplyFiles={setApplyFiles}
            applyLoading={applyLoading}
            stakeAmount={stakeAmount}
            setStakeAmount={setStakeAmount}
            bidPrice={bidPrice}
            setBidPrice={setBidPrice}
            handleApplyConfirm={handleApplyConfirm}
          />
        </Suspense>
      )}

      <AlertDialog open={!!confirmDismissJobId} onOpenChange={(open) => { if (!open) setConfirmDismissJobId(null); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg rounded-ds-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-ds-15 sm:text-ds-17">Not interested?</AlertDialogTitle>
            <AlertDialogDescription className="text-ds-13">
              {confirmDismissJob
                ? <>Remove <span className="font-semibold text-foreground">"{confirmDismissJob.title}"</span> from your feed? You won't see it again.</>
                : "Remove this job from your feed?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 sm:gap-2">
            <AlertDialogCancel className="mt-0 h-9 px-3 text-ds-13">Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDismissConfirm} className="h-9 px-3 text-ds-13 bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {payoutSetupDialogOpen && (
        <Suspense fallback={null}>
          <PayoutSetupDialog open={payoutSetupDialogOpen} onOpenChange={setPayoutSetupDialogOpen} />
        </Suspense>
      )}

      {/* JIT verify nudge — shown once on the helper's very first Apply tap.
          Soft nudge only; "I'll do this later" still proceeds with the
          application. The sheet is lazy-loaded because it's only needed once
          per lifetime per account. */}
      {jitVerifyOpen && (
        <Suspense fallback={null}>
          <JitVerifySheet
            open={jitVerifyOpen}
            onVerify={() => handleJitVerifyProceed(true)}
            onLater={() => handleJitVerifyProceed(false)}
          />
        </Suspense>
      )}

      {/* Floating-FAB removed — MobileNav already renders a Post FAB at the
          right edge of the bottom dock. Two FABs at the same screen corner
          was the "stacked plus buttons" bug visible in TestFlight build
          screenshots. Desktop surfaces the CTA in the header (md:flex)
          so no desktop replacement is needed. */}

      {/* First-run welcome modal — lazy-loaded; only mounts for new users
          (accounts < 7 days) who haven't dismissed it yet. Dismissed state
          persists to localStorage so it never shows again after first close. */}
      {showWelcome && (
        <Suspense fallback={null}>
          <WelcomeModal open={showWelcome} onDismiss={handleWelcomeDismiss} />
        </Suspense>
      )}
    </>
  );
};

export default Dashboard;
