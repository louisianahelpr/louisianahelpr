import { useState, useCallback, useEffect } from "react";
import { useStripeConnectCheck } from "@/hooks/useStripeConnectCheck";
import { motion, AnimatePresence } from "framer-motion";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import JobCard from "@/components/dashboard/JobCard";
import JobDetailDialog from "@/components/dashboard/JobDetailDialog";
import InviteBanner from "@/components/dashboard/InviteBanner";
import BroadcastBanner from "@/components/BroadcastBanner";
import BirthdayPopup from "@/components/BirthdayPopup";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";

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

const GREETING_MESSAGES = [
  "Thank you for being part of the Helpr community — we appreciate you! 💚",
  "You make this community stronger just by showing up. Keep going! 💪",
  "Every task completed is someone's day made better. You're amazing! ✨",
  "Together we lift each other up — that's the Helpr way! 🤝",
  "Your kindness ripples through the whole community. Thank you! 🌊",
  "Helprs and customers alike — you're the heartbeat of Helpr! ❤️",
  "Small acts of service build big community bonds. You're proof! 🌟",
  "We see you, we value you, and we're grateful you're here! 🙏",
  "Community isn't just a word here — it's what we build together! 🏗️",
  "Whether you're posting or helping, you're making Louisiana better! 🎉",
  "Never forget: your effort matters and your community notices! 👏",
  "Gratitude fuels everything we do — and we're grateful for YOU! 💛",
  "One task at a time, we're changing how neighbors help neighbors! 🏠",
  "You bring the heart, we bring the platform — magic happens! ✨",
  "Today's a great day to make someone's life a little easier! ☀️",
  "Behind every job is a real person who appreciates your help! 💚",
  "This community thrives because of people like you. Don't forget that! 🌱",
  "Keep shining — your positive energy makes Helpr special! 🌞",
  "Neighbors helping neighbors — that's the Louisiana spirit! ⚜️",
  "You showed up today. That already makes a difference! 🙌",
  "Be proud of every connection you've made through Helpr! 🔗",
  "Your trust in this community inspires us every single day! 💫",
  "Great things happen when good people come together! 🎊",
  "Remember: someone out there is thankful for what you do! 💝",
  "The best communities are built on generosity — like yours! 🌻",
  "Another day, another chance to uplift someone. Let's go! 🚀",
  "Kindness is contagious — and you're spreading it! 😊",
  "Helpr exists because of YOUR belief in community. Thank you! 🏆",
  "Every review, every task, every message — it all matters! 📝",
  "You're not just using an app — you're building something real! 💎",
];

const Dashboard = () => {
  const navigate = useNavigate();
  usePageTitle("Dashboard — Helpr");
  const [searchParams] = useSearchParams();

  const { user, profile, isAdmin, loading, helprTier, allJobs, platformFee, helperAvailability, recommendedJobs, refresh } = useDashboardData();

  const { containerRef, pullDistance, refreshing, isPulling } = usePullToRefresh({
    onRefresh: refresh,
  });

  useRealtimePush(user?.id ?? null);

  const filters = useDashboardFilters({
    allJobs, userId: user?.id, profile, helprTier, helperAvailability,
  });

  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [confirmApplyJobId, setConfirmApplyJobId] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyFiles, setApplyFiles] = useState<File[]>([]);
  const confirmApplyJob = allJobs.find((j) => j.id === confirmApplyJobId) || null;
  const [confirmDismissJobId, setConfirmDismissJobId] = useState<string | null>(null);
  const confirmDismissJob = allJobs.find((j) => j.id === confirmDismissJobId) || null;
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("helpr_dismissed_jobs");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [showGreeting, setShowGreeting] = useState(() => {
    const dismissed = localStorage.getItem("greeting_dismissed_at");
    if (dismissed && Date.now() - parseInt(dismissed, 10) < 24 * 60 * 60 * 1000) return false;
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
  const handleApplyRequest = useCallback((jobId: string) => {
    if (!user) { navigate("/login"); return; }
    const job = allJobs.find((j) => j.id === jobId);
    if (job && job.customer_id === user.id) { toast.error("You can't apply to your own post."); return; }
    setConfirmApplyJobId(jobId);
  }, [user, allJobs, navigate]);

  const { checkHelperStripeConnect } = useStripeConnectCheck();

  const handleApplyConfirm = useCallback(async () => {
    if (!user || !confirmApplyJobId || applyLoading) return;
    setApplyLoading(true);

    // Block users without a connected payout account from applying
    const stripeCheck = await checkHelperStripeConnect();
    if (!stripeCheck.ok) {
      toast.error(stripeCheck.reason);
      setConfirmApplyJobId(null);
      setApplyLoading(false);
      return;
    }

    // Upload attachments
    let attachmentUrls: string[] = [];
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
        const { data: urlData } = supabase.storage.from("application-attachments").getPublicUrl(path);
        attachmentUrls.push(urlData.publicUrl);
      }
    }

    const { error } = await supabase.from("applications").insert({
      job_id: confirmApplyJobId,
      helper_id: user.id,
      message: applyMessage.trim() || null,
      attachment_urls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
    });
    if (error) {
      if (error.code === "23505") toast.error("You've already applied.");
      else toast.error(error.message);
    } else {
      toast.success("Application sent! Track it in My Jobs.", {
        action: { label: "View", onClick: () => navigate("/my-jobs") },
      });
      refresh();
    }
    setConfirmApplyJobId(null);
    setApplyLoading(false);
    setApplyMessage("");
    setApplyFiles([]);
  }, [user, confirmApplyJobId, navigate, refresh, profile, checkHelperStripeConnect, applyLoading, applyFiles]);

  const handleDismissRequest = useCallback((jobId: string) => {
    setConfirmDismissJobId(jobId);
  }, []);

  const handleDismissConfirm = useCallback(() => {
    if (!confirmDismissJobId) return;
    setDismissedJobIds(prev => {
      const next = new Set(prev);
      next.add(confirmDismissJobId);
      localStorage.setItem("helpr_dismissed_jobs", JSON.stringify([...next]));
      return next;
    });
    toast.success("Job removed from your feed.");
    setConfirmDismissJobId(null);
  }, [confirmDismissJobId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto flex items-center justify-between h-16 px-4">
            <span className="text-2xl font-display font-bold text-primary">Helpr</span>
          </div>
        </header>
        <main className="container mx-auto px-4 py-4">
          <div className="max-w-3xl mx-auto"><DashboardSkeleton /></div>
        </main>
      </div>
    );
  }

  const firstName = (profile?.full_name || user?.user_metadata?.full_name || "User").split(" ")[0];
  const approvalStatus = profile?.approval_status || "pending";
  const banStatus = profile?.ban_status || "active";

  // Block banned users
  if (!isAdmin && (banStatus === "permanently_banned" || banStatus === "temp_banned")) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
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

  if (!isAdmin && approvalStatus !== "approved") {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-lg mx-auto text-center space-y-6">
            {approvalStatus === "pending" ? (
              <>
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto"><Clock className="w-8 h-8 text-primary" /></div>
                <h1 className="text-2xl font-display font-bold text-foreground">Profile under review</h1>
                <p className="text-muted-foreground">Thanks for signing up, {firstName}! Your profile is being reviewed.</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto"><XCircle className="w-8 h-8 text-destructive" /></div>
                <h1 className="text-2xl font-display font-bold text-foreground">Profile not approved</h1>
                <p className="text-muted-foreground">Unfortunately, your profile was not approved. Please contact support.</p>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  const dayIndex = Math.floor(Date.now() / 86400000) % GREETING_MESSAGES.length;

  return (
    <PullToRefreshWrapper ref={containerRef} pullDistance={pullDistance} refreshing={refreshing} isPulling={isPulling}>
    <div className="min-h-screen bg-background pb-20">
      <DashboardHeader />
      <BirthdayPopup dateOfBirth={profile?.date_of_birth} firstName={firstName} />

      <main className="container mx-auto px-4 py-5">
        <div className="max-w-3xl mx-auto space-y-5">

          <BroadcastBanner />
          {/* Welcome section */}
          {showGreeting && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="rounded-xl bg-gradient-to-r from-primary/8 to-primary/4 px-4 py-2.5 border border-primary/10 relative flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base font-display font-bold text-foreground whitespace-nowrap">
                {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, {firstName} 👋
              </span>
              <span className="text-xs text-muted-foreground truncate hidden xs:inline">Browse tasks or post your own</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                onClick={() => navigate("/post-job")}
                size="sm"
                className="sm:hidden h-7 text-xs px-2.5 bg-gradient-to-r from-primary to-primary/80 shadow-sm gap-1"
              >
                <Briefcase className="w-3.5 h-3.5" /> Post
              </Button>
              <button
                onClick={() => { setShowGreeting(false); localStorage.setItem("greeting_dismissed_at", Date.now().toString()); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss greeting"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
          )}


          {/* Jobs Near You */}
          {filters.nearbyJobs.length > 0 && !filters.hasFilters && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-400/20 to-sky-500/10 flex items-center justify-center shadow-sm">
                  <MapPin className="w-4 h-4 text-sky-600" />
                </div>
                <div>
                  <h2 className="text-sm font-display font-bold text-foreground leading-tight">Jobs Near You</h2>
                  <span className="text-[10px] text-muted-foreground">{profile?.location}</span>
                </div>
              </div>
              <div className="space-y-3">
                {filters.nearbyJobs.filter(j => !dismissedJobIds.has(j.id)).slice(0, 3).map((job, i) => (
                  <SwipeableJobCard key={job.id} job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                ))}
              </div>
              {filters.nearbyJobs.length > 3 && (
                <button onClick={() => filters.setLocationFilter(profile?.location || "")} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                  View all {filters.nearbyJobs.length} nearby jobs →
                </button>
              )}
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            </motion.section>
          )}

          {/* Recommended for You */}
          {recommendedJobs.length > 0 && !filters.hasFilters && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center shadow-sm">
                  <Star className="w-4 h-4 text-accent fill-accent" />
                </div>
                <div>
                  <h2 className="text-sm font-display font-bold text-foreground leading-tight">Recommended for You</h2>
                  <span className="text-[10px] text-muted-foreground">based on your skills</span>
                </div>
              </div>
              <div className="space-y-3">
                {recommendedJobs.filter(j => !dismissedJobIds.has(j.id)).slice(0, 3).map((job, i) => (
                  <SwipeableJobCard key={job.id} job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                ))}
              </div>
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            </motion.section>
          )}

          {/* All Tasks section */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
            className="rounded-2xl border border-border/50 bg-card shadow-[var(--card-shadow)] overflow-hidden"
          >
            {/* Header row */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-gradient-to-r from-primary/[0.04] to-transparent">
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

            {/* Job list */}
            {filters.filteredJobs.length === 0 ? (
              <div className="text-center py-16 px-4 space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mx-auto">
                  <Briefcase className="w-7 h-7 text-primary/40" />
                </div>
                <div>
                  <p className="font-display font-semibold text-foreground">{filters.hasFilters ? "No matching tasks" : "No open tasks right now"}</p>
                  <p className="text-sm text-muted-foreground mt-1">{filters.hasFilters ? "Try adjusting your filters" : "Check back soon — new tasks are posted daily!"}</p>
                </div>
                {filters.hasFilters && (
                  <Button variant="outline" onClick={filters.clearFilters} className="rounded-xl btn-press">
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {filters.filteredJobs.filter(j => !dismissedJobIds.has(j.id)).filter(j => {
                  // Hide jobs already shown in Recommended or Nearby sections
                  if (!filters.hasFilters) {
                    const inRecommended = recommendedJobs.some(rj => rj.id === j.id);
                    const inNearby = filters.nearbyJobs.some(nj => nj.id === j.id);
                    if (inRecommended || inNearby) return false;
                  }
                  return true;
                }).map((job, i) => (
                  <div key={job.id} className="px-3 py-2.5 first:pt-3 last:pb-3">
                    <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>
      </main>

      <JobDetailDialog job={detailJob} effectiveFee={effectiveFee} onClose={() => setDetailJob(null)} onApply={handleApplyRequest} onReport={setReportJobId} />

      {reportJobId && <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />}

      <OnboardingTour profileCreatedAt={profile?.created_at} />
      <QuickApplyHandler searchParams={searchParams} user={user} allJobs={allJobs} onApply={handleApplyRequest} />
      <PushNotificationPrompt />

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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Not Interested?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDismissJob
                ? <>Are you sure you want to remove <span className="font-semibold text-foreground">"{confirmDismissJob.title}"</span> from your feed? You won't see this job again.</>
                : "Are you sure you want to remove this job from your feed?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep It</AlertDialogCancel>
            <AlertDialogAction onClick={handleDismissConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Yes, Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </PullToRefreshWrapper>
  );
};

export default Dashboard;
