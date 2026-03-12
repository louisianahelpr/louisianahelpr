import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LogOut, Search, X, Flag, MapPin, Calendar, DollarSign,
  SlidersHorizontal, ChevronDown, ChevronUp, Clock, XCircle,
  Shield, Briefcase, Star, ImageIcon, Rocket, Heart, Zap, ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import NotificationPanel from "@/components/NotificationPanel";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import OnboardingTour from "@/components/OnboardingTour";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useRealtimePush } from "@/hooks/useRealtimePush";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { usePageTitle } from "@/hooks/usePageTitle";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

// Quick Apply handler for notification deep links
const QuickApplyHandler = ({ searchParams, user, allJobs, onApply }: {
  searchParams: URLSearchParams;
  user: SupaUser | null;
  allJobs: any[];
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
            action: {
              label: "Apply now",
              onClick: () => onApply(quickApplyId),
            },
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
  const [isProHelpr, setIsProHelpr] = useState(false);
  const [helprTier, setHelprTier] = useState<string | null>(null);

  // Enable realtime push notifications
  useRealtimePush(user?.id ?? null);

  const [allJobs, setAllJobs] = useState<(Job & { posterName?: string; posterReviewCount?: number; posterAvgRating?: number; posterCompletedJobs?: number; isBoosted?: boolean })[]>([]);
  const [platformFee, setPlatformFee] = useState(15);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [maxBudget, setMaxBudget] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [recommendedJobs, setRecommendedJobs] = useState<(Job & { posterName?: string; posterReviewCount?: number; posterAvgRating?: number; posterCompletedJobs?: number; isBoosted?: boolean })[]>([]);

  // Job detail dialog
  const [detailJob, setDetailJob] = useState<(Job & { posterName?: string; posterReviewCount?: number; posterAvgRating?: number; posterCompletedJobs?: number; isBoosted?: boolean }) | null>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      setUser(session.user);
      await loadData(session.user.id);
      // Check Pro subscription
      try {
        const { data } = await supabase.functions.invoke("check-pro-subscription");
        if (data?.subscribed) {
          setIsProHelpr(true);
          setHelprTier(data.tier);
        }
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
      // Gate: redirect based on approval status (admins bypass)
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
      setAllJobs(openJobsRes.data.map((j) => {
        const ratings = reviewMap.get(j.customer_id) || [];
        const isBoosted = !!(j as any).boost_expires_at && new Date((j as any).boost_expires_at) > now;
        return {
          ...j,
          posterName: nameMap.get(j.customer_id) || "User",
          posterReviewCount: ratings.length,
          posterAvgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
          posterCompletedJobs: completedMap.get(j.customer_id) || 0,
          isBoosted,
        };
      }));
    } else {
      setAllJobs([]);
    }

    // Build recommended jobs based on user skills + location
    if (profileRes.data && openJobsRes.data) {
      const userSkills = (profileRes.data.skills || "").toLowerCase().split(",").map((s: string) => s.trim()).filter(Boolean);
      const userLoc = (profileRes.data.location || "").toLowerCase();
      const enrichedJobs = allJobs.length > 0 ? allJobs : (openJobsRes.data || []).map(j => ({ ...j }));
      
      const scored = enrichedJobs
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

    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  const handleApply = async (jobId: string) => {
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
  };

  const clearFilters = () => { setSearchQuery(""); setSelectedCategory(null); setMaxBudget(""); setLocationFilter(""); };
  const activeFilterCount = [searchQuery, selectedCategory, maxBudget, locationFilter].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  // Use standard platform fee for all tiers
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
      // Early access: Elite 20 min, Pro 10 min, Basic 5 min
      if (profile?.role === "helper") {
        const jobAge = Date.now() - new Date(job.created_at).getTime();
        const earlyMinutes = helprTier === "elite" ? 20 : helprTier === "pro" ? 10 : helprTier === "basic" ? 5 : 0;
        const delayMs = (20 - earlyMinutes) * 60 * 1000;
        if (jobAge < delayMs) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Urgent & boosted always first
      const aUrgent = (a as any).is_urgent;
      const bUrgent = (b as any).is_urgent;
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      if (a.isBoosted && !b.isBoosted) return -1;
      if (!a.isBoosted && b.isBoosted) return 1;
      // Then apply sort
      switch (sortBy) {
        case "highest_pay": return b.budget - a.budget;
        case "lowest_pay": return a.budget - b.budget;
        case "ending_soon": return new Date(a.date_needed).getTime() - new Date(b.date_needed).getTime();
        case "newest":
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

  // "Jobs Near You" - jobs matching user's location
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
          <div className="max-w-3xl mx-auto">
            <DashboardSkeleton />
          </div>
        </main>
      </div>
    );
  }

  const firstName = (profile?.full_name || user?.user_metadata?.full_name || "User").split(" ")[0];
  const approvalStatus = (profile as any)?.approval_status || "pending";
  const banStatus = (profile as any)?.ban_status || "active";

  // Block banned users
  if (!isAdmin && (banStatus === "permanently_banned" || banStatus === "temp_banned")) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <XCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">Account {banStatus === "permanently_banned" ? "Permanently Banned" : "Temporarily Suspended"}</h1>
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
        <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto flex items-center justify-between h-16 px-4">
            <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
            <Button variant="ghost" size="icon" onClick={handleLogout}><LogOut className="w-4 h-4" /></Button>
          </div>
        </header>
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

  const photos = detailJob?.photos || [];

  const renderJobCard = (job: typeof filteredJobs[0], showApply = true) => {
    const posterBadges = computeBadges({
      avgRating: job.posterAvgRating || 0,
      reviewCount: job.posterReviewCount || 0,
      completedJobs: job.posterCompletedJobs || 0,
    });

    return (
      <div
        key={job.id}
        className={`rounded-xl border bg-card p-4 hover:shadow-md transition-shadow cursor-pointer ${job.isBoosted ? "border-primary/40 ring-1 ring-primary/20" : "border-border"}`}
        onClick={() => setDetailJob(job)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {(job as any).is_urgent && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent-foreground text-[10px] font-semibold">
                  <Zap className="w-3 h-3 text-accent" /> Urgent
                </span>
              )}
              {job.isBoosted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                  <Rocket className="w-3 h-3" /> Boosted
                </span>
              )}
              <h3 className="font-semibold text-foreground">{job.title}</h3>
              <Badge variant="secondary" className="text-xs">{categoryLabels[job.category] || job.category}</Badge>
              {job.photos && job.photos.length > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <ImageIcon className="w-3 h-3" /> {job.photos.length}
                </span>
              )}
              {(job as any).is_group_job && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-accent/20 text-accent-foreground text-[10px] font-semibold">
                  👥 Group · {(job as any).helpers_needed} needed
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">{job.description}</p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
              <span className="flex items-center gap-1 font-medium text-primary"><DollarSign className="w-3 h-3" /> You earn ${(job.budget * (1 - effectiveFee / 100)).toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 flex-wrap">
              <span>Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => { e.stopPropagation(); }} className="font-medium text-primary hover:underline">{job.posterName}</a></span>
              {job.posterReviewCount !== undefined && job.posterReviewCount > 0 && (
                <span className="flex items-center gap-0.5">
                  <Star className="w-3 h-3 fill-accent text-accent" />
                  {job.posterAvgRating?.toFixed(1)} ({job.posterReviewCount})
                </span>
              )}
              <HelperBadges badges={posterBadges} />
            </div>
          </div>
          {showApply && user?.id !== job.customer_id && (
            <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" onClick={() => handleApply(job.id)}>Apply</Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setReportJobId(job.id)}><Flag className="w-3.5 h-3.5" /></Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Badges for detail dialog poster
  const detailPosterBadges = detailJob ? computeBadges({
    avgRating: detailJob.posterAvgRating || 0,
    reviewCount: detailJob.posterReviewCount || 0,
    completedJobs: detailJob.posterCompletedJobs || 0,
  }) : [];

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <Link to="/dashboard" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
                <Shield className="w-4 h-4 text-destructive" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate("/post-job")} className="hidden sm:flex">
              <Briefcase className="w-4 h-4 mr-1" /> Post task
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate("/favorites")} title="Favorite Helprs">
              <Heart className="w-4 h-4" />
            </Button>
            <NotificationPanel />
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <p className="text-lg font-display font-semibold text-foreground">Hi, {firstName} 👋</p>

          {/* Jobs Near You */}
          {nearbyJobs.length > 0 && !hasFilters && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Jobs Near You</h2>
                <span className="text-xs text-muted-foreground">in {profile?.location}</span>
              </div>
              <div className="space-y-2">
                {nearbyJobs.slice(0, 3).map((job) => renderJobCard(job))}
              </div>
              {nearbyJobs.length > 3 && (
                <button
                  onClick={() => setLocationFilter(profile?.location || "")}
                  className="text-xs text-primary font-medium hover:underline"
                >
                  View all {nearbyJobs.length} nearby jobs →
                </button>
              )}
              <div className="h-px bg-border" />
            </div>
          )}
          {/* Recommended for You */}
          {recommendedJobs.length > 0 && !hasFilters && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Recommended for You</h2>
                <span className="text-xs text-muted-foreground">based on your skills</span>
              </div>
              <div className="space-y-2">
                {recommendedJobs.slice(0, 3).map((job) => renderJobCard(job))}
              </div>
              <div className="h-px bg-border" />
            </div>
          )}

          {/* Filters */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search tasks…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-10" />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button onClick={() => setFiltersOpen(!filtersOpen)} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
              <SlidersHorizontal className="w-4 h-4" /><span>Filters</span>
              {activeFilterCount > 0 && <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">{activeFilterCount}</span>}
              <span className="flex-1" />
              {filtersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {filtersOpen && (
              <div className="space-y-4 pt-2 border-t border-border">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Category</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <button key={key} onClick={() => setSelectedCategory(selectedCategory === key ? null : key)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selectedCategory === key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Location</p>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input placeholder="Any location" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="pl-9 text-sm" />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Max budget</p>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input type="number" placeholder="No limit" value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} className="pl-9 text-sm" />
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Sort by</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { value: "newest", label: "Newest" },
                      { value: "highest_pay", label: "Highest pay" },
                      { value: "lowest_pay", label: "Lowest pay" },
                      { value: "ending_soon", label: "Ending soon" },
                    ].map((opt) => (
                      <button key={opt.value} onClick={() => setSortBy(opt.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${sortBy === opt.value ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Clear all</Button>}
              </div>
            )}
            {!filtersOpen && hasFilters && (
              <div className="flex flex-wrap gap-1.5">
                {selectedCategory && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{categoryLabels[selectedCategory]}<button onClick={() => setSelectedCategory(null)}><X className="w-3 h-3" /></button></span>}
                {locationFilter && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{locationFilter}<button onClick={() => setLocationFilter("")}><X className="w-3 h-3" /></button></span>}
                {maxBudget && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">≤ ${maxBudget}<button onClick={() => setMaxBudget("")}><X className="w-3 h-3" /></button></span>}
              </div>
            )}
          </div>

          {/* Job list */}
          {filteredJobs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">{hasFilters ? "No tasks match your filters." : "No open tasks right now."}</p>
              {hasFilters && <Button variant="outline" className="mt-4" onClick={clearFilters}>Clear filters</Button>}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJobs.map((job) => renderJobCard(job))}
            </div>
          )}
        </div>
      </main>

      {/* Job Detail Dialog */}
      <Dialog open={!!detailJob} onOpenChange={() => setDetailJob(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{detailJob?.title}</DialogTitle>
          </DialogHeader>
          {detailJob && (
            <div className="space-y-4">
              {/* Boosted badge */}
              {detailJob.isBoosted && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  <Rocket className="w-3 h-3" /> Boosted Post
                </span>
              )}

              {/* Photos */}
              {photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {photos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                      <img src={url} alt={`Photo ${i + 1}`} className="w-32 h-24 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                    </a>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{categoryLabels[detailJob.category] || detailJob.category}</Badge>
                <span className="text-xs text-muted-foreground">
                  Posted {new Date(detailJob.created_at).toLocaleDateString()}
                </span>
              </div>

              <p className="text-sm text-foreground">{detailJob.description}</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> You Earn</p>
                  <p className="font-semibold text-primary">${(detailJob.budget * (1 - effectiveFee / 100)).toFixed(2)}</p>
                </div>
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</p>
                  <p className="font-semibold text-foreground">{detailJob.location}</p>
                </div>
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Date Needed</p>
                  <p className="font-semibold text-foreground">{new Date(detailJob.date_needed).toLocaleDateString()}</p>
                </div>
                {detailJob.start_time && (
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Start Time</p>
                    <p className="font-semibold text-foreground">{detailJob.start_time}</p>
                  </div>
                )}
                {detailJob.estimated_hours && (
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
                    <p className="font-semibold text-foreground">{detailJob.estimated_hours}h</p>
                  </div>
                )}
              </div>

              {detailJob.special_requirements && (
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Special Requirements</p>
                  <p className="text-sm text-foreground">{detailJob.special_requirements}</p>
                </div>
              )}

              {/* Poster info with badges */}
              <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
                <span className="text-sm text-muted-foreground">
                  Posted by <a href={`/user/${detailJob.customer_id}`} className="font-medium text-primary hover:underline">{detailJob.posterName}</a>
                </span>
                {detailJob.posterReviewCount !== undefined && detailJob.posterReviewCount > 0 && (
                  <span className="flex items-center gap-0.5 text-sm">
                    <Star className="w-3.5 h-3.5 fill-accent text-accent" />
                    <span className="text-foreground font-medium">{detailJob.posterAvgRating?.toFixed(1)}</span>
                    <span className="text-muted-foreground">({detailJob.posterReviewCount})</span>
                  </span>
                )}
                <HelperBadges badges={detailPosterBadges} />
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={() => { handleApply(detailJob.id); setDetailJob(null); }}>
                  Apply for this task
                </Button>
                <Button variant="outline" size="icon" onClick={() => { setReportJobId(detailJob.id); setDetailJob(null); }}>
                  <Flag className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {reportJobId && <ReportDialog open={!!reportJobId} onClose={() => setReportJobId(null)} reportedType="job" reportedId={reportJobId} />}

      {/* Onboarding Tour */}
      <OnboardingTour />

      {/* Quick Apply from notification link */}
      <QuickApplyHandler searchParams={searchParams} user={user} allJobs={allJobs} onApply={handleApply} />
      
      {/* Push notification permission prompt */}
      <PushNotificationPrompt />
    </div>
  );
};

export default Dashboard;
