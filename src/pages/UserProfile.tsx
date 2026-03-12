import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, Star, Briefcase, Clock, Heart, HeartOff, Zap, CheckCircle, Phone, ClipboardList, Hammer } from "lucide-react";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { HelperPortfolio } from "@/components/HelperPortfolio";
import { RetainerAgreement } from "@/components/RetainerAgreement";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const statusColors: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  open: "bg-sky-100 text-sky-700",
  in_progress: "bg-amber-100 text-amber-700",
  cancelled: "bg-red-100 text-red-600",
  accepted: "bg-violet-100 text-violet-700",
  disputed: "bg-red-100 text-red-600",
  revision_requested: "bg-orange-100 text-orange-700",
};

const UserProfile = () => {
  usePageTitle("User Profile — Helpr");
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<{ rating: number; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string }[]>([]);
  const [stats, setStats] = useState({ completedJobs: 0, avgRating: 0, reviewCount: 0 });
  const [postedJobs, setPostedJobs] = useState<{ id: string; title: string; status: string; category: string; budget: number; created_at: string }[]>([]);
  const [workedJobs, setWorkedJobs] = useState<{ id: string; title: string; status: string; category: string; budget: number; created_at: string }[]>([]);
  const [responseMetrics, setResponseMetrics] = useState<{ avgResponseHours: number | null; acceptanceRate: number | null; totalApplications: number }>({ avgResponseHours: null, acceptanceRate: null, totalApplications: 0 });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [showPostedJobs, setShowPostedJobs] = useState(false);
  const [showWorkedJobs, setShowWorkedJobs] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", userId)
          .single();

        if (error) {
          console.error("Error fetching profile:", error);
          toast.error("Failed to load profile.");
        }

        if (data) {
          setProfile(data as Profile);
        } else {
          setProfile(null);
          toast.error("Profile not found.");
        }
      } catch (err) {
        console.error("Unexpected error:", err);
        toast.error("An unexpected error occurred.");
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      loadProfile();
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadAll();
  }, [userId]);

  const loadAll = async () => {
    if (!userId) return;
    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    setCurrentUserId(session?.user?.id || null);

    const [profileRes, reviewsRes, completedRes, favRes, postedRes, workedRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("reviews").select("rating, feedback, created_at, reviewer_id, job_id").eq("reviewee_id", userId).order("created_at", { ascending: false }),
      supabase.from("jobs").select("id").or(`customer_id.eq.${userId},helper_id.eq.${userId}`).eq("status", "completed"),
      session?.user
        ? supabase.from("favorite_helpers").select("id").eq("customer_id", session.user.id).eq("helper_id", userId)
        : Promise.resolve({ data: [] }),
      supabase.from("jobs").select("id, title, status, category, budget, created_at").eq("customer_id", userId).order("created_at", { ascending: false }).limit(20),
      supabase.from("jobs").select("id, title, status, category, budget, created_at").eq("helper_id", userId).order("created_at", { ascending: false }).limit(20),
    ]);

    if (profileRes.data) setProfile(profileRes.data);
    setIsFavorited((favRes.data?.length || 0) > 0);
    if (postedRes.data) setPostedJobs(postedRes.data);
    if (workedRes.data) setWorkedJobs(workedRes.data);

    const ratings = reviewsRes.data?.map(r => r.rating) || [];
    setStats({
      completedJobs: completedRes.data?.length || 0,
      avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0,
      reviewCount: ratings.length,
    });

    // Load response metrics (for helpers)
    const { data: allApps } = await supabase
      .from("applications")
      .select("status, created_at, updated_at")
      .eq("helper_id", userId);

    if (allApps && allApps.length > 0) {
      const accepted = allApps.filter(a => a.status === "accepted");
      const acceptanceRate = allApps.length > 0 ? (accepted.length / allApps.length) * 100 : null;
      const responseTimes = accepted
        .map(a => {
          const created = new Date(a.created_at).getTime();
          const updated = new Date(a.updated_at).getTime();
          return (updated - created) / (1000 * 60 * 60);
        })
        .filter(h => h > 0 && h < 720);

      setResponseMetrics({
        avgResponseHours: responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null,
        acceptanceRate,
        totalApplications: allApps.length,
      });
    }

    if (reviewsRes.data && reviewsRes.data.length > 0) {
      const reviewerIds = [...new Set(reviewsRes.data.map(r => r.reviewer_id))];
      const jobIds = [...new Set(reviewsRes.data.map(r => r.job_id))];
      const [profilesRes, jobsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", reviewerIds),
        supabase.from("jobs").select("id, title").in("id", jobIds),
      ]);
      const nameMap = new Map(profilesRes.data?.map(p => [p.user_id, p.full_name || "User"]) || []);
      const jobMap = new Map(jobsRes.data?.map(j => [j.id, j.title]) || []);
      setReviews(reviewsRes.data.map(r => ({
        rating: r.rating, feedback: r.feedback, created_at: r.created_at,
        reviewerName: nameMap.get(r.reviewer_id) || "User",
        jobTitle: jobMap.get(r.job_id) || "Job",
      })));
    }
    setLoading(false);
  };

  const toggleFavorite = async () => {
    if (!currentUserId || !userId) { navigate("/login"); return; }
    if (isFavorited) {
      await supabase.from("favorite_helpers").delete().eq("customer_id", currentUserId).eq("helper_id", userId);
      setIsFavorited(false);
      toast.success("Removed from favorites");
    } else {
      await supabase.from("favorite_helpers").insert({ customer_id: currentUserId, helper_id: userId });
      setIsFavorited(true);
      toast.success("Added to favorites");
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading…</p></div>;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">User not found</p>
          <Button onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </div>
    );
  }

  const initials = (profile.full_name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const badges = computeBadges({ avgRating: stats.avgRating, reviewCount: stats.reviewCount, completedJobs: stats.completedJobs, helprTier: (profile as any).subscription_tier || null });
  const isOwnProfile = currentUserId === userId;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          </div>
          {!isOwnProfile && currentUserId && (
            <Button variant="ghost" size="icon" onClick={toggleFavorite}>
              {isFavorited ? <Heart className="w-4 h-4 fill-destructive text-destructive" /> : <Heart className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-lg mx-auto space-y-5">
          {/* Profile Card */}
          <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-20 h-20 rounded-full mx-auto object-cover border-2 border-border" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto text-2xl font-bold">
                {initials}
              </div>
            )}
            <div>
              <h1 className="text-xl font-display font-bold text-foreground">{profile.full_name || "User"}</h1>
              {/* Response Metrics inline */}
              {responseMetrics.totalApplications > 0 && (
                <div className="flex items-center justify-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  {responseMetrics.avgResponseHours !== null && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {responseMetrics.avgResponseHours < 1
                        ? `${Math.round(responseMetrics.avgResponseHours * 60)}m`
                        : responseMetrics.avgResponseHours < 24
                        ? `${responseMetrics.avgResponseHours.toFixed(1)}h`
                        : `${Math.round(responseMetrics.avgResponseHours / 24)}d`} avg response
                    </span>
                  )}
                  {responseMetrics.acceptanceRate !== null && (
                    <span className="flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {responseMetrics.acceptanceRate.toFixed(0)}% acceptance
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-center gap-2 mt-1 flex-wrap">
                {profile.role !== "customer" && <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">{profile.role}</span>}
                {profile.location && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{profile.location}</span>
                )}
              </div>
              {profile.phone && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  <Phone className="w-3 h-3" />{profile.phone}
                </p>
              )}
              {profile.bio && <p className="text-sm text-muted-foreground mt-2">{profile.bio}</p>}
              {profile.skills && (
                <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                  {profile.skills.split(",").map((s, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">{s.trim()}</span>
                  ))}
                </div>
              )}
              <HelperBadges badges={badges} />
            </div>
          </div>

          {/* Stats - all 4 in one row */}
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="flex items-center justify-center gap-1">
                <Star className="w-3.5 h-3.5 text-primary fill-primary" />
                <p className="text-xl font-bold text-foreground">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}</p>
              </div>
              <p className="text-[10px] text-muted-foreground">Rating</p>
            </div>
            <button
              onClick={() => stats.reviewCount > 0 && setShowReviews(!showReviews)}
              className={`rounded-xl border bg-card p-3 text-center transition-all ${stats.reviewCount > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showReviews ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
            >
              <p className="text-xl font-bold text-foreground">{stats.reviewCount}</p>
              <p className="text-[10px] text-muted-foreground">Reviews</p>
            </button>
            <button
              onClick={() => postedJobs.length > 0 && setShowPostedJobs(!showPostedJobs)}
              className={`rounded-xl border bg-card p-3 text-center transition-all ${postedJobs.length > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showPostedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
            >
              <div className="flex items-center justify-center gap-1">
                <ClipboardList className="w-3.5 h-3.5 text-primary" />
                <p className="text-xl font-bold text-foreground">{postedJobs.length}</p>
              </div>
              <p className="text-[10px] text-muted-foreground">Posted</p>
            </button>
            <button
              onClick={() => workedJobs.length > 0 && setShowWorkedJobs(!showWorkedJobs)}
              className={`rounded-xl border bg-card p-3 text-center transition-all ${workedJobs.length > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showWorkedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
            >
              <div className="flex items-center justify-center gap-1">
                <Hammer className="w-3.5 h-3.5 text-primary" />
                <p className="text-xl font-bold text-foreground">{workedJobs.length}</p>
              </div>
              <p className="text-[10px] text-muted-foreground">Completed</p>
            </button>
          </div>

          {/* Reviews expanded inline */}
          {showReviews && reviews.length > 0 && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {reviews.map((r, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/20"}`} />
                        ))}
                      </div>
                      <span className="text-xs font-medium text-foreground">{r.reviewerName}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">For: {r.jobTitle}</p>
                  {r.feedback && <p className="text-sm text-foreground leading-relaxed">{r.feedback}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Posted Jobs expanded inline */}
          {showPostedJobs && postedJobs.length > 0 && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {postedJobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{job.title}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(job.created_at).toLocaleDateString()} · {job.category.replace("_", " ")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-primary">${job.budget}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[job.status] || "bg-muted text-muted-foreground"}`}>{job.status.replace("_", " ")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Worked Jobs expanded inline */}
          {showWorkedJobs && workedJobs.length > 0 && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {workedJobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{job.title}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(job.created_at).toLocaleDateString()} · {job.category.replace("_", " ")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-primary">${job.budget}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[job.status] || "bg-muted text-muted-foreground"}`}>{job.status.replace("_", " ")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {profile.hourly_rate && (
            <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
              <Clock className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">${profile.hourly_rate}/hr</p>
                <p className="text-xs text-muted-foreground">Hourly rate</p>
              </div>
            </div>
          )}

          {/* Portfolio */}
          {profile.role === "helper" && <HelperPortfolio helperId={userId!} />}

          {/* Retainer */}
          {!isOwnProfile && currentUserId && profile.role === "helper" && (
            <RetainerAgreement
              customerId={currentUserId}
              helperId={userId!}
              helperName={profile.full_name || "Helpr"}
            />
          )}

          {/* Member since */}
          <p className="text-xs text-muted-foreground text-center">
            Member since {new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
        </div>
      </main>
    </div>
  );
};

export default UserProfile;
