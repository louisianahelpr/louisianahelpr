import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Clock, XCircle, MapPin, Star, Briefcase, X } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import OnboardingTour from "@/components/OnboardingTour";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import JobFilters from "@/components/dashboard/JobFilters";
import JobCard from "@/components/dashboard/JobCard";
import JobDetailDialog from "@/components/dashboard/JobDetailDialog";
import InviteBanner from "@/components/dashboard/InviteBanner";
import BroadcastBanner from "@/components/BroadcastBanner";
import BirthdayPopup from "@/components/BirthdayPopup";
import type { EnrichedJob } from "@/components/dashboard/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

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
  usePageTitle("Dashboard — Helpr");
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [helprTier, setHelprTier] = useState<string | null>(null);

  useRealtimePush(user?.id ?? null);

  const [allJobs, setAllJobs] = useState<EnrichedJob[]>([]);
  const [platformFee, setPlatformFee] = useState(15);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [maxBudget, setMaxBudget] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expiresWithin, setExpiresWithin] = useState("");
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [recommendedJobs, setRecommendedJobs] = useState<EnrichedJob[]>([]);
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [showGreeting, setShowGreeting] = useState(() => {
    const dismissed = localStorage.getItem("greeting_dismissed_at");
    if (dismissed && Date.now() - parseInt(dismissed, 10) < 24 * 60 * 60 * 1000) return false;
    return true;
  });

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      setUser(session.user);
      await loadData(session.user.id);
      try {
        const { data } = await supabase.functions.invoke("check-pro-subscription");
        if (data?.subscribed) setHelprTier(data.tier);
      } catch {}
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      setUser(session.user);
      loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (userId: string) => {
    const [profileRes, rolesRes, openJobsRes, feeRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("jobs").select("*").eq("status", "open").order("created_at", { ascending: false }),
      supabase.from("platform_settings").select("platform_fee_percent").limit(1).single(),
    ]);

    if (feeRes.data) setPlatformFee(feeRes.data.platform_fee_percent);
    if (profileRes.data) {
      setProfile(profileRes.data);
      const userIsAdmin = rolesRes.data?.some((r) => r.role === "admin") ?? false;
      if (!userIsAdmin) {
        if (profileRes.data.approval_status === "pending") { navigate("/account-pending"); return; }
        if (profileRes.data.approval_status === "denied") { navigate("/account-denied"); return; }
      }
      setIsAdmin(userIsAdmin);
    } else {
      setIsAdmin(rolesRes.data?.some((r) => r.role === "admin") ?? false);
    }

    if (openJobsRes.data && openJobsRes.data.length > 0) {
      const posterIds = [...new Set(openJobsRes.data.map((j) => j.customer_id))];
      const [profilesRes, reviewsRes, completedJobsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", posterIds),
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", posterIds),
        supabase.from("jobs").select("customer_id").in("customer_id", posterIds).eq("status", "completed"),
      ]);
      const nameMap = new Map(profilesRes.data?.map((p) => [p.user_id, (p.full_name || "User").split(" ")[0]]) || []);
      const reviewMap = new Map<string, number[]>();
      reviewsRes.data?.forEach((r) => {
        if (!reviewMap.has(r.reviewee_id)) reviewMap.set(r.reviewee_id, []);
        reviewMap.get(r.reviewee_id)!.push(r.rating);
      });
      const completedMap = new Map<string, number>();
      completedJobsRes.data?.forEach((j) => {
        completedMap.set(j.customer_id, (completedMap.get(j.customer_id) || 0) + 1);
      });

      const now = new Date();
      const enriched = openJobsRes.data.map((j) => {
        const ratings = reviewMap.get(j.customer_id) || [];
        const isBoosted = !!j.boost_expires_at && new Date(j.boost_expires_at) > now;
        return {
          ...j,
          posterName: nameMap.get(j.customer_id) || "User",
          posterReviewCount: ratings.length,
          posterAvgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
          posterCompletedJobs: completedMap.get(j.customer_id) || 0,
          isBoosted,
        };
      });
      setAllJobs(enriched);

      // Build recommended jobs
      if (profileRes.data) {
        const userSkills = (profileRes.data.skills || "").toLowerCase().split(",").map((s: string) => s.trim()).filter(Boolean);
        const userLoc = (profileRes.data.location || "").toLowerCase();
        const scored = enriched
          .filter(j => j.customer_id !== userId)
          .map(j => {
            let score = 0;
            if (userLoc && j.location.toLowerCase().includes(userLoc)) score += 2;
            if (userSkills.some(s => j.category.includes(s) || j.title.toLowerCase().includes(s) || j.description.toLowerCase().includes(s))) score += 3;
            return { ...j, _score: score };
          })
          .filter(j => j._score > 0)
          .sort((a, b) => b._score - a._score)
          .slice(0, 5);
        setRecommendedJobs(scored);
      }
    } else {
      setAllJobs([]);
    }

    setLoading(false);
  };

  const handleApply = useCallback(async (jobId: string) => {
    if (!user) { navigate("/login"); return; }
    const job = allJobs.find((j) => j.id === jobId);
    if (job && job.customer_id === user.id) { toast.error("You can't apply to your own post."); return; }
    const { error } = await supabase.from("applications").insert({ job_id: jobId, helper_id: user.id, message: "I'd like to help with this task!" });
    if (error) {
      if (error.code === "23505") toast.error("You've already applied.");
      else toast.error(error.message);
    } else {
      toast.success("Application sent!");
    }
  }, [user, allJobs, navigate]);

  const hasFilters = [searchQuery, selectedCategory, maxBudget, locationFilter, expiresWithin].filter(Boolean).length > 0;
  const effectiveFee = platformFee;

  const filteredJobs = allJobs
    .filter((job) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!job.title.toLowerCase().includes(q) && !job.description.toLowerCase().includes(q)) return false;
      }
      if (selectedCategory && job.category !== selectedCategory) return false;
      if (maxBudget && job.budget > parseFloat(maxBudget)) return false;
      if (locationFilter && !job.location.toLowerCase().includes(locationFilter.toLowerCase())) return false;
      if (expiresWithin && job.expires_at) {
        const hoursLeft = (new Date(job.expires_at).getTime() - Date.now()) / (1000 * 60 * 60);
        if (expiresWithin === "24h" && hoursLeft > 24) return false;
        if (expiresWithin === "3d" && hoursLeft > 72) return false;
        if (expiresWithin === "7d" && hoursLeft > 168) return false;
      }
      if (expiresWithin && !job.expires_at) return false;
      if (profile?.role === "helper") {
        const jobAge = Date.now() - new Date(job.created_at).getTime();
        const earlyMinutes = helprTier === "elite" ? 20 : helprTier === "pro" ? 10 : helprTier === "basic" ? 5 : 0;
        const delayMs = (20 - earlyMinutes) * 60 * 1000;
        if (jobAge < delayMs) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aUrgent = a.is_urgent;
      const bUrgent = b.is_urgent;
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      if (a.isBoosted && !b.isBoosted) return -1;
      if (!a.isBoosted && b.isBoosted) return 1;
      switch (sortBy) {
        case "highest_pay": return b.budget - a.budget;
        case "lowest_pay": return a.budget - b.budget;
        case "ending_soon": return new Date(a.date_needed).getTime() - new Date(b.date_needed).getTime();
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

  const userLocation = profile?.location?.toLowerCase() || "";
  const nearbyJobs = userLocation
    ? allJobs.filter((j) => j.location.toLowerCase().includes(userLocation) || userLocation.includes(j.location.toLowerCase())).slice(0, 5)
    : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
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
        <DashboardHeader isAdmin={false} />
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

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <DashboardHeader isAdmin={isAdmin} />
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
            {/* Decorative background circles */}
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
                  Welcome back — let's get things done today!
                </p>
                <p className="text-xs text-primary/80 mt-1 italic">
                  {(() => {
                    const messages = [
                      "Thank you for being part of the Helpr community — we appreciate you! 💚",
                      "You make this community stronger just by showing up. Keep going! 💪",
                      "Every task completed is someone's day made better. You're amazing! ✨",
                      "Together we lift each other up — that's the Helpr way! 🤝",
                      "Your kindness ripples through the whole community. Thank you! 🌊",
                      "Helpers and customers alike — you're the heartbeat of Helpr! ❤️",
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
                    const dayIndex = Math.floor(Date.now() / 86400000) % messages.length;
                    return messages[dayIndex];
                  })()}
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
          {nearbyJobs.length > 0 && !hasFilters && (
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
                {nearbyJobs.slice(0, 3).map((job, i) => (
                  <JobCard key={job.id} job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApply} onReport={setReportJobId} onSelect={setDetailJob} index={i} />
                ))}
              </div>
              {nearbyJobs.length > 3 && (
                <button onClick={() => setLocationFilter(profile?.location || "")} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                  View all {nearbyJobs.length} nearby jobs →
                </button>
              )}
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            </motion.section>
          )}

          {/* Recommended for You */}
          {recommendedJobs.length > 0 && !hasFilters && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center">
                  <Star className="w-3.5 h-3.5 text-accent fill-accent" />
                </div>
                <h2 className="text-sm font-display font-bold text-foreground">Recommended for You</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">based on skills</span>
              </div>
              <div className="space-y-3">
                {recommendedJobs.slice(0, 3).map((job, i) => (
                  <JobCard key={job.id} job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApply} onReport={setReportJobId} onSelect={setDetailJob} index={i} />
                ))}
              </div>
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            </motion.section>
          )}

          {/* Filters */}
          <JobFilters
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
            maxBudget={maxBudget} setMaxBudget={setMaxBudget}
            locationFilter={locationFilter} setLocationFilter={setLocationFilter}
            sortBy={sortBy} setSortBy={setSortBy}
            filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen}
            expiresWithin={expiresWithin} setExpiresWithin={setExpiresWithin}
          />

          {/* All Tasks header */}
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-display font-bold text-foreground">
              {hasFilters ? "Filtered Results" : "All Tasks"}
            </h2>
            <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {filteredJobs.length} active
            </span>
          </div>

          {/* Job list */}
          {filteredJobs.length === 0 ? (
            <div className="text-center py-16 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mx-auto">
                <Briefcase className="w-7 h-7 text-primary/50" />
              </div>
              <div>
                <p className="font-display font-semibold text-foreground">{hasFilters ? "No matching tasks" : "No open tasks right now"}</p>
                <p className="text-sm text-muted-foreground mt-1">{hasFilters ? "Try adjusting your filters" : "Check back soon — new tasks are posted daily!"}</p>
              </div>
              {hasFilters && (
                <Button variant="outline" onClick={() => { setSearchQuery(""); setSelectedCategory(null); setMaxBudget(""); setLocationFilter(""); }}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJobs.map((job, i) => (
                <JobCard key={job.id} job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApply} onReport={setReportJobId} onSelect={setDetailJob} index={i} />
              ))}
            </div>
          )}
        </div>
      </main>

      <JobDetailDialog job={detailJob} effectiveFee={effectiveFee} onClose={() => setDetailJob(null)} onApply={handleApply} onReport={setReportJobId} />

      {reportJobId && <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />}

      <OnboardingTour />
      <QuickApplyHandler searchParams={searchParams} user={user} allJobs={allJobs} onApply={handleApply} />
      <PushNotificationPrompt />
    </div>
  );
};

export default Dashboard;
