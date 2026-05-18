import { useState, useCallback, useEffect, useMemo, useRef } from "react";

import { motion } from "framer-motion";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock, XCircle, Star, X, Search } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import OnboardingTour from "@/components/OnboardingTour";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import JobDetailDialog from "@/components/dashboard/JobDetailDialog";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";
import { ApplyConfirmDialog } from "@/components/dashboard/ApplyConfirmDialog";
import BroadcastBanner from "@/components/BroadcastBanner";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";

import PayoutSetupDialog from "@/components/PayoutSetupDialog";


import BirthdayPopup from "@/components/BirthdayPopup";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useDashboardData } from "@/hooks/useDashboardData";
import { usePrefetchUserData } from "@/hooks/usePrefetchUserData";
import { track, AhaEvent } from "@/lib/analytics";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { safeStorage } from "@/lib/safeStorage";
import { usePersistedBrowseView } from "@/hooks/usePersistedBrowseView";
import { getProfileCompletion } from "@/lib/profileCompletion";

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
    helperAvailability, recommendedJobs, refresh, loadError,
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

  // Stat of the day — rotates one data point under the greeting eyebrow so
  // the card feels alive. Picks deterministically by date so the same user
  // sees the same stat for the day (no flicker). Memoized so the several
  // .filter passes don't rerun on every unrelated render.
  const statOfTheDay = useMemo(() => {
    const stats: string[] = [];
    if (recommendedJobs.length > 0) {
      stats.push(`${recommendedJobs.length} match${recommendedJobs.length === 1 ? "" : "es"} picked just for you today.`);
    }
    if (filters.filteredJobs.length >= 5) {
      stats.push(`${filters.filteredJobs.length} open jobs nearby — busiest day in a while.`);
    }
    const recentUrgent = filters.filteredJobs.filter((j) => j.is_urgent).length;
    if (recentUrgent > 0) {
      stats.push(`${recentUrgent} urgent job${recentUrgent === 1 ? "" : "s"} in the feed right now.`);
    }
    const recentHigh = filters.filteredJobs.filter((j) => j.budget >= 100).length;
    if (recentHigh > 0) {
      stats.push(`${recentHigh} job${recentHigh === 1 ? "" : "s"} paying $100+ today.`);
    }
    if (stats.length === 0) return null;
    const dayIdx = Math.floor(Date.now() / 86400000) % stats.length;
    return stats[dayIdx];
  }, [recommendedJobs.length, filters.filteredJobs]);

  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // List vs Map view. The map shows the same open jobs as the list,
  // pinned to neighborhood-rounded coords (privacy via the
  // get_open_jobs_for_map RPC). Toggle persists for the session only —
  // resetting to "list" on next mount matches user expectation that
  // the default landing surface is the curated feed.
  const [view, setView] = usePersistedBrowseView("list");
  const [confirmApplyJobId, setConfirmApplyJobId] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyFiles, setApplyFiles] = useState<File[]>([]);
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
    queryKey: ["savedSearches", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_searches")
        .select("name")
        .eq("user_id", user!.id)
        .eq("notify_enabled", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? { name: data.name } : null;
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  // Profile completion nudge — gentle banner shown until the user
  // finishes the post-signup profile enhancements (ZIP / ID
  // verification / work photos). Uses the shared getProfileCompletion
  // helper. Dismissible per-session so it doesn't follow them around.
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const completionPct = profile
    ? getProfileCompletion({
        zipCode: profile.zip_code,
        idvStatus: profile.idv_status,
        portfolioCount: Array.isArray(profile.portfolio_urls)
          ? profile.portfolio_urls.length
          : 0,
      }).pct
    : 100;

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
  const { data: lastApplicationAt } = useQuery({
    queryKey: ["lastApplication", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("applications")
        .select("created_at")
        .eq("helper_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
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
    queryKey: ["savedJobs", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_jobs")
        .select("job_id")
        .eq("user_id", user!.id);
      return (data ?? []).map((d: { job_id: string }) => d.job_id);
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });
  useEffect(() => {
    if (savedJobsData) setSavedJobIds(new Set(savedJobsData));
  }, [savedJobsData]);

  const handleToggleSave = useCallback((jobId: string, saved: boolean) => {
    setSavedJobIds(prev => {
      const next = new Set(prev);
      if (saved) next.add(jobId); else next.delete(jobId);
      return next;
    });
  }, []);
  const handleApplyRequest = useCallback(async (jobId: string) => {
    hapticMedium(); // confirm tap on Apply
    if (!user) { navigate("/login"); return; }
    const job = allJobs.find((j) => j.id === jobId);
    if (job && job.customer_id === user.id) { toast.error("You can't apply to your own post."); return; }
    // Apply has no gate — Stripe Connect payout setup + IDV both fire at
    // first Accept (see Activity.tsx → handleHelperResponse). Applying
    // is just expressing interest; no need to make users set up payouts
    // for jobs they may never win.
    setConfirmApplyJobId(jobId);
  }, [user, allJobs, navigate]);

  const handleApplyConfirm = useCallback(async () => {
    if (!user || !confirmApplyJobId || applyLoading) return;
    setApplyLoading(true);

    // Note: payout-account setup is NOT required to apply. It is only enforced
    // at job-acceptance time (see Activity.tsx → handleHelperResponse).

    // Upload attachments (store storage paths; resolve signed URLs at view time)
    const attachmentUrls: string[] = [];
    if (applyFiles.length > 0) {
      for (const file of applyFiles) {
        const ext = file.name.split('.').pop();
        const path = `${user.id}/${confirmApplyJobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("application-attachments").upload(path, file);
        if (uploadErr) {
          toast.error(`Failed to upload ${file.name}`);
          setApplyLoading(false);
          return;
        }
        attachmentUrls.push(path);
      }
    }

    const { error } = await supabase.from("applications").insert({
      job_id: confirmApplyJobId,
      helper_id: user.id,
      message: applyMessage.trim() || null,
      attachment_urls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
    });
    if (error) {
      hapticError();
      if (error.code === "23505") toast.error("You've already applied.");
      else toast.error(error.message);
    } else {
      hapticSuccess();
      // Funnel: track first application separately for activation analysis
      track(AhaEvent.JobApplied, { job_id: confirmApplyJobId });
      const { count } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("helper_id", user.id);
      if ((count ?? 0) <= 1) track(AhaEvent.FirstJobApplication, { job_id: confirmApplyJobId });
      toast.success("Application sent! Track it in My Jobs.", {
        action: { label: "View", onClick: () => navigate("/my-jobs") },
      });
      // Invalidate every cache that may show this job/application so any open
      // screen (Dashboard, My Jobs, future Activity-as-Query) updates in sync.
      // Predicate match catches keys like ["dashboardJobs", userId],
      // ["applications", ...], ["jobs", jobId], etc. without needing each
      // caller to know the exact shape.
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
    }
    setConfirmApplyJobId(null);
    setApplyLoading(false);
    setApplyMessage("");
    setApplyFiles([]);
  }, [user, confirmApplyJobId, navigate, queryClient, profile, applyLoading, applyFiles, applyMessage]);

  const handleDismissRequest = useCallback((jobId: string) => {
    setConfirmDismissJobId(jobId);
  }, []);

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
    return (
      <div className="min-h-screen bg-premium-page pb-safe-nav">
        {/* Same DashboardHeader as the loaded state so the header doesn't
            jump in height/styling when the skeleton resolves. */}
        <DashboardHeader />
        <main className="container mx-auto px-5 lg:px-8 xl:px-12 py-4">
          <div className="max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto"><DashboardSkeleton /></div>
        </main>
      </div>
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
    return (
      <div className="min-h-screen bg-premium-page flex items-center justify-center px-4">
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
    );
  }

  if (!isAdmin && profile && approvalStatus !== "approved") {
    const handleCheckStatus = async () => {
      await refresh();
      toast.success("Status refreshed");
    };
    const handleSignOut = async () => {
      await supabase.auth.signOut();
      navigate("/login", { replace: true });
    };
    return (
      <div className="min-h-screen bg-premium-page">
        <DashboardHeader />
        <main className="container mx-auto px-5 py-12">
          <div className="max-w-lg mx-auto text-center space-y-6">
            {approvalStatus === "pending" ? (
              <>
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto"><Clock className="w-8 h-8 text-primary" /></div>
                <h1 className="text-page-title text-foreground text-ds-24">Profile under review</h1>
                <p className="text-muted-foreground">Thanks for signing up, {firstName}! Your profile is being reviewed.</p>
                <p className="text-ds-11 text-muted-foreground">
                  We'll let you know as soon as you're approved. This screen updates automatically.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                  <Button onClick={handleCheckStatus} className="rounded-ds-md btn-press">
                    Check status
                  </Button>
                  <Button variant="outline" onClick={handleSignOut} className="rounded-ds-md">
                    Sign out
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto"><XCircle className="w-8 h-8 text-destructive" /></div>
                <h1 className="text-page-title text-foreground text-ds-24">Profile not approved</h1>
                <p className="text-muted-foreground">Unfortunately, your profile was not approved. Please contact support.</p>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button variant="outline" onClick={handleSignOut} className="rounded-ds-md">
                    Sign out
                  </Button>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  

  return (
    <>
    <PageScaffold
      animate
      panelElevation="flat"
      className="animate-in fade-in-0 duration-500"
      header={
        <>
          <DashboardHeader />
          <BirthdayPopup dateOfBirth={profile?.date_of_birth} firstName={firstName} />
        </>
      }
      aboveTitle={
        <>
          <BroadcastBanner />
          <PushNotificationPrompt />
        </>
      }
      titleCard={
        <>
            <h1
              className="font-display font-bold truncate"
              style={{
                fontSize: "clamp(1.5rem, 2vw + 0.5rem, 1.85rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
                // Slightly looser leading + bottom padding to clear the
                // Beth Ellen script descenders ("y", "g", "p" tails)
                // from colliding with the date eyebrow below.
                lineHeight: 1.15,
                paddingBottom: "0.15em",
              }}
            >
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
            </p>
            {/* Stat of the day — see the memoized `statOfTheDay` above. */}
            {filters.filteredJobs.length > 0 && statOfTheDay && (
              <p
                className="mt-2 font-serif italic leading-snug"
                style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.75)" }}
              >
                {statOfTheDay}
              </p>
            )}
            {/* "Watching for" chip — only shown when 0 jobs nearby and
                the user has an active saved search. Reframes the empty
                state as intentional rather than confusing. */}
            {filters.filteredJobs.length === 0 && topSavedSearch && (
              <button
                type="button"
                onClick={() => navigate("/profile?tab=notifications")}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full active:opacity-70 transition-opacity"
                style={{
                  background: "hsl(var(--burnt-sienna) / 0.10)",
                  border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
                }}
              >
                <Search className="w-3 h-3" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.25} />
                <span
                  className="text-[0.7rem] font-sans font-semibold tracking-wide truncate max-w-[200px]"
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                >
                  Watching for: {topSavedSearch.name}
                </span>
              </button>
            )}
        </>
      }
      beforePanel={
        <>
          {/* Profile completion nudge — surfaces when profile is < 60%
              complete. Sits above other banners since posters won't
              respond well to incomplete-looking applicants. Tapping
              routes to Edit Profile. */}
          {profile && completionPct < 80 && !completionDismissed && (() => {
            // Color the banner + chip by progress so the user gets visual
            // momentum as they fill out their profile:
            //   0–59%   → gold-warm (needs attention)
            //   60–79%  → bark      (almost there)
            // The banner hides at 80%; users can finish the last 20% later
            // from Profile → Edit without being nagged.
            const closeToDone = completionPct >= 60;
            const accent = closeToDone ? "var(--bark)" : "var(--gold-warm)";
            return (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="liquid-glass shrink-0 px-4 py-3 flex items-start gap-3"
              style={{
                background:
                  `radial-gradient(70% 90% at 100% 0%, hsl(${accent} / 0.10) 0%, transparent 55%)`,
                border: `0.5px solid hsl(${accent} / 0.32)`,
              }}
            >
              <div
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: `hsl(${accent} / 0.18)`, color: `hsl(${accent})` }}
              >
                <span className="font-display italic font-bold tabular-nums text-[0.78rem]">{completionPct}%</span>
              </div>
              <button
                type="button"
                onClick={() => navigate("/profile?tab=profile")}
                className="flex-1 text-left min-w-0 active:opacity-70 transition-opacity"
              >
                <p className="font-display italic font-bold leading-tight" style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}>
                  Finish your profile to land more jobs.
                </p>
                <p className="font-serif italic mt-0.5" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.75)" }}>
                  Posters skip incomplete profiles — finish in under 3 minutes.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setCompletionDismissed(true)}
                aria-label="Dismiss"
                className="shrink-0 -mt-1 -mr-1 w-9 h-9 flex items-center justify-center rounded-full active:opacity-70 hover:bg-black/[0.04]"
                style={{ color: "hsl(var(--olivewood) / 0.55)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
            );
          })()}

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
        </>
      }
    >
            <BrowseTasksToolbar
              filters={filters}
              user={user}
              helperAvailability={helperAvailability}
              view={view}
              setView={setView}
            />

            <BrowseTasksFeed
              view={view}
              filters={filters}
              user={user}
              allJobs={allJobs}
              loadError={loadError}
              refresh={refresh}
              recommendedJobs={recommendedJobs}
              dismissedJobIds={dismissedJobIds}
              effectiveFee={effectiveFee}
              handleApplyRequest={handleApplyRequest}
              handleDismissRequest={handleDismissRequest}
              handleToggleSave={handleToggleSave}
              confirmDismissJobId={confirmDismissJobId}
              expandedCardId={expandedCardId}
              setExpandedCardId={setExpandedCardId}
              savedJobIds={savedJobIds}
              setReportJobId={setReportJobId}
              setDetailJob={setDetailJob}
              containerRef={containerRef}
              pullDistance={pullDistance}
              refreshing={refreshing}
              isPulling={isPulling}
              loadMoreRef={loadMoreRef}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
            />
    </PageScaffold>

      <JobDetailDialog
        job={detailJob}
        effectiveFee={effectiveFee}
        allJobs={allJobs}
        isSaved={detailJob ? savedJobIds.has(detailJob.id) : false}
        onToggleSave={handleToggleSave}
        userLat={filters.userLoc?.status === "ready" ? filters.userLoc.lat : null}
        userLng={filters.userLoc?.status === "ready" ? filters.userLoc.lng : null}
        onClose={() => setDetailJob(null)}
        onApply={handleApplyRequest}
        onReport={setReportJobId}
        onSelect={setDetailJob}
      />

      {reportJobId && <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />}

      <OnboardingTour profileCreatedAt={profile?.created_at} />
      <QuickApplyHandler searchParams={searchParams} user={user} allJobs={allJobs} onApply={handleApplyRequest} />


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
        handleApplyConfirm={handleApplyConfirm}
      />

      <AlertDialog open={!!confirmDismissJobId} onOpenChange={(open) => { if (!open) setConfirmDismissJobId(null); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg rounded-lg p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-ds-15 sm:text-ds-17">Not Interested?</AlertDialogTitle>
            <AlertDialogDescription className="text-ds-13">
              {confirmDismissJob
                ? <>Remove <span className="font-semibold text-foreground">"{confirmDismissJob.title}"</span> from your feed? You won't see it again.</>
                : "Remove this job from your feed?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 sm:gap-2">
            <AlertDialogCancel className="mt-0 h-9 px-3 text-ds-13">Keep It</AlertDialogCancel>
            <AlertDialogAction onClick={handleDismissConfirm} className="h-9 px-3 text-ds-13 bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PayoutSetupDialog open={payoutSetupDialogOpen} onOpenChange={setPayoutSetupDialogOpen} />

      {/* Floating-FAB removed — MobileNav already renders a Post FAB at the
          right edge of the bottom dock. Two FABs at the same screen corner
          was the "stacked plus buttons" bug visible in TestFlight build
          screenshots. Desktop surfaces the CTA in the header (md:flex)
          so no desktop replacement is needed. */}
    </>
  );
};

export default Dashboard;
