import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, Star, Briefcase, Clock, Heart, HeartOff, Zap, CheckCircle, Mail, Phone } from "lucide-react";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { HelperPortfolio } from "@/components/HelperPortfolio";
import { RetainerAgreement } from "@/components/RetainerAgreement";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const UserProfile = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<{ rating: number; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string }[]>([]);
  const [stats, setStats] = useState({ completedJobs: 0, avgRating: 0, reviewCount: 0 });
  const [responseMetrics, setResponseMetrics] = useState<{ avgResponseHours: number | null; acceptanceRate: number | null; totalApplications: number }>({ avgResponseHours: null, acceptanceRate: null, totalApplications: 0 });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);

  useEffect(() => {
    if (!userId) return;
    loadAll();
  }, [userId]);

  const loadAll = async () => {
    if (!userId) return;
    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    setCurrentUserId(session?.user?.id || null);

    const [profileRes, reviewsRes, completedRes, favRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("reviews").select("rating, feedback, created_at, reviewer_id, job_id").eq("reviewee_id", userId).order("created_at", { ascending: false }),
      supabase.from("jobs").select("id").or(`customer_id.eq.${userId},helper_id.eq.${userId}`).eq("status", "completed"),
      session?.user
        ? supabase.from("favorite_helpers").select("id").eq("customer_id", session.user.id).eq("helper_id", userId)
        : Promise.resolve({ data: [] }),
    ]);

    if (profileRes.data) setProfile(profileRes.data);
    setIsFavorited((favRes.data?.length || 0) > 0);

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
      
      // Average response time: time between application created and updated (when accepted)
      const responseTimes = accepted
        .map(a => {
          const created = new Date(a.created_at).getTime();
          const updated = new Date(a.updated_at).getTime();
          return (updated - created) / (1000 * 60 * 60); // hours
        })
        .filter(h => h > 0 && h < 720); // filter out invalid (0) and very old (>30 days)

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
              <div className="flex items-center justify-center gap-2 mt-1 flex-wrap">
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">{profile.role}</span>
                {profile.location && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{profile.location}</span>
                )}
              </div>
              {(profile as any).email && (
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center justify-center gap-1">
                  <Mail className="w-3 h-3" />{(profile as any).email}
                </p>
              )}
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

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="flex items-center justify-center gap-1">
                <Briefcase className="w-4 h-4 text-primary" />
                <p className="text-2xl font-bold text-foreground">{stats.completedJobs}</p>
              </div>
              <p className="text-xs text-muted-foreground">Jobs Done</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="flex items-center justify-center gap-1">
                <Star className="w-4 h-4 text-primary fill-primary" />
                <p className="text-2xl font-bold text-foreground">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}</p>
              </div>
              <p className="text-xs text-muted-foreground">Rating</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <p className="text-2xl font-bold text-foreground">{stats.reviewCount}</p>
              <p className="text-xs text-muted-foreground">Reviews</p>
            </div>
          </div>

          {/* Response Metrics */}
          {responseMetrics.totalApplications > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> Response Metrics
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {responseMetrics.avgResponseHours !== null && (
                  <div className="rounded-lg bg-secondary/30 p-3 text-center">
                    <p className="text-lg font-bold text-foreground">
                      {responseMetrics.avgResponseHours < 1
                        ? `${Math.round(responseMetrics.avgResponseHours * 60)}m`
                        : responseMetrics.avgResponseHours < 24
                        ? `${responseMetrics.avgResponseHours.toFixed(1)}h`
                        : `${Math.round(responseMetrics.avgResponseHours / 24)}d`}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                      <Clock className="w-3 h-3" /> Avg Response
                    </p>
                  </div>
                )}
                {responseMetrics.acceptanceRate !== null && (
                  <div className="rounded-lg bg-secondary/30 p-3 text-center">
                    <p className="text-lg font-bold text-foreground">{responseMetrics.acceptanceRate.toFixed(0)}%</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Acceptance Rate
                    </p>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground text-center">Based on {responseMetrics.totalApplications} application{responseMetrics.totalApplications !== 1 ? "s" : ""}</p>
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

          {/* Reviews */}
          <div className="space-y-3">
            <h2 className="text-lg font-display font-semibold text-foreground">Reviews ({stats.reviewCount})</h2>
            {reviews.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center">
                <p className="text-sm text-muted-foreground">No reviews yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {reviews.map((r, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-primary text-primary" : "text-muted-foreground/30"}`} />
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">by {r.reviewerName}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">For: {r.jobTitle}</p>
                    {r.feedback && <p className="text-sm text-foreground">{r.feedback}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

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
