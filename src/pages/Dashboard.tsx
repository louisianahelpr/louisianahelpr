import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";

// Lazy-load BrowseMap so the ~45KB leaflet bundle only ships when an
// authenticated user toggles to map view. List view stays cheap.
const BrowseMap = lazy(() =>
  import("@/components/BrowseMap").then((m) => ({ default: m.BrowseMap })),
);
import HelprMark from "@/components/HelprMark";

import { motion, AnimatePresence } from "framer-motion";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock, XCircle, MapPin, Star, X, Search, SlidersHorizontal, Paperclip, FileText, Trash2, Plus, ArrowRight, List, Map as MapIcon } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import OnboardingTour from "@/components/OnboardingTour";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import JobFilters, { categoryLabels } from "@/components/dashboard/JobFilters";
import SwipeableJobCard from "@/components/dashboard/SwipeableJobCard";
import JobDetailDialog from "@/components/dashboard/JobDetailDialog";
import BroadcastBanner from "@/components/BroadcastBanner";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";

import { SavedSearches } from "@/components/SavedSearches";

import PayoutSetupDialog from "@/components/PayoutSetupDialog";


import BirthdayPopup from "@/components/BirthdayPopup";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useDashboardData } from "@/hooks/useDashboardData";
import { usePrefetchUserData } from "@/hooks/usePrefetchUserData";
import { track, AhaEvent } from "@/lib/analytics";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { safeStorage } from "@/lib/safeStorage";

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
    helperAvailability, recommendedJobs, refresh,
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

  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // List vs Map view. The map shows the same open jobs as the list,
  // pinned to neighborhood-rounded coords (privacy via the
  // get_open_jobs_for_map RPC). Toggle persists for the session only —
  // resetting to "list" on next mount matches user expectation that
  // the default landing surface is the curated feed.
  const [view, setView] = useState<"list" | "map">("list");
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
  // ("we're watching for X") rather than confusing.
  const [topSavedSearch, setTopSavedSearch] = useState<{ name: string } | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("saved_searches")
        .select("name")
        .eq("user_id", user.id)
        .eq("notify_enabled", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) setTopSavedSearch({ name: data.name });
    })();
    return () => { cancelled = true; };
  }, [user?.id]);
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

  // Load saved job IDs
  useEffect(() => {
    if (!user) return;
    supabase.from("saved_jobs").select("job_id").eq("user_id", user.id).then(({ data }) => {
      if (data) setSavedJobIds(new Set(data.map((d: any) => d.job_id)));
    });
  }, [user?.id]);

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
        <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto flex items-center gap-2 h-16 px-4">
            <HelprMark to="/dashboard" size="md" />
          </div>
        </header>
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
    <PullToRefreshWrapper ref={containerRef} pullDistance={pullDistance} refreshing={refreshing} isPulling={isPulling}>
    <div
      className="h-[100dvh] bg-premium-page flex flex-col overflow-hidden animate-in fade-in-0 duration-500"
    >
      <DashboardHeader />
      <BirthdayPopup dateOfBirth={profile?.date_of_birth} firstName={firstName} />

      <main className="container mx-auto px-5 lg:px-8 xl:px-12 pt-3 lg:pt-5 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto flex-1 min-h-0 flex flex-col gap-3 lg:gap-4 overflow-hidden">

          <BroadcastBanner />
          <PushNotificationPrompt />


          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="liquid-glass shrink-0 px-5 py-4 lg:px-6 lg:py-5 relative overflow-hidden"
            style={{
              // Material depth — soft copper glow in the upper-right and
              // a faint verdigris cast in the lower-left so the wide
              // greeting card reads as a textured pane rather than flat.
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
            <h1
              className="font-display font-bold leading-tight truncate"
              style={{
                fontSize: "clamp(1.5rem, 2vw + 0.5rem, 1.85rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
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
          </motion.div>

          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
            className="liquid-glass overflow-hidden flex-1 min-h-0 flex flex-col"
            style={{
              // Browse Tasks card extends to the viewport bottom — bottom
              // corners drop their radius and inset shadow so the panel
              // reads as continuing under the floating dock instead of
              // ending at a hard edge above it.
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              borderBottom: "none",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
                "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                "0 14px 30px -8px hsl(var(--olivewood) / 0.14), " +
                "0 36px 64px -16px hsl(var(--olivewood) / 0.18)",
            }}
          >
            {/* Header row */}
            <div
              className="shrink-0 flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
            >
              <div className="flex flex-col leading-none">
                <span
                  className="font-serif italic tracking-[0.18em] uppercase text-[0.62rem]"
                  style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
                >
                  {filters.hasFilters ? "Filtered" : "For you, today"}
                </span>
                <h2
                  className="font-display italic font-bold leading-tight mt-1"
                  style={{
                    fontSize: "1.25rem",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.018em",
                  }}
                >
                  {filters.hasFilters ? "Filtered Results" : "Browse Tasks"}
                </h2>
                {/* Subtitle hidden when 0 jobs — the empty-state card
                    below already says "Nothing nearby just yet" in a much
                    more prominent way. Showing "0 jobs" here too is
                    redundant noise. */}
                {filters.filteredJobs.length > 0 && (
                  <span
                    className="font-serif italic mt-0.5 text-ds-11"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    {filters.filteredJobs.length}{" "}
                    {filters.filteredJobs.length === 1 ? "job" : "jobs"}
                  </span>
                )}
              </div>
              {(() => {
                // When there are zero open jobs AND no active filters, the
                // toolbar (saved-searches / search / filters) has nothing
                // useful to do. Dim it (opacity 50%, no pointer events) so
                // the eye doesn't get pulled to dead controls on an empty
                // screen. Still rendered for layout continuity.
                const isEmptyAndUnfiltered = filters.filteredJobs.length === 0 && !filters.hasFilters;
                return (
                  <div
                    className={`flex items-center gap-1 transition-opacity ${isEmptyAndUnfiltered ? "opacity-40 pointer-events-none" : ""}`}
                    aria-hidden={isEmptyAndUnfiltered ? "true" : undefined}
                  >
                    {filters.hasFilters && (
                      <Button variant="ghost" size="sm" onClick={filters.clearFilters} className="text-ds-11 text-muted-foreground hover:text-destructive h-8 rounded-ds-md btn-press">
                        <X className="w-3 h-3 mr-1" /> Clear
                      </Button>
                    )}
                    {user && (
                      <SavedSearches
                        userId={user.id}
                        currentFilters={{
                          selectedCategory: filters.selectedCategory,
                          maxBudget: filters.maxBudget,
                          locationFilter: filters.locationFilter,
                        }}
                        onApplySearch={(s) => {
                          filters.setSelectedCategory(s.category);
                          filters.setMaxBudget(s.max_budget ? String(s.max_budget) : "");
                          filters.setLocationFilter(s.location_keyword || "");
                        }}
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { filters.setSearchOpen(!filters.searchOpen); if (filters.filtersOpen) filters.setFiltersOpen(false); }}
                      className={`h-8 w-8 rounded-ds-md btn-press ${filters.searchOpen || filters.searchQuery ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      aria-label="Search jobs"
                      aria-expanded={filters.searchOpen}
                    >
                      <Search className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { filters.setFiltersOpen(!filters.filtersOpen); if (filters.searchOpen) filters.setSearchOpen(false); }}
                      className={`h-8 w-8 rounded-ds-md btn-press relative ${filters.filtersOpen || filters.activeFilterCount > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      aria-label={filters.activeFilterCount > 0 ? `Filters (${filters.activeFilterCount} active)` : "Filters"}
                      aria-expanded={filters.filtersOpen}
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                      {filters.activeFilterCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
                          {filters.activeFilterCount}
                        </span>
                      )}
                    </Button>
                  </div>
                );
              })()}
            </div>

            {/* Expandable search bar */}
            <AnimatePresence>
              {filters.searchOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden border-b border-border/30"
                >
                  <div className="relative px-4 py-3">
                    <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      autoFocus
                      placeholder="Search tasks…"
                      value={filters.searchQuery}
                      onChange={(e) => filters.setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-9 h-10 text-ds-13 rounded-ds-md border border-border/50 bg-muted/30 focus:bg-background focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
                    />
                    {filters.searchQuery && (
                      <button onClick={() => filters.setSearchQuery("")} className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Expandable filters panel — capped at 50vh so it doesn't
                push the job list off screen on small phones. The panel
                scrolls internally if its content is taller than the cap. */}
            <AnimatePresence>
              {filters.filtersOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="overflow-hidden border-b border-border/30"
                >
                  <JobFilters
                    searchQuery={filters.searchQuery} setSearchQuery={filters.setSearchQuery}
                    selectedCategory={filters.selectedCategory} setSelectedCategory={filters.setSelectedCategory}
                    maxBudget={filters.maxBudget} setMaxBudget={filters.setMaxBudget}
                    locationFilter={filters.locationFilter} setLocationFilter={filters.setLocationFilter}
                    sortBy={filters.sortBy} setSortBy={filters.setSortBy}
                    filtersOpen={true} setFiltersOpen={filters.setFiltersOpen}
                    expiresWithin={filters.expiresWithin} setExpiresWithin={filters.setExpiresWithin}
                    matchAvailability={filters.matchAvailability} setMatchAvailability={filters.setMatchAvailability}
                    hasAvailability={helperAvailability.length > 0}
                    boostedOnly={filters.boostedOnly} setBoostedOnly={filters.setBoostedOnly}
                    userLocStatus={filters.userLoc?.status}
                    userLocMessage={filters.userLoc?.status === "error" ? filters.userLoc.message : undefined}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Active filter chips */}
            {!filters.filtersOpen && (filters.selectedCategory || filters.locationFilter || filters.maxBudget || filters.expiresWithin || filters.matchAvailability) && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-border/30">
                {filters.selectedCategory && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
                    {categoryLabels[filters.selectedCategory]}
                    <button onClick={() => filters.setSelectedCategory(null)} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filters.locationFilter && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
                    <MapPin className="w-3 h-3" />
                    {filters.locationFilter.startsWith("nearby:")
                      ? `Within ${filters.locationFilter.slice(7)} mi`
                      : filters.locationFilter}
                    <button onClick={() => filters.setLocationFilter("")} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filters.maxBudget && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
                    ≤ ${filters.maxBudget}
                    <button onClick={() => filters.setMaxBudget("")} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filters.expiresWithin && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
                    {filters.expiresWithin}
                    <button onClick={() => filters.setExpiresWithin("")} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filters.matchAvailability && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
                    <Clock className="w-3 h-3" /> My hours
                    <button onClick={() => filters.setMatchAvailability(false)} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
            )}

            {/* List ⇄ Map toggle — hidden when 0 jobs because the map
                would show an empty Louisiana with no pins, making the
                toggle a UI-noise tax. Re-appears the moment jobs land. */}
            {filters.filteredJobs.length > 0 && (
              <div className="px-3 pt-3 pb-1">
                <div className="flex gap-1 p-1 bg-muted/40 rounded-ds-md border border-border w-full max-w-xs mx-auto">
                  <button
                    onClick={() => setView("list")}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-ds-11 font-medium transition-colors ${
                      view === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <List className="w-3.5 h-3.5" /> List
                  </button>
                  <button
                    onClick={() => setView("map")}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-ds-11 font-medium transition-colors ${
                      view === "map" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <MapIcon className="w-3.5 h-3.5" /> Map
                  </button>
                </div>
              </div>
            )}

            {view === "map" && (
              <div className="px-3 pt-2 pb-3">
                <Suspense fallback={<div className="h-[480px] rounded-2xl bg-muted/30 animate-pulse" />}>
                  <BrowseMap
                    onJobAction={handleApplyRequest}
                    ctaLabel="Apply"
                    currentUserId={user?.id}
                  />
                </Suspense>
              </div>
            )}

            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide px-3 pt-3 pb-0"
              style={view === "map" ? { display: "none" } : undefined}
            >
              {/* Always-visible elevated content box. Empty state and the
                  job list both render INSIDE this box so the dashboard
                  never reads as "bare rows on the page" — the box is the
                  identity of the Browse Tasks area. Bottom corners
                  drop their radius so the box reads as continuing under
                  the floating dock. */}
              <div
                className="liquid-glass glass-paper-mesh min-h-full overflow-hidden"
                style={{
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  borderBottom: "none",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                    "0 14px 30px -8px hsl(var(--olivewood) / 0.14), " +
                    "0 36px 64px -16px hsl(var(--olivewood) / 0.18)",
                }}
              >
            {/* Job list */}
            {filters.filteredJobs.length === 0 ? (
            <div className="px-4 pt-4 flex-1 min-h-0 flex">
              {/* Empty-state liquid-glass card — replaces the previous
                  flat-white card so the empty state visually belongs with
                  the warm parchment surface above. Top corners rounded,
                  bottom flat to merge with the dock. */}
              <div
                className="liquid-glass flex-1 flex flex-col items-center text-center justify-center gap-4 px-6 py-8 rounded-t-2xl"
                style={{
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  borderBottom: "none",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                    "0 14px 30px -8px hsl(var(--olivewood) / 0.14)",
                  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1.5rem)",
                }}
              >
                  {/* Frosted glass circle — wraps the search icon so it
                      reads as a clear focal point against the now-textured
                      paper-mesh background. */}
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                      backdropFilter: "blur(16px) saturate(150%)",
                      WebkitBackdropFilter: "blur(16px) saturate(150%)",
                      border: "1px solid hsla(0, 0%, 100%, 0.7)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                        "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                        "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
                    }}
                  >
                    <Search className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-display-eyebrow">
                      {filters.hasFilters ? "No matches" : "All quiet — for now"}
                    </span>
                    <p
                      className="font-display italic font-bold leading-tight"
                      style={{
                        fontSize: "clamp(1.1rem, 1.5vw + 0.4rem, 1.4rem)",
                        color: "hsl(var(--ink-deep))",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {filters.hasFilters ? "No jobs match your filters." : "Nothing today, neighbor."}
                    </p>
                    <p
                      className="font-serif italic text-ds-13 leading-relaxed max-w-sm mx-auto"
                      style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                    >
                      {filters.hasFilters
                        ? filters.boostedOnly
                          ? "No boosted jobs right now — try clearing the filter to see all open work."
                          : "Try widening your parish, raising your budget, or clearing a filter."
                        : (() => {
                            // Rotating friendly tip — picks one of 4 every
                            // hour so the empty state feels alive on repeat
                            // visits instead of static. Deterministic per
                            // hour keeps it from flickering on every render.
                            const tips = [
                              "New jobs post throughout the day. Helprs often check in around lunch and after work.",
                              "Most posts go up on weekday evenings. Pull down to refresh anytime.",
                              "Saved a search? Helpr will ping you the moment a matching job hits the board.",
                              "Quiet days happen. The neighborhood circles back — usually before sundown.",
                            ];
                            return tips[new Date().getHours() % tips.length];
                          })()}
                    </p>
                  </div>
                  {filters.hasFilters ? (
                    <Button variant="outline" onClick={filters.clearFilters} className="rounded-ds-md">
                      Clear filters
                    </Button>
                  ) : (
                    <button
                      onClick={() => navigate("/post-job")}
                      className="group relative inline-flex items-center gap-2.5 px-6 h-12 rounded-full overflow-hidden transition-transform duration-200 active:scale-[0.96]"
                      style={{
                        // Flat olive bark — matches the MobileNav FAB so the
                        // CTA reads as a peer of the bottom dock. Previous
                        // version used a radial gradient that produced a
                        // visible horizontal "band" at the gradient stop,
                        // which looked like a hairline strikethrough on
                        // some iOS rendering paths. Flat solid bark + soft
                        // halo eliminates the band entirely.
                        background: "hsl(var(--bark))",
                        color: "hsl(var(--parchment))",
                        border: "1px solid hsl(70 22% 24%)",
                        fontFamily: "Montserrat, system-ui, sans-serif",
                        fontWeight: 600,
                        letterSpacing: "0.01em",
                        boxShadow:
                          "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
                          "0 1px 2px hsl(70 20% 18% / 0.22), " +
                          "0 8px 18px -6px hsl(var(--bark) / 0.55), " +
                          "0 18px 36px -12px hsl(var(--bark) / 0.4)",
                      }}
                    >
                      <Plus
                        className="w-4 h-4"
                        strokeWidth={2.75}
                        style={{ color: "hsl(var(--parchment))" }}
                      />
                      <span className="text-ds-15">Post the first job</span>
                      <ArrowRight
                        className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                        strokeWidth={2.5}
                      />
                    </button>
                  )}
              </div>
            </div>
            ) : (() => {
              const visibleJobs = filters.filteredJobs
                .filter(j => !dismissedJobIds.has(j.id))
                .filter(j => {
                  // Hide jobs already shown in Recommended or Nearby sections
                  if (!filters.hasFilters) {
                    const inRecommended = recommendedJobs.some(rj => rj.id === j.id);
                    const inNearby = filters.nearbyJobs.some(nj => nj.id === j.id);
                    if (inRecommended || inNearby) return false;
                  }
                  return true;
                });
              const recommendedVisible = !filters.hasFilters
                ? recommendedJobs.filter(j => !dismissedJobIds.has(j.id))
                : [];
              return (
                <>
                  {recommendedVisible.length > 0 && (
                    <>
                      <div
                        className="px-4 pt-3 pb-1.5 flex items-center justify-between"
                        style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.06)" }}
                      >
                        <div className="flex items-center gap-2">
                          <Star
                            className="w-3.5 h-3.5"
                            style={{ color: "hsl(var(--burnt-sienna))" }}
                            strokeWidth={2}
                            fill="hsl(var(--burnt-sienna) / 0.2)"
                          />
                          <span
                            className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
                            style={{ color: "hsl(var(--burnt-sienna))" }}
                          >
                            Picked for you
                          </span>
                        </div>
                        <span
                          className="text-[0.7rem] font-sans"
                          style={{ color: "hsl(var(--olivewood) / 0.55)" }}
                        >
                          {recommendedVisible.length}
                        </span>
                      </div>
                      <div className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-4 xl:space-y-5">
                        {recommendedVisible.map((job, i) => (
                          <div key={`rec-${job.id}`}>
                            <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                          </div>
                        ))}
                      </div>
                      {visibleJobs.length > 0 && (
                        <div
                          className="px-4 pt-3 pb-1.5"
                          style={{
                            borderTop: "1px solid hsl(var(--olivewood) / 0.06)",
                            borderBottom: "1px solid hsl(var(--olivewood) / 0.06)",
                          }}
                        >
                          <span
                            className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
                            style={{ color: "hsl(var(--burnt-sienna))" }}
                          >
                            Everything else
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  <div
                    className="px-3 pt-3 space-y-2.5 lg:space-y-4 xl:space-y-5"
                    style={{
                      // Dock clearance — last jobs scroll *under* the
                      // floating bottom nav, so we add safe room below
                      // the final card to let the user reach it.
                      paddingBottom: "calc(6rem + env(safe-area-inset-bottom, 0px))",
                    }}
                  >
                    {visibleJobs.map((job, i) => (
                      <div key={job.id}>
                        <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                      </div>
                    ))}
                  </div>
                  {/* Infinite scroll sentinel + manual fallback */}
                  {hasNextPage && (
                    <div ref={loadMoreRef} className="px-4 py-4 flex justify-center">
                      {isFetchingNextPage ? (
                        <span className="text-ds-11 text-muted-foreground inline-flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                          Loading more jobs…
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fetchNextPage()}
                          className="text-ds-11 text-muted-foreground hover:text-foreground rounded-ds-md btn-press"
                        >
                          Load more
                        </Button>
                      )}
                    </div>
                  )}
                  {!hasNextPage && visibleJobs.length >= 25 && (
                    <div className="px-4 py-4 text-center text-[11px] text-muted-foreground">
                      You've reached the end of the feed.
                    </div>
                  )}
                </>
              );
            })()}
              </div>
            </div>
          </motion.section>
        </div>
      </main>

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


      <AlertDialog open={!!confirmApplyJobId} onOpenChange={(open) => { if (!open) setConfirmApplyJobId(null); }}>
        <AlertDialogContent className="!gap-3">
          <AlertDialogHeader className="!text-left space-y-0">
            <span
              className="font-serif italic uppercase"
              style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              You're applying
            </span>
            <AlertDialogTitle
              className="font-display italic font-bold leading-tight mt-1"
              style={{ fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
            >
              {confirmApplyJob ? `"${confirmApplyJob.title}"` : "Apply for this task"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {confirmApplyJob ? (
                <div className="mt-3">
                  {(() => {
                    const helpers = confirmApplyJob.is_group_job && confirmApplyJob.helpers_needed ? confirmApplyJob.helpers_needed : 1;
                    const perHelper = confirmApplyJob.budget / helpers;
                    const commission = perHelper * platformFee / 100;
                    const payout = perHelper - commission + (confirmApplyJob.urgent_fee ?? 0);
                    return (
                      <div
                        className="rounded-ds-md p-3"
                        style={{
                          background:
                            "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
                            "linear-gradient(180deg, hsla(38, 50%, 96%, 0.92) 0%, hsla(38, 30%, 92%, 0.74) 100%)",
                          border: "0.5px solid hsl(var(--bark) / 0.22)",
                          boxShadow:
                            "inset 0 1px 1px 0 rgba(255,255,255,0.6), " +
                            "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.22)",
                        }}
                      >
                        <p
                          className="font-serif italic uppercase mb-1.5"
                          style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
                        >
                          You earn
                        </p>
                        <div className="space-y-1 text-[0.78rem]">
                          <div className="flex justify-between" style={{ color: "hsl(var(--olivewood) / 0.78)" }}>
                            <span className="font-serif italic">Budget{helpers > 1 ? ` ÷ ${helpers}` : ""}</span>
                            <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>${perHelper.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between" style={{ color: "hsl(var(--olivewood) / 0.78)" }}>
                            <span className="font-serif italic">− {platformFee}% platform fee</span>
                            <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>−${commission.toFixed(2)}</span>
                          </div>
                          {(confirmApplyJob.urgent_fee ?? 0) > 0 && (
                            <div className="flex justify-between">
                              <span className="font-serif italic" style={{ color: "hsl(var(--burnt-sienna))" }}>+ urgent bonus</span>
                              <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>+${Number(confirmApplyJob.urgent_fee).toFixed(2)}</span>
                            </div>
                          )}
                          <div
                            className="flex justify-between pt-1.5 mt-1.5 items-baseline"
                            style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
                          >
                            <span className="font-display italic font-bold" style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}>Take-home</span>
                            <span
                              className="font-display italic font-bold tabular-nums"
                              style={{ fontSize: "1.15rem", color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
                            >
                              ${payout.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <p className="font-serif italic mt-2" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                  Are you sure you want to apply for this task?
                </p>
              )}
            </AlertDialogDescription>
            <div className="space-y-1.5 mt-3">
              <label
                htmlFor="apply-message"
                className="font-serif italic uppercase block"
                style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Your pitch — optional
              </label>
              <Textarea
                id="apply-message"
                value={applyMessage}
                onChange={(e) => setApplyMessage(e.target.value)}
                placeholder="Introduce yourself or share relevant experience…"
                rows={3}
                className="rounded-ds-md bg-white/60 border-border/60 focus-visible:bg-white focus-visible:border-primary/40 font-serif italic text-[0.88rem] leading-relaxed"
              />
            </div>
            {/* File attachments */}
            <div className="space-y-1.5 mt-2">
              <label
                className="font-serif italic uppercase block"
                style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Certs or previous work — optional
              </label>
              <div className="space-y-1.5">
                {applyFiles.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-[0.72rem] rounded-ds-md px-2.5 py-1.5"
                    style={{ background: "hsl(var(--bark) / 0.08)", border: "0.5px solid hsl(var(--bark) / 0.18)" }}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
                    <span className="truncate flex-1 font-sans font-medium" style={{ color: "hsl(var(--ink-deep))" }}>{file.name}</span>
                    <span className="font-sans tabular-nums shrink-0" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>{(file.size / 1024).toFixed(0)}KB</span>
                    <button type="button" onClick={() => setApplyFiles(f => f.filter((_, idx) => idx !== i))} style={{ color: "hsl(var(--burnt-sienna))" }} className="active:opacity-70">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {applyFiles.length < 5 && (
                  <label
                    className="inline-flex items-center gap-1.5 text-[0.78rem] font-sans font-semibold cursor-pointer active:opacity-70"
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    <Paperclip className="w-3.5 h-3.5" strokeWidth={2.25} />
                    <span>{applyFiles.length === 0 ? "Add a file" : "Add another"}</span>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); return; }
                          setApplyFiles(f => [...f, file]);
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter className="!gap-2">
            <AlertDialogCancel disabled={applyLoading} className="rounded-ds-md">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApplyConfirm}
              disabled={applyLoading}
              className="rounded-ds-md"
              style={{
                background: "hsl(var(--bark))",
                backgroundImage: "none",
                border: "1px solid hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                letterSpacing: "0.01em",
                boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)",
              }}
            >
              {applyLoading ? "Applying…" : "Apply now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </div>
    </PullToRefreshWrapper>
  );
};

export default Dashboard;
