import { useState, useCallback, useEffect, useRef } from "react";
import helprIcon from "@/assets/helpr-icon-96.png";

import { motion, AnimatePresence } from "framer-motion";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock, XCircle, MapPin, Star, Briefcase, X, Search, SlidersHorizontal, Paperclip, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import OnboardingTour from "@/components/OnboardingTour";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import JobFilters, { categoryLabels } from "@/components/dashboard/JobFilters";
import SwipeableJobCard from "@/components/dashboard/SwipeableJobCard";
import JobDetailDialog from "@/components/dashboard/JobDetailDialog";
import BroadcastBanner from "@/components/BroadcastBanner";

import { SavedSearches } from "@/components/SavedSearches";

import PayoutSetupDialog from "@/components/PayoutSetupDialog";
import { useStripeConnectCheck } from "@/hooks/useStripeConnectCheck";


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
  const [confirmApplyJobId, setConfirmApplyJobId] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyFiles, setApplyFiles] = useState<File[]>([]);
  const [payoutSetupDialogOpen, setPayoutSetupDialogOpen] = useState(false);
  const { checkHelperStripeConnect } = useStripeConnectCheck();
  const confirmApplyJob = allJobs.find((j) => j.id === confirmApplyJobId) || null;
  const [confirmDismissJobId, setConfirmDismissJobId] = useState<string | null>(null);
  const confirmDismissJob = allJobs.find((j) => j.id === confirmDismissJobId) || null;
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(() => {
    try {
      const stored = safeStorage.getItem("helpr_dismissed_jobs");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [showGreeting, setShowGreeting] = useState(() => {
    const dismissed = safeStorage.getItem("greeting_dismissed_at");
    if (dismissed && Date.now() - parseInt(dismissed, 10) < 30 * 24 * 60 * 60 * 1000) return false;
    return true;
  });

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
    // Hard gate: helprs must have a Stripe Connect payout account before applying.
    // Surfaces a friendly popup instead of a silent toast.
    if (profile?.role === "helper") {
      const stripeCheck = await checkHelperStripeConnect();
      if (!stripeCheck.ok) {
        setPayoutSetupDialogOpen(true);
        return;
      }
    }
    setConfirmApplyJobId(jobId);
  }, [user, allJobs, navigate, profile?.role, checkHelperStripeConnect]);

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
            <img src={helprIcon} alt="Helpr" width={36} height={36} className="w-9 h-9 rounded-xl shadow-md" />
            <span className="text-2xl font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent leading-none">Helpr</span>
          </div>
        </header>
        <main className="container mx-auto px-5 py-4">
          <div className="max-w-3xl mx-auto"><DashboardSkeleton /></div>
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
          <h1 className="text-2xl font-display font-bold text-foreground">
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
                <h1 className="text-2xl font-display font-bold text-foreground">Profile under review</h1>
                <p className="text-muted-foreground">Thanks for signing up, {firstName}! Your profile is being reviewed.</p>
                <p className="text-xs text-muted-foreground">
                  We'll let you know as soon as you're approved. This screen updates automatically.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                  <Button onClick={handleCheckStatus} className="rounded-xl btn-press">
                    Check status
                  </Button>
                  <Button variant="outline" onClick={handleSignOut} className="rounded-xl">
                    Sign out
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto"><XCircle className="w-8 h-8 text-destructive" /></div>
                <h1 className="text-2xl font-display font-bold text-foreground">Profile not approved</h1>
                <p className="text-muted-foreground">Unfortunately, your profile was not approved. Please contact support.</p>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button variant="outline" onClick={handleSignOut} className="rounded-xl">
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
    <div className="h-[100dvh] bg-premium-page pb-safe-nav flex flex-col overflow-hidden">
      <DashboardHeader />
      <BirthdayPopup dateOfBirth={profile?.date_of_birth} firstName={firstName} />

      <main className="container mx-auto px-5 py-3 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="max-w-3xl mx-auto w-full flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">

          <BroadcastBanner />
          <PushNotificationPrompt />
          
          {/* Welcome section */}
          {showGreeting && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="glass-card squircle rounded-xl px-3 py-1.5 relative flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-sm font-display font-semibold tracking-tight text-foreground leading-none truncate">
                {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, {firstName} 👋
              </h1>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                onClick={() => navigate("/post-job")}
                size="sm"
                className="sm:hidden h-6 text-[11px] px-2 squircle rounded-lg bg-gradient-to-r from-primary to-primary/85 shadow-sm gap-1"
              >
                <Briefcase className="w-3 h-3" /> Post
              </Button>
              <button
                onClick={() => { setShowGreeting(false); safeStorage.setItem("greeting_dismissed_at", Date.now().toString()); }}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                aria-label="Dismiss greeting"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
          )}


          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
            className="rounded-2xl border border-border/50 bg-card shadow-[var(--card-shadow)] overflow-hidden flex-1 min-h-0 flex flex-col"
          >
            {/* Header row */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/30 bg-gradient-to-r from-primary/[0.04] to-transparent">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center shadow-sm">
                  <Briefcase className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-display font-bold text-foreground leading-tight">
                    {filters.hasFilters ? "Filtered Results" : "Browse Tasks"}
                  </h2>
                  <span className="text-[10px] text-muted-foreground">
                    {filters.filteredJobs.length} available
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {filters.hasFilters && (
                  <Button variant="ghost" size="sm" onClick={filters.clearFilters} className="text-xs text-muted-foreground hover:text-destructive h-8 rounded-xl btn-press">
                    <X className="w-3 h-3 mr-1" /> Clear
                  </Button>
                )}
                {profile?.role === "helper" && user && (
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
                  className={`h-8 w-8 rounded-xl btn-press ${filters.searchOpen || filters.searchQuery ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Search className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { filters.setFiltersOpen(!filters.filtersOpen); if (filters.searchOpen) filters.setSearchOpen(false); }}
                  className={`h-8 w-8 rounded-xl btn-press relative ${filters.filtersOpen || filters.activeFilterCount > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  {filters.activeFilterCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                      {filters.activeFilterCount}
                    </span>
                  )}
                </Button>
              </div>
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
                      className="w-full pl-10 pr-9 h-10 text-sm rounded-xl border border-border/50 bg-muted/30 focus:bg-background focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
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

            {/* Expandable filters panel */}
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
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Active filter chips */}
            {!filters.filtersOpen && (filters.selectedCategory || filters.locationFilter || filters.maxBudget || filters.expiresWithin || filters.matchAvailability) && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-border/30">
                {filters.selectedCategory && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-primary/10 text-primary text-xs font-medium">
                    {categoryLabels[filters.selectedCategory]}
                    <button onClick={() => filters.setSelectedCategory(null)} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filters.locationFilter && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-primary/10 text-primary text-xs font-medium">
                    <MapPin className="w-3 h-3" />{filters.locationFilter}
                    <button onClick={() => filters.setLocationFilter("")} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filters.maxBudget && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-primary/10 text-primary text-xs font-medium">
                    ≤ ${filters.maxBudget}
                    <button onClick={() => filters.setMaxBudget("")} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filters.expiresWithin && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-primary/10 text-primary text-xs font-medium">
                    {filters.expiresWithin}
                    <button onClick={() => filters.setExpiresWithin("")} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filters.matchAvailability && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-primary/10 text-primary text-xs font-medium">
                    <Clock className="w-3 h-3" /> My hours
                    <button onClick={() => filters.setMatchAvailability(false)} className="hover:text-primary/70 btn-press"><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {/* Job list */}
            {filters.filteredJobs.length === 0 ? (
              <div className="glass-card squircle rounded-[24px] py-12 px-6 text-center space-y-6">
                {/* Isometric "Discovery" tile — layered green squircles
                    with a magnifying lens motif. Pure CSS so it's crisp at any DPI. */}
                <div className="relative w-28 h-28 mx-auto" aria-hidden>
                  <div
                    className="absolute inset-0 squircle rounded-[28px] bg-gradient-to-br from-primary/25 via-primary/15 to-primary/5 shadow-[0_20px_50px_-15px_hsl(158_67%_37%/0.35)]"
                    style={{ transform: "perspective(600px) rotateX(18deg) rotateZ(-8deg)" }}
                  />
                  <div
                    className="absolute inset-3 squircle rounded-[24px] bg-gradient-to-br from-white/90 to-white/60 backdrop-blur flex items-center justify-center"
                    style={{ transform: "perspective(600px) rotateX(18deg) rotateZ(-8deg)" }}
                  >
                    <Search className="w-12 h-12 text-primary" strokeWidth={2.25} />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xl font-display font-bold text-foreground">
                    {filters.hasFilters ? "No jobs match your filters" : "Nothing nearby just yet"}
                  </p>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                    {filters.hasFilters
                      ? "Try widening your search or clearing a filter to see more jobs."
                      : "New jobs are posted every day across Louisiana. Pick a path below to get moving."}
                  </p>
                </div>
                {filters.hasFilters ? (
                  <Button variant="outline" onClick={filters.clearFilters} className="squircle rounded-2xl">
                    Clear filters
                  </Button>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3 max-w-md mx-auto pt-2">
                    <button
                      onClick={() => navigate("/post-job")}
                      className="squircle rounded-[20px] bg-primary text-primary-foreground px-5 py-4 text-left shadow-[0_10px_30px_-10px_hsl(158_67%_37%/0.55)] hover:shadow-[0_14px_36px_-10px_hsl(158_67%_37%/0.65)] transition-all active:scale-[0.98]"
                    >
                      <div className="text-xs font-semibold opacity-80 mb-0.5">Need help?</div>
                      <div className="text-base font-display font-bold leading-tight">Post a task →</div>
                    </button>
                    <button
                      onClick={() => filters.setSearchQuery("")}
                      className="squircle rounded-[20px] border-2 border-primary/30 bg-white/40 backdrop-blur px-5 py-4 text-left text-foreground hover:border-primary/60 hover:bg-white/60 transition-all active:scale-[0.98]"
                    >
                      <div className="text-xs font-semibold text-muted-foreground mb-0.5">Looking for work?</div>
                      <div className="text-base font-display font-bold text-primary leading-tight">Browse nearby →</div>
                    </button>
                  </div>
                )}
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
              return (
                <>
                  <div className="divide-y divide-border/30">
                    {visibleJobs.map((job, i) => (
                      <div key={job.id} className="px-3 py-2.5">
                        <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                      </div>
                    ))}
                  </div>
                  {/* Infinite scroll sentinel + manual fallback */}
                  {hasNextPage && (
                    <div ref={loadMoreRef} className="px-4 py-4 flex justify-center">
                      {isFetchingNextPage ? (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                          Loading more jobs…
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fetchNextPage()}
                          className="text-xs text-muted-foreground hover:text-foreground rounded-xl btn-press"
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
          </motion.section>
        </div>
      </main>

      <JobDetailDialog job={detailJob} effectiveFee={effectiveFee} onClose={() => setDetailJob(null)} onApply={handleApplyRequest} onReport={setReportJobId} />

      {reportJobId && <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />}

      <OnboardingTour profileCreatedAt={profile?.created_at} />
      <QuickApplyHandler searchParams={searchParams} user={user} allJobs={allJobs} onApply={handleApplyRequest} />


      <AlertDialog open={!!confirmApplyJobId} onOpenChange={(open) => { if (!open) setConfirmApplyJobId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Application</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {confirmApplyJob
                ? <div className="space-y-3">
                    <p>Are you sure you want to apply for <span className="font-semibold text-foreground">"{confirmApplyJob.title}"</span>?</p>
                    <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5 text-sm">
                      {(() => {
                        const helpers = confirmApplyJob.is_group_job && confirmApplyJob.helpers_needed ? confirmApplyJob.helpers_needed : 1;
                        const perHelper = confirmApplyJob.budget / helpers;
                        const commission = perHelper * platformFee / 100;
                        const payout = perHelper - commission + (confirmApplyJob.urgent_fee ?? 0);
                        return (
                          <>
                             <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Earnings Breakdown</p>
                             <div className="flex justify-between text-xs text-muted-foreground">
                               <span>Job Budget{helpers > 1 ? ` (÷${helpers} helprs)` : ""}</span>
                               <span className="text-foreground font-medium">${perHelper.toFixed(2)}</span>
                             </div>
                             <div className="flex justify-between text-xs text-muted-foreground">
                               <span>Platform Fee ({platformFee}%)</span>
                               <span className="text-destructive/70">−${commission.toFixed(2)}</span>
                             </div>
                            {(confirmApplyJob.urgent_fee ?? 0) > 0 && (
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Urgent tip</span>
                                <span className="text-accent">+${Number(confirmApplyJob.urgent_fee).toFixed(2)}</span>
                              </div>
                            )}
                            <div className="h-px bg-border my-1" />
                            <div className="flex justify-between">
                              <span className="font-semibold text-foreground text-sm">Your Payout</span>
                              <span className="font-bold text-primary text-sm">${payout.toFixed(2)}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                : <p>Are you sure you want to apply for this task?</p>}
            </AlertDialogDescription>
            <div className="space-y-1.5 mt-2">
              <label htmlFor="apply-message" className="text-xs text-muted-foreground">Add a message (optional)</label>
              <Textarea
                id="apply-message"
                value={applyMessage}
                onChange={(e) => setApplyMessage(e.target.value)}
                placeholder="Introduce yourself or share relevant experience…"
                rows={3}
                className="text-sm"
              />
            </div>
            {/* File attachments */}
            <div className="space-y-1.5 mt-2">
              <label className="text-xs text-muted-foreground">Attach certs or previous work (optional)</label>
              <div className="space-y-1.5">
                {applyFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-secondary/30 rounded-lg px-2.5 py-1.5">
                    <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="truncate flex-1">{file.name}</span>
                    <span className="text-muted-foreground shrink-0">{(file.size / 1024).toFixed(0)}KB</span>
                    <button type="button" onClick={() => setApplyFiles(f => f.filter((_, idx) => idx !== i))} className="text-destructive hover:text-destructive/80">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {applyFiles.length < 5 && (
                  <label className="flex items-center gap-2 text-xs text-primary cursor-pointer hover:underline">
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>Add file</span>
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
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApplyConfirm} disabled={applyLoading}>
              {applyLoading ? "Applying…" : "Yes, Apply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDismissJobId} onOpenChange={(open) => { if (!open) setConfirmDismissJobId(null); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg rounded-lg p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base sm:text-lg">Not Interested?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              {confirmDismissJob
                ? <>Remove <span className="font-semibold text-foreground">"{confirmDismissJob.title}"</span> from your feed? You won't see it again.</>
                : "Remove this job from your feed?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 sm:gap-2">
            <AlertDialogCancel className="mt-0 h-9 px-3 text-sm">Keep It</AlertDialogCancel>
            <AlertDialogAction onClick={handleDismissConfirm} className="h-9 px-3 text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PayoutSetupDialog open={payoutSetupDialogOpen} onOpenChange={setPayoutSetupDialogOpen} />
    </div>
    </PullToRefreshWrapper>
  );
};

export default Dashboard;
