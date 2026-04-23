import { useEffect, useState, useMemo } from "react";
import { formatName } from "@/lib/utils";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, MapPin, Star, Briefcase, Clock, Zap, CheckCircle, Phone, ClipboardList, Hammer, ShieldCheck, MoreVertical, Flag, Ban } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { HelperAvailabilityDisplay } from "@/components/HelperAvailabilityDisplay";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { HelperPortfolio } from "@/components/HelperPortfolio";
import { ParishBadges } from "@/components/ParishBadges";
import { RetainerAgreement } from "@/components/RetainerAgreement";
import ReportDialog from "@/components/ReportDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import SaveHelperButton from "@/components/SaveHelperButton";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const statusColors: Record<string, string> = {
  completed: "bg-secondary text-secondary-foreground",
  open: "bg-primary/10 text-primary",
  in_progress: "bg-accent/20 text-accent-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  accepted: "bg-primary/10 text-primary",
  disputed: "bg-destructive/10 text-destructive",
  revision_requested: "bg-accent/20 text-accent-foreground",
};

const UserProfile = () => {
  usePageTitle("User Profile — Helpr");
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user: currentAuthUser } = useCurrentUser();
  const currentUserId = currentAuthUser?.id ?? null;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<{ rating: number; punctuality: number | null; quality: number | null; communication: number | null; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string }[]>([]);
  const [stats, setStats] = useState({ completedJobs: 0, avgRating: 0, reviewCount: 0 });
  const [postedJobs, setPostedJobs] = useState<{ id: string; title: string; status: string; category: string; budget: number; created_at: string }[]>([]);
  const [workedJobs, setWorkedJobs] = useState<{ id: string; title: string; status: string; category: string; budget: number; created_at: string }[]>([]);
  const [responseMetrics, setResponseMetrics] = useState<{ avgResponseHours: number | null; acceptanceRate: number | null; totalApplications: number }>({ avgResponseHours: null, acceptanceRate: null, totalApplications: 0 });
  const [isIdVerified, setIsIdVerified] = useState(false);
  
  const [showReviews, setShowReviews] = useState(searchParams.get("tab") === "reviews");
  const [showPostedJobs, setShowPostedJobs] = useState(false);
  const [showWorkedJobs, setShowWorkedJobs] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showBlock, setShowBlock] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const loadAll = async () => {
      setLoading(true);
      const t0 = performance.now();

      // Step 1: Get profile first
      const profileRes = await supabase.rpc("get_safe_profiles", { user_ids: [userId] });
      
      if (!profileRes.data || profileRes.data.length === 0) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const prof = profileRes.data[0] as any;
      setProfile(prof);

      // Step 2: Remaining queries in parallel
      const isHelper = prof.role === "helper";
      const t1 = performance.now();
      const [reviewsRes, postedRes, workedRes, appsRes, idCheckRes] = await Promise.all([
        supabase.from("reviews").select("rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id").eq("reviewee_id", userId).order("created_at", { ascending: false }),
        supabase.from("jobs").select("id, title, status, category, budget, created_at").eq("customer_id", userId).order("created_at", { ascending: false }).limit(20),
        supabase.from("jobs").select("id, title, status, category, budget, created_at").eq("helper_id", userId).order("created_at", { ascending: false }).limit(20),
        isHelper
          ? supabase.from("applications").select("status, created_at, updated_at").eq("helper_id", userId)
          : Promise.resolve({ data: null }),
        supabase.from("profiles").select("id_document_url").eq("user_id", userId).single(),
      ]);
      setIsIdVerified(!!idCheckRes.data?.id_document_url);
      

      if (postedRes.data) setPostedJobs(postedRes.data);
      if (workedRes.data) setWorkedJobs(workedRes.data);

      // Derive completed count from posted + worked (no extra query)
      const allJobs = [...(postedRes.data || []), ...(workedRes.data || [])];
      const completedCount = new Set(allJobs.filter(j => j.status === "completed").map(j => j.id)).size;

      const ratings = reviewsRes.data?.map((r: any) => r.rating) || [];
      setStats({
        completedJobs: completedCount,
        avgRating: ratings.length > 0 ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : 0,
        reviewCount: ratings.length,
      });

      // Response metrics (only for helpers)
      if (isHelper && appsRes?.data && appsRes.data.length > 0) {
        const allApps = appsRes.data;
        const accepted = allApps.filter((a: any) => a.status === "accepted");
        const acceptanceRate = allApps.length > 0 ? (accepted.length / allApps.length) * 100 : null;
        const responseTimes = accepted
          .map((a: any) => {
            const created = new Date(a.created_at).getTime();
            const updated = new Date(a.updated_at).getTime();
            return (updated - created) / (1000 * 60 * 60);
          })
          .filter((h: number) => h > 0 && h < 720);
        setResponseMetrics({
          avgResponseHours: responseTimes.length > 0 ? responseTimes.reduce((a: number, b: number) => a + b, 0) / responseTimes.length : null,
          acceptanceRate,
          totalApplications: allApps.length,
        });
      }

      // Enrich reviews with names
      if (reviewsRes.data && reviewsRes.data.length > 0) {
        const t2 = performance.now();
        const reviewerIds = [...new Set(reviewsRes.data.map((r: any) => r.reviewer_id))] as string[];
        const jobIds = [...new Set(reviewsRes.data.map((r: any) => r.job_id))] as string[];
        const [profilesRes2, jobsRes] = await Promise.all([
          supabase.rpc("get_safe_profiles", { user_ids: reviewerIds }),
          supabase.from("jobs").select("id, title").in("id", jobIds),
        ]);
        
        const nameMap = new Map(profilesRes2.data?.map((p: any) => [p.user_id, formatName(p.full_name)]) || []);
        const jobMap = new Map(jobsRes.data?.map((j: any) => [j.id, j.title]) || []);
        setReviews(reviewsRes.data.map((r: any) => ({
          rating: r.rating,
          punctuality: r.punctuality ?? null,
          quality: r.quality ?? null,
          communication: r.communication ?? null,
          feedback: r.feedback,
          created_at: r.created_at,
          reviewerName: nameMap.get(r.reviewer_id) || "User",
          jobTitle: jobMap.get(r.job_id) || "Job",
        })));
      }

      
      setLoading(false);
    };

    loadAll();
  }, [userId]);


  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <DashboardHeader />
        <main className="container mx-auto px-4 py-6">
          <div className="max-w-lg mx-auto space-y-5">
            <div className="h-9 w-32 rounded-xl bg-muted animate-pulse" />
            <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-muted animate-pulse mx-auto" />
              <div className="h-6 w-40 bg-muted animate-pulse mx-auto rounded" />
              <div className="h-4 w-24 bg-muted animate-pulse mx-auto rounded" />
              <div className="h-4 w-64 bg-muted animate-pulse mx-auto rounded" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="h-7 w-10 bg-muted animate-pulse mx-auto rounded" />
                  <div className="h-3 w-12 bg-muted animate-pulse mx-auto rounded" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
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

  const displayName = formatName(profile.full_name);
  const initials = (profile.full_name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const badges = computeBadges({ avgRating: stats.avgRating, reviewCount: stats.reviewCount, completedJobs: stats.completedJobs, helprTier: (profile as any).subscription_tier || null });
  const isOwnProfile = currentUserId === userId;

  return (
    <div className="min-h-screen bg-background pb-20">
      <PageHeader
        title="Profile Review"
        rightSlot={
          !isOwnProfile && currentUserId ? (
            <div className="flex items-center gap-1">
              {profile.role === "helper" && (
                <SaveHelperButton helperId={userId!} customerId={currentUserId} />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9 shrink-0" aria-label="More options">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {profile.role === "helper" && (
                    <DropdownMenuItem onClick={() => navigate(`/post-job?offerTo=${userId}`)}>
                      <Briefcase className="w-4 h-4 mr-2" /> Offer a job directly
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setShowReport(true)}>
                    <Flag className="w-4 h-4 mr-2" /> Report user
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowBlock(true)}>
                    <Ban className="w-4 h-4 mr-2" /> Block user
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null
        }
      />

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
              <div className="flex items-center justify-center gap-1.5">
                <h1 className="text-xl font-display font-bold text-foreground">{displayName}</h1>
                {isIdVerified && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider" title="ID Verified">
                    <ShieldCheck className="w-3.5 h-3.5" /> Verified
                  </span>
                )}
              </div>
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
              <div className="pt-1">
                <ParishBadges userId={userId!} />
              </div>
            </div>
          </div>

          {/* Stats */}
          {(() => {
            const activeSection = showReviews ? "reviews" : showPostedJobs ? "posted" : showWorkedJobs ? "worked" : null;
            const hasSelection = activeSection !== null && !isOwnProfile;

            const reviewBtn = (
              <button
                key="reviews"
                onClick={() => {
                  setShowReviews(!showReviews);
                  setShowPostedJobs(false);
                  setShowWorkedJobs(false);
                }}
                className={`rounded-xl border bg-card p-3 text-center transition-all cursor-pointer hover:border-primary/30 hover:shadow-sm ${showReviews ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <Star className="w-3.5 h-3.5 text-primary fill-primary" />
                  <p className="text-xl font-bold text-foreground">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">{stats.reviewCount} Review{stats.reviewCount !== 1 ? "s" : ""}</p>
              </button>
            );

            const postedBtn = (
              <button
                key="posted"
                onClick={() => {
                  if (postedJobs.length > 0) {
                    setShowPostedJobs(!showPostedJobs);
                    setShowReviews(false);
                    setShowWorkedJobs(false);
                  }
                }}
                className={`rounded-xl border bg-card p-3 text-center transition-all ${postedJobs.length > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showPostedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <ClipboardList className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xl font-bold text-foreground">{postedJobs.length}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">Posted</p>
              </button>
            );

            const workedBtn = (
              <button
                key="worked"
                onClick={() => {
                  if (workedJobs.length > 0) {
                    setShowWorkedJobs(!showWorkedJobs);
                    setShowReviews(false);
                    setShowPostedJobs(false);
                  }
                }}
                className={`rounded-xl border bg-card p-3 text-center transition-all ${workedJobs.length > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showWorkedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <Hammer className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xl font-bold text-foreground">{workedJobs.length}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">Completed</p>
              </button>
            );

            if (isOwnProfile) {
              return (
                <div className="grid grid-cols-3 gap-2">
                  {reviewBtn}
                  {postedBtn}
                  {workedBtn}
                </div>
              );
            }

            // For other users: show only the selected button, or all if none selected
            if (hasSelection) {
              return (
                <div className="grid grid-cols-1 gap-2">
                  {activeSection === "reviews" && reviewBtn}
                  {activeSection === "posted" && postedBtn}
                  {activeSection === "worked" && workedBtn}
                </div>
              );
            }

            return (
              <div className="grid grid-cols-3 gap-2">
                {reviewBtn}
                {postedBtn}
                {workedBtn}
              </div>
            );
          })()}

          {/* Reviews expanded inline */}
          {showReviews && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {reviews.length > 0 ? reviews.map((r, i) => (
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
                  {(r.punctuality || r.quality || r.communication) && (
                    <div className="grid grid-cols-3 gap-2">
                      {r.punctuality && (
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Punctuality</span>
                          <div className="flex gap-0.5">
                            {[1,2,3,4,5].map(s => <Star key={s} className={`w-2.5 h-2.5 ${s <= r.punctuality! ? "fill-accent text-accent" : "text-muted-foreground/20"}`} />)}
                          </div>
                        </div>
                      )}
                      {r.quality && (
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Quality</span>
                          <div className="flex gap-0.5">
                            {[1,2,3,4,5].map(s => <Star key={s} className={`w-2.5 h-2.5 ${s <= r.quality! ? "fill-accent text-accent" : "text-muted-foreground/20"}`} />)}
                          </div>
                        </div>
                      )}
                      {r.communication && (
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Comms</span>
                          <div className="flex gap-0.5">
                            {[1,2,3,4,5].map(s => <Star key={s} className={`w-2.5 h-2.5 ${s <= r.communication! ? "fill-accent text-accent" : "text-muted-foreground/20"}`} />)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">For: {r.jobTitle}</p>
                  {r.feedback && <p className="text-sm text-foreground leading-relaxed">{r.feedback}</p>}
                </div>
              )) : (
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <Star className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No reviews yet</p>
                </div>
              )}
            </div>
          )}

          {/* Posted Jobs expanded inline */}
          {showPostedJobs && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {postedJobs.length > 0 ? postedJobs.map((job) => (
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
              )) : (
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <ClipboardList className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No posted jobs yet</p>
                </div>
              )}
            </div>
          )}

          {/* Worked Jobs expanded inline */}
          {showWorkedJobs && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {workedJobs.length > 0 ? workedJobs.map((job) => (
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
              )) : (
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <Hammer className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No completed jobs yet</p>
                </div>
              )}
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

          {/* Availability */}
          {profile.role === "helper" && <HelperAvailabilityDisplay helperId={userId!} />}

          {/* Portfolio — Pro+ only */}
          {profile.role === "helper" && (profile.subscription_tier === "pro" || profile.subscription_tier === "elite") && <HelperPortfolio helperId={userId!} />}

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

      {showReport && userId && (
        <ReportDialog
          open={showReport}
          onClose={() => setShowReport(false)}
          reportedType="user"
          reportedId={userId}
        />
      )}

      {showBlock && userId && profile && (
        <BlockUserDialog
          open={showBlock}
          onClose={() => setShowBlock(false)}
          blockedUserId={userId}
          blockedUserName={formatName(profile.full_name) || "this user"}
          onBlocked={() => navigate("/dashboard", { replace: true })}
        />
      )}
    </div>
  );
};

export default UserProfile;
