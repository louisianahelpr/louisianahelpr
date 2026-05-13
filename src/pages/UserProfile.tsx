import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatName } from "@/lib/utils";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MapPin, Star, Briefcase, Clock, CheckCircle, Phone, ClipboardList, Hammer, ShieldCheck, MoreVertical, Flag, Ban } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { HelperAvailabilityDisplay } from "@/components/HelperAvailabilityDisplay";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import CredentialBadge from "@/components/CredentialBadge";
import BusinessBadge from "@/components/BusinessBadge";
import { HelperPortfolio } from "@/components/HelperPortfolio";

import ReportDialog from "@/components/ReportDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import SaveHelperButton from "@/components/SaveHelperButton";
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

  const [showReviews, setShowReviews] = useState(searchParams.get("tab") === "reviews");
  const [showPostedJobs, setShowPostedJobs] = useState(false);
  const [showWorkedJobs, setShowWorkedJobs] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showBlock, setShowBlock] = useState(false);

  // React Query: cached for 60s, instant on revisit, refresh in background.
  const { data, isLoading } = useQuery({
    queryKey: ["user-profile", userId],
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const profileRes = await supabase.rpc("get_safe_profiles", { user_ids: [userId!] });
      if (!profileRes.data || profileRes.data.length === 0) {
        return { profile: null as Profile | null };
      }
      const prof = profileRes.data[0] as any;

      // Unified user model — every user can apply OR post. Always fetch
      // applications; the metrics section just hides itself if empty.
      // Was previously gated on role === 'helper', but role distinction
      // no longer exists in the UI.
      const [reviewsRes, postedRes, workedRes, appsRes, idCheckRes] = await Promise.all([
        // feedback_visible_at filter: anti-retaliation reveal — hidden until
        // both sides post or 14 days pass. set_review_visibility trigger
        // stamps this column on insert.
        supabase.from("reviews").select("rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id").eq("reviewee_id", userId!).lte("feedback_visible_at", new Date().toISOString()).order("created_at", { ascending: false }),
        supabase.from("jobs").select("id, title, status, category, budget, created_at").eq("customer_id", userId!).order("created_at", { ascending: false }).limit(20),
        supabase.from("jobs").select("id, title, status, category, budget, created_at").eq("helper_id", userId!).order("created_at", { ascending: false }).limit(20),
        supabase.from("applications").select("status, created_at, updated_at").eq("helper_id", userId!),
        supabase.from("profiles").select("id_document_url").eq("user_id", userId!).single(),
      ]);

      const postedJobs = postedRes.data || [];
      const workedJobs = workedRes.data || [];
      const allJobs = [...postedJobs, ...workedJobs];
      const completedCount = new Set(allJobs.filter(j => j.status === "completed").map(j => j.id)).size;
      const ratings = reviewsRes.data?.map((r: any) => r.rating) || [];
      const stats = {
        completedJobs: completedCount,
        avgRating: ratings.length > 0 ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : 0,
        reviewCount: ratings.length,
      };

      let responseMetrics = { avgResponseHours: null as number | null, acceptanceRate: null as number | null, totalApplications: 0 };
      if (appsRes?.data && appsRes.data.length > 0) {
        const allApps = appsRes.data;
        const accepted = allApps.filter((a: any) => a.status === "accepted");
        const acceptanceRate = allApps.length > 0 ? (accepted.length / allApps.length) * 100 : null;
        const responseTimes = accepted
          .map((a: any) => (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / 3_600_000)
          .filter((h: number) => h > 0 && h < 720);
        responseMetrics = {
          avgResponseHours: responseTimes.length > 0 ? responseTimes.reduce((a: number, b: number) => a + b, 0) / responseTimes.length : null,
          acceptanceRate,
          totalApplications: allApps.length,
        };
      }

      let reviews: any[] = [];
      if (reviewsRes.data && reviewsRes.data.length > 0) {
        const reviewerIds = [...new Set(reviewsRes.data.map((r: any) => r.reviewer_id))] as string[];
        const jobIds = [...new Set(reviewsRes.data.map((r: any) => r.job_id))] as string[];
        const [profilesRes2, jobsRes] = await Promise.all([
          supabase.rpc("get_safe_profiles", { user_ids: reviewerIds }),
          supabase.from("jobs").select("id, title").in("id", jobIds),
        ]);
        const nameMap = new Map(profilesRes2.data?.map((p: any) => [p.user_id, formatName(p.full_name)]) || []);
        const jobMap = new Map(jobsRes.data?.map((j: any) => [j.id, j.title]) || []);
        reviews = reviewsRes.data.map((r: any) => ({
          rating: r.rating,
          punctuality: r.punctuality ?? null,
          quality: r.quality ?? null,
          communication: r.communication ?? null,
          feedback: r.feedback,
          created_at: r.created_at,
          reviewerName: nameMap.get(r.reviewer_id) || "User",
          jobTitle: jobMap.get(r.job_id) || "Job",
        }));
      }

      return {
        profile: prof as Profile,
        reviews,
        stats,
        postedJobs,
        workedJobs,
        responseMetrics,
        isIdVerified: !!idCheckRes.data?.id_document_url,
      };
    },
  });

  const profile = (data?.profile ?? null) as Profile | null;
  const reviews = (data?.reviews ?? []) as Array<{ rating: number; punctuality: number | null; quality: number | null; communication: number | null; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string }>;
  const stats = data?.stats ?? { completedJobs: 0, avgRating: 0, reviewCount: 0 };
  const postedJobs = (data?.postedJobs ?? []) as Array<{ id: string; title: string; status: string; category: string; budget: number; created_at: string }>;
  const workedJobs = (data?.workedJobs ?? []) as Array<{ id: string; title: string; status: string; category: string; budget: number; created_at: string }>;
  const responseMetrics = data?.responseMetrics ?? { avgResponseHours: null, acceptanceRate: null, totalApplications: 0 };
  const isIdVerified = data?.isIdVerified ?? false;
  const loading = isLoading && !data;


  if (loading) {
    return (
      <div className="min-h-screen bg-premium-page pb-safe-nav">
        <DashboardHeader />
        <main className="container mx-auto px-5 py-6">
          <div className="max-w-lg mx-auto space-y-5">
            <div className="h-9 w-32 rounded-ds-md bg-muted animate-pulse" />
            <div className="rounded-2xl liquid-glass p-6 text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-muted animate-pulse mx-auto" />
              <div className="h-6 w-40 bg-muted animate-pulse mx-auto rounded" />
              <div className="h-4 w-24 bg-muted animate-pulse mx-auto rounded" />
              <div className="h-4 w-64 bg-muted animate-pulse mx-auto rounded" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-ds-md liquid-glass p-3 space-y-2">
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
      <div className="min-h-screen flex items-center justify-center bg-premium-page">
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
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow={isOwnProfile ? "How others see you" : "Helpr profile"}
        title={isOwnProfile ? "Profile Review" : "Profile"}
        meta={isOwnProfile ? "A preview from a poster's perspective" : "Reviews, badges, and history"}
        rightSlot={
          !isOwnProfile && currentUserId ? (
            <div className="flex items-center gap-1">
              <SaveHelperButton helperId={userId!} customerId={currentUserId} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-ds-md h-9 w-9 shrink-0" aria-label="More options">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate(`/post-job?offerTo=${userId}`)}>
                    <Briefcase className="w-4 h-4 mr-2" /> Offer a job directly
                  </DropdownMenuItem>
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

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-lg mx-auto space-y-5">
          {/* Profile Card — brand-aligned hero. Avatar with tier ring,
              italic display name, italic serif meta and bio. */}
          <div
            className="rounded-2xl liquid-glass p-5 text-center space-y-3 relative overflow-hidden"
            style={{
              backgroundImage:
                "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
                "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
            }}
          >
            {/* Verified Helpr ribbon — visible top-right corner badge
                for ID-verified helpers. Promotes the trust signal from
                a small chip to a prominent marker posters see at first
                glance. Gold-warm so it reads as recognition, not status. */}
            {isIdVerified && (
              <div
                aria-label="Verified Helpr"
                className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full"
                style={{
                  background: "hsl(var(--gold-warm) / 0.14)",
                  border: "0.5px solid hsl(var(--gold-warm) / 0.36)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                    "0 1px 2px hsl(var(--gold-warm) / 0.12), " +
                    "0 4px 10px -3px hsl(var(--gold-warm) / 0.28)",
                }}
              >
                <ShieldCheck className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} strokeWidth={2.5} />
                <span
                  className="font-sans font-bold uppercase tracking-wider"
                  style={{ fontSize: "0.6rem", color: "hsl(var(--gold-warm))", letterSpacing: "0.16em" }}
                >
                  Verified
                </span>
              </div>
            )}
            <div className="relative inline-block">
              {profile.avatar_url ? (
                <img
                  loading="lazy"
                  decoding="async"
                  src={profile.avatar_url}
                  alt={`${displayName} profile picture`}
                  className="w-24 h-24 rounded-[28px] squircle mx-auto object-cover"
                  style={{ boxShadow: "0 0 0 2px hsl(var(--bark) / 0.18)" }}
                />
              ) : (
                <div
                  className="w-24 h-24 rounded-[28px] squircle bg-primary/10 text-primary flex items-center justify-center mx-auto text-ds-24 font-display italic font-bold"
                  style={{ boxShadow: "0 0 0 2px hsl(var(--bark) / 0.18)" }}
                >
                  {initials}
                </div>
              )}
              {isIdVerified && (
                <div
                  aria-label="ID verified"
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{
                    background: "hsl(var(--bark))",
                    border: "2px solid hsl(var(--parchment))",
                  }}
                >
                  <ShieldCheck className="w-4 h-4" style={{ color: "hsl(var(--parchment))" }} strokeWidth={2.5} />
                </div>
              )}
            </div>
            <div>
              <h1
                className="font-display italic font-bold leading-tight"
                style={{ fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
              >
                {displayName}
              </h1>
              {profile.location && (
                <p
                  className="font-serif italic flex items-center justify-center gap-1 mt-0.5"
                  style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.75)" }}
                >
                  <MapPin className="w-3 h-3" />{profile.location}
                </p>
              )}
              {/* Response Metrics inline */}
              {responseMetrics.totalApplications > 0 && (
                <div className="flex items-center justify-center gap-3 mt-2 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                  {responseMetrics.avgResponseHours !== null && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                        {responseMetrics.avgResponseHours < 1
                          ? `${Math.round(responseMetrics.avgResponseHours * 60)}m`
                          : responseMetrics.avgResponseHours < 24
                          ? `${responseMetrics.avgResponseHours.toFixed(1)}h`
                          : `${Math.round(responseMetrics.avgResponseHours / 24)}d`}
                      </span>
                      <span>avg reply</span>
                    </span>
                  )}
                  {responseMetrics.acceptanceRate !== null && (
                    <>
                      <span style={{ color: "hsl(var(--burnt-sienna) / 0.35)" }}>·</span>
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        <span className="font-display italic font-bold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                          {responseMetrics.acceptanceRate.toFixed(0)}%
                        </span>
                        <span>accept rate</span>
                      </span>
                    </>
                  )}
                </div>
              )}
              {profile.phone && (
                <p className="font-serif italic mt-1.5 flex items-center justify-center gap-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                  <Phone className="w-3 h-3" />{profile.phone}
                </p>
              )}
              {profile.bio && (
                <p
                  className="font-serif italic mt-3 leading-relaxed text-left"
                  style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep) / 0.88)" }}
                >
                  {profile.bio}
                </p>
              )}
              {profile.skills && (
                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {profile.skills.split(",").map((s, i) => (
                    <span
                      key={i}
                      className="text-[0.7rem] font-sans font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: "hsl(var(--bark) / 0.10)",
                        color: "hsl(var(--bark))",
                        border: "0.5px solid hsl(var(--bark) / 0.20)",
                      }}
                    >
                      {s.trim()}
                    </span>
                  ))}
                </div>
              )}
              <HelperBadges badges={badges} />
              <div className="pt-2 flex flex-wrap justify-center gap-1.5">
                <CredentialBadge credentials={profile as any} size="md" />
                <BusinessBadge userId={userId!} size="md" />
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
                className={`rounded-ds-md border bg-card p-3 text-center transition-all cursor-pointer hover:border-primary/30 hover:shadow-sm ${showReviews ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <Star className="w-3.5 h-3.5 text-primary fill-primary" />
                  <p className="text-ds-20 font-bold text-foreground">{stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}</p>
                </div>
                <p className="text-muted-foreground text-ds-11">{stats.reviewCount} Review{stats.reviewCount !== 1 ? "s" : ""}</p>
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
                className={`rounded-ds-md border bg-card p-3 text-center transition-all ${postedJobs.length > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showPostedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <ClipboardList className="w-3.5 h-3.5 text-primary" />
                  <p className="text-ds-20 font-bold text-foreground">{postedJobs.length}</p>
                </div>
                <p className="text-muted-foreground text-ds-11">Posted</p>
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
                className={`rounded-ds-md border bg-card p-3 text-center transition-all ${workedJobs.length > 0 ? "cursor-pointer hover:border-primary/30 hover:shadow-sm" : ""} ${showWorkedJobs ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}
              >
                <div className="flex items-center justify-center gap-1">
                  <Hammer className="w-3.5 h-3.5 text-primary" />
                  <p className="text-ds-20 font-bold text-foreground">{workedJobs.length}</p>
                </div>
                <p className="text-muted-foreground text-ds-11">Completed</p>
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
                <div key={i} className="rounded-ds-md liquid-glass p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/20"}`} />
                        ))}
                      </div>
                      <span className="text-ds-11 font-medium text-foreground">{r.reviewerName}</span>
                    </div>
                    <span className="text-muted-foreground text-ds-11">{new Date(r.created_at).toLocaleDateString()}</span>
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
                  <p className="text-muted-foreground text-ds-11">For: {r.jobTitle}</p>
                  {r.feedback && <p className="text-ds-13 text-foreground leading-relaxed">{r.feedback}</p>}
                </div>
              )) : (
                <div className="rounded-ds-md liquid-glass p-6 text-center">
                  <Star className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-ds-11 text-muted-foreground">No reviews yet</p>
                </div>
              )}
            </div>
          )}

          {/* Posted Jobs expanded inline */}
          {showPostedJobs && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {postedJobs.length > 0 ? postedJobs.map((job) => (
                <div key={job.id} className="rounded-ds-md liquid-glass p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-ds-13 font-medium text-foreground truncate">{job.title}</p>
                    <p className="text-muted-foreground text-ds-11">{new Date(job.created_at).toLocaleDateString()} · {job.category.replace("_", " ")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-ds-13 font-bold text-primary">${job.budget}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[job.status] || "bg-muted text-muted-foreground"}`}>{job.status.replace("_", " ")}</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-ds-md liquid-glass p-6 text-center">
                  <ClipboardList className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-ds-11 text-muted-foreground">No posted jobs yet</p>
                </div>
              )}
            </div>
          )}

          {/* Worked Jobs expanded inline */}
          {showWorkedJobs && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {workedJobs.length > 0 ? workedJobs.map((job) => (
                <div key={job.id} className="rounded-ds-md liquid-glass p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-ds-13 font-medium text-foreground truncate">{job.title}</p>
                    <p className="text-muted-foreground text-ds-11">{new Date(job.created_at).toLocaleDateString()} · {job.category.replace("_", " ")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-ds-13 font-bold text-primary">${job.budget}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[job.status] || "bg-muted text-muted-foreground"}`}>{job.status.replace("_", " ")}</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-ds-md liquid-glass p-6 text-center">
                  <Hammer className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-ds-11 text-muted-foreground">No completed jobs yet</p>
                </div>
              )}
            </div>
          )}

          {profile.hourly_rate && (
            <div className="rounded-ds-md liquid-glass p-4 flex items-center gap-3">
              <Clock className="w-5 h-5 text-primary" />
              <div>
                <p className="text-ds-13 font-semibold text-foreground">${profile.hourly_rate}/hr</p>
                <p className="text-ds-11 text-muted-foreground">Hourly rate</p>
              </div>
            </div>
          )}

          {/* Availability */}
          <HelperAvailabilityDisplay helperId={userId!} />

          {/* Portfolio — Pro+ only */}
          {(profile.subscription_tier === "pro" || profile.subscription_tier === "elite") && <HelperPortfolio helperId={userId!} />}

          {/* Member since */}
          <p className="text-ds-11 text-muted-foreground text-center">
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
