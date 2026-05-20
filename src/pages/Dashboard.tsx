import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";

import { motion } from "framer-motion";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { Button } from "@/components/ui/button";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock, XCircle, Star, X, Search } from "lucide-react";
import { toast } from "sonner";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";
import { YourHelpersRow } from "@/components/dashboard/YourHelpersRow";
import BroadcastBanner from "@/components/BroadcastBanner";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import type { EnrichedJob } from "@/components/dashboard/types";

// Dialogs and overlays — none are visible on first paint. Each is code-split
// and only the dialogs the user actually opens get fetched, keeping the
// Dashboard route chunk small.
const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));
const ApplyConfirmDialog = lazy(() => import("@/components/dashboard/ApplyConfirmDialog").then(m => ({ default: m.ApplyConfirmDialog })));
const ReportDialog = lazy(() => import("@/components/ReportDialog"));
const PayoutSetupDialog = lazy(() => import("@/components/PayoutSetupDialog"));
const OnboardingTour = lazy(() => import("@/components/OnboardingTour"));
const BirthdayPopup = lazy(() => import("@/components/BirthdayPopup"));
import { useDashboardData } from "@/hooks/useDashboardData";
import { usePrefetchUserData } from "@/hooks/usePrefetchUserData";
import { track, AhaEvent } from "@/lib/analytics";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { safeStorage } from "@/lib/safeStorage";
import { usePersistedBrowseView } from "@/hooks/usePersistedBrowseView";

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

  // The greeting card's "stat of the day" line was removed — it added a
  // third line to the title card and pushed the job feed down. The
  // headline job count it surfaced still shows in the date eyebrow.

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
  const { data: lastApplicationAt } = useQuery({
    queryKey: ["lastApplication", user?.id],
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
    return (
      <div className="min-h-screen bg-premium-page">
        <DashboardHeader />
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
      </div>
    );
  }

  const isPendingReview = !isAdmin && !!profile && approvalStatus === "pending";



  return (
    <>
    <PageScaffold
      animate
      panelElevation="flat"
      className="animate-in fade-in-0 duration-500"
      header={
        <>
          <DashboardHeader />
          <Suspense fallback={null}>
            <BirthdayPopup dateOfBirth={profile?.date_of_birth} firstName={firstName} />
          </Suspense>
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
            {/* Condensed greeting — the greeting + date eyebrow are folded
                into one tight two-line block (greeting line + a small
                date·jobs eyebrow). The greeting was its own tall line that
                pushed the feed down; the old standalone "stat of the day"
                paragraph (a 3rd line) is dropped — the job count it echoed
                already appears in the eyebrow below. */}
            <h1
              className="font-display italic font-bold truncate"
              style={{
                fontSize: "clamp(1.25rem, 1.6vw + 0.4rem, 1.5rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
                // Looser leading so the Beth Ellen script descenders
                // ("y", "g", "p" tails) on the signature first name
                // clear the date eyebrow below without the brittle
                // `paddingBottom: 0.1em` workaround.
                lineHeight: 1.25,
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
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 px-2.5 py-1 rounded-full active:opacity-70 transition-opacity"
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
              from a direct offer. Self-hides when there are none. */}
          <YourHelpersRow />
          {/* The "Finish your profile" completion nudge used to render
              here. It moved off the home feed onto the Profile landing
              screen (ProfileLanding's completion meter) so the job feed
              is no longer pushed below the fold. */}

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
            onClose={() => setDetailJob(null)}
            onApply={handleApplyRequest}
            onReport={setReportJobId}
            onSelect={setDetailJob}
          />
        </Suspense>
      )}

      {reportJobId && (
        <Suspense fallback={null}>
          <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />
        </Suspense>
      )}

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
            handleApplyConfirm={handleApplyConfirm}
          />
        </Suspense>
      )}

      <AlertDialog open={!!confirmDismissJobId} onOpenChange={(open) => { if (!open) setConfirmDismissJobId(null); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg rounded-ds-sm p-4 sm:p-6">
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
      {payoutSetupDialogOpen && (
        <Suspense fallback={null}>
          <PayoutSetupDialog open={payoutSetupDialogOpen} onOpenChange={setPayoutSetupDialogOpen} />
        </Suspense>
      )}

      {/* Floating-FAB removed — MobileNav already renders a Post FAB at the
          right edge of the bottom dock. Two FABs at the same screen corner
          was the "stacked plus buttons" bug visible in TestFlight build
          screenshots. Desktop surfaces the CTA in the header (md:flex)
          so no desktop replacement is needed. */}
    </>
  );
};

export default Dashboard;
