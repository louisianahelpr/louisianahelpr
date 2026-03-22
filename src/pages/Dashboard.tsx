import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock, XCircle, MapPin, Star, Briefcase, X, Search, SlidersHorizontal } from "lucide-react";
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
  const confirmApplyJob = allJobs.find((j) => j.id === confirmApplyJobId) || null;
  const [showGreeting, setShowGreeting] = useState(() => {
    const dismissed = localStorage.getItem("greeting_dismissed_at");
    if (dismissed && Date.now() - parseInt(dismissed, 10) < 24 * 60 * 60 * 1000) return false;
    return true;
  });

  const effectiveFee = platformFee;

  const handleApplyRequest = useCallback((jobId: string) => {
    if (!user) { navigate("/login"); return; }
    const job = allJobs.find((j) => j.id === jobId);
    if (job && job.customer_id === user.id) { toast.error("You can't apply to your own post."); return; }
    setConfirmApplyJobId(jobId);
  }, [user, allJobs, navigate]);

  const handleApplyConfirm = useCallback(async () => {
    if (!user || !confirmApplyJobId) return;
    const { error } = await supabase.from("applications").insert({ job_id: confirmApplyJobId, helper_id: user.id, message: "I'd like to help with this task!" });
    if (error) {
      if (error.code === "23505") toast.error("You've already applied.");
      else toast.error(error.message);
    } else {
      toast.success("Application sent!");
    }
    setConfirmApplyJobId(null);
  }, [user, confirmApplyJobId]);

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
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="rounded-2xl bg-gradient-to-br from-primary/10 via-accent/6 to-primary/4 p-5 border border-primary/12 relative overflow-hidden"
          >
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-primary/[0.04] blur-xl" />
            <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-accent/[0.06] blur-xl" />
            <button
              onClick={() => { setShowGreeting(false); localStorage.setItem("greeting_dismissed_at", Date.now().toString()); }}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss greeting"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-display font-bold text-foreground">
                  Hi, {firstName} 👋
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Browse tasks to help with, or post your own.
                </p>
              </div>
              <Button
                onClick={() => navigate("/post-job")}
                size="sm"
                className="sm:hidden bg-gradient-to-r from-primary to-primary/80 shadow-md gap-1"
              >
                <Briefcase className="w-4 h-4" /> Post
              </Button>
            </div>
          </motion.div>
          )}

          {/* Invite Friends Banner */}
          {user && <InviteBanner userId={user.id} />}

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
                {filters.nearbyJobs.slice(0, 3).map((job, i) => (
                  <JobCard key={job.id} job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} />
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
                {recommendedJobs.slice(0, 3).map((job, i) => (
                  <JobCard key={job.id} job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} />
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
                {filters.filteredJobs.map((job, i) => (
                  <div key={job.id} className="px-3 py-2.5 first:pt-3 last:pb-3">
                    <JobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={(id) => setExpandedCardId(expandedCardId === id ? null : id)} />
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>
      </main>

      <JobDetailDialog job={detailJob} effectiveFee={effectiveFee} onClose={() => setDetailJob(null)} onApply={handleApplyRequest} onReport={setReportJobId} />

      {reportJobId && <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />}

      <OnboardingTour />
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
                      <div className="flex justify-between">
                        <span className="font-semibold text-foreground">Your Payout</span>
                        <span className="font-bold text-primary">
                          ${((confirmApplyJob.budget * (1 - platformFee / 100) - (confirmApplyJob.budget * platformFee / 100 * 0.085)) + (confirmApplyJob.urgent_fee ?? 0)).toFixed(2)}
                        </span>
                      </div>
                      {(confirmApplyJob.urgent_fee ?? 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground text-xs">Includes Urgent Tip</span>
                          <span className="text-xs text-accent">+${Number(confirmApplyJob.urgent_fee).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                : <p>Are you sure you want to apply for this task?</p>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApplyConfirm}>Yes, Apply</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </PullToRefreshWrapper>
  );
};

export default Dashboard;
